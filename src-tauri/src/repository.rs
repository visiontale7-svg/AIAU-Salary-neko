use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Arc,
};

#[cfg(test)]
use std::str::FromStr;

use chrono::{DateTime, FixedOffset, NaiveDate, TimeZone, Utc};
use serde_json::Value;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
    domain::{
        AnalysisProviderKind, AnalysisSnapshot, AnalysisState, CalendarAnalysisState,
        CalendarConversationVersion, CalendarEntry, CalendarImportState, CalendarIndexScanStatus,
        CalendarQuery, CalendarSourceState, CodexSessionIndexRecord, CodexSessionKind,
        CommitImportRequest, CompletionState, ConversationSummary, CorrectionEvent, LayoutState,
        RedactionRange, SourceFormat, SourceMessage, Speaker, TimeCoverage, TimeStatus,
        VisibleTurn,
    },
    error::{AtlasError, AtlasResult},
    import::validate_preview,
    relay::ShareReceipt,
};

#[derive(Debug, Clone)]
pub struct Repository {
    pool: SqlitePool,
    import_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Clone)]
pub struct StoredConversation {
    pub summary: ConversationSummary,
    #[allow(dead_code)]
    pub source_path: Option<String>,
    #[allow(dead_code)]
    pub source_sha256: String,
    pub messages: Vec<SourceMessage>,
    pub turns: Vec<VisibleTurn>,
}

#[derive(Debug, Clone)]
pub struct StoredRun {
    pub id: String,
    pub conversation_id: String,
    pub state: AnalysisState,
    pub provider: AnalysisProviderKind,
    pub provider_version: Option<String>,
    pub credential_mode: Option<String>,
    pub model_id: String,
    pub prompt_version: String,
    pub schema_version: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RelayDraftRecord {
    pub draft_id: String,
    pub snapshot_id: String,
    pub package_id: String,
    pub client_publish_id: String,
    pub snapshot_sha256: String,
    pub title_sha256: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub published_at: Option<DateTime<Utc>>,
    pub finalized_sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RelayIdMapRecord {
    pub entity_kind: String,
    pub source_id: String,
    pub source_index: i64,
    pub public_id: String,
}

const CODEX_INDEX_UPSERT: &str = "INSERT INTO codex_session_index
     (session_id, canonical_path, title, last_activity_at_utc,
      last_completed_at_utc, last_message_id, source_state, source_file_size,
      source_file_mtime_ns, scan_status, session_id_inferred, session_kind, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       canonical_path = excluded.canonical_path,
       title = excluded.title,
       last_activity_at_utc = excluded.last_activity_at_utc,
       last_completed_at_utc = excluded.last_completed_at_utc,
       last_message_id = excluded.last_message_id,
       source_state = excluded.source_state,
       source_file_size = excluded.source_file_size,
       source_file_mtime_ns = excluded.source_file_mtime_ns,
       scan_status = excluded.scan_status,
       session_id_inferred = excluded.session_id_inferred,
       session_kind = excluded.session_kind,
       updated_at = excluded.updated_at";

const CODEX_INDEX_SELECT_BY_PATH: &str =
    "SELECT session_id, canonical_path, title, last_activity_at_utc,
            last_completed_at_utc, last_message_id, source_state, source_file_size,
            source_file_mtime_ns, scan_status, session_id_inferred, session_kind, updated_at
     FROM codex_session_index WHERE canonical_path = ?";

const CODEX_INDEX_SELECT_BY_ID: &str =
    "SELECT session_id, canonical_path, title, last_activity_at_utc,
            last_completed_at_utc, last_message_id, source_state, source_file_size,
            source_file_mtime_ns, scan_status, session_id_inferred, session_kind, updated_at
     FROM codex_session_index WHERE session_id = ?";

#[derive(Debug, Clone)]
pub struct CommitImportOutcome {
    pub summary: ConversationSummary,
    pub already_imported: bool,
}

impl Repository {
    pub async fn connect(path: impl AsRef<Path>) -> AtlasResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal);
        Self::connect_with(options).await
    }

    #[cfg(test)]
    pub async fn in_memory() -> AtlasResult<Self> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")?
            .foreign_keys(true)
            .shared_cache(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|error| AtlasError::Migration(error.to_string()))?;
        Ok(Self {
            pool,
            import_lock: Arc::new(Mutex::new(())),
        })
    }

    async fn connect_with(options: SqliteConnectOptions) -> AtlasResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|error| AtlasError::Migration(error.to_string()))?;
        Ok(Self {
            pool,
            import_lock: Arc::new(Mutex::new(())),
        })
    }

    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn commit_import(
        &self,
        request: CommitImportRequest,
    ) -> AtlasResult<ConversationSummary> {
        Ok(self.commit_import_with_outcome(request).await?.summary)
    }

    pub async fn commit_import_with_outcome(
        &self,
        mut request: CommitImportRequest,
    ) -> AtlasResult<CommitImportOutcome> {
        let _import_guard = self.import_lock.lock().await;
        validate_preview(&request.preview)?;
        if let Some(session_id) = request.preview.external_session_id.as_deref()
            && let Some(conversation_id) = self
                .find_conversation_version(session_id, &request.preview.source_sha256)
                .await?
        {
            return Ok(CommitImportOutcome {
                summary: self.load_conversation(&conversation_id).await?.summary,
                already_imported: true,
            });
        }
        request.preview.supersedes_conversation_id =
            if let Some(session_id) = request.preview.external_session_id.as_deref() {
                sqlx::query_scalar(
                    "SELECT conversation_id FROM conversation_source_versions
                 WHERE external_session_id = ? ORDER BY created_at DESC LIMIT 1",
                )
                .bind(session_id)
                .fetch_optional(&self.pool)
                .await?
            } else {
                None
            };
        let conversation_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let title = request.title.trim();
        let title = if title.is_empty() {
            "未命名对话"
        } else {
            title
        };
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO conversations
             (id, title, source_kind, source_path, source_sha256, analyze_redacted,
              source_format, external_session_id, imported_first_visible_at_utc,
              imported_last_activity_at_utc, imported_last_completed_at_utc,
              imported_last_message_id, imported_time_coverage, source_file_size,
              source_file_mtime_ns, supersedes_conversation_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&conversation_id)
        .bind(title)
        .bind(&request.preview.source_kind)
        .bind(&request.preview.source_path)
        .bind(&request.preview.source_sha256)
        .bind(request.analyze_redacted)
        .bind(request.preview.source_format.as_str())
        .bind(&request.preview.external_session_id)
        .bind(
            request
                .preview
                .first_visible_at
                .map(|time| time.to_rfc3339()),
        )
        .bind(
            request
                .preview
                .last_activity_at
                .map(|time| time.to_rfc3339()),
        )
        .bind(
            request
                .preview
                .last_completed_turn_at
                .map(|time| time.to_rfc3339()),
        )
        .bind(&request.preview.last_message_id)
        .bind(request.preview.time_coverage.as_str())
        .bind(optional_u64_to_i64(request.preview.source_file_size)?)
        .bind(request.preview.source_file_mtime_ns)
        .bind(&request.preview.supersedes_conversation_id)
        .bind(now.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&mut *tx)
        .await?;

        if let Some(session_id) = request.preview.external_session_id.as_deref() {
            let result = sqlx::query(
                "INSERT INTO conversation_source_versions
                 (external_session_id, source_sha256, conversation_id, source_file_size,
                  source_file_mtime_ns, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(external_session_id, source_sha256) DO NOTHING",
            )
            .bind(session_id)
            .bind(&request.preview.source_sha256)
            .bind(&conversation_id)
            .bind(optional_u64_to_i64(request.preview.source_file_size)?)
            .bind(request.preview.source_file_mtime_ns)
            .bind(now.to_rfc3339())
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() == 0 {
                tx.rollback().await?;
                let existing_id = self
                    .find_conversation_version(session_id, &request.preview.source_sha256)
                    .await?
                    .ok_or_else(|| {
                        AtlasError::InvalidInput("导入版本发生并发冲突，但未能读取既有版本".into())
                    })?;
                return Ok(CommitImportOutcome {
                    summary: self.load_conversation(&existing_id).await?.summary,
                    already_imported: true,
                });
            }
        }

        for message in &request.preview.messages {
            sqlx::query(
                "INSERT INTO source_messages
                 (id, conversation_id, sequence_index, speaker, phase, external_message_id,
                  external_turn_id, source_event_index, occurred_at_utc, occurred_at_raw,
                  time_status, text, text_sha256, redacted_text, redaction_map_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&message.id)
            .bind(&conversation_id)
            .bind(message.sequence as i64)
            .bind(speaker_str(message.speaker))
            .bind(&message.phase)
            .bind(&message.external_message_id)
            .bind(&message.external_turn_id)
            .bind(message.source_event_index.map(|index| index as i64))
            .bind(message.occurred_at_utc.map(|time| time.to_rfc3339()))
            .bind(&message.occurred_at_raw)
            .bind(message.time_status.as_str())
            .bind(&message.text)
            .bind(&message.text_sha256)
            .bind(&message.redacted_text)
            .bind(serde_json::to_string(&message.redaction_map)?)
            .execute(&mut *tx)
            .await?;
        }
        for turn in &request.preview.turns {
            sqlx::query(
                "INSERT INTO visible_turns
                 (id, conversation_id, ordinal, speaker, operation_only)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&turn.id)
            .bind(&conversation_id)
            .bind(turn.ordinal as i64)
            .bind(speaker_str(turn.speaker))
            .bind(turn.operation_only)
            .execute(&mut *tx)
            .await?;
            for (position, message_id) in turn.message_ids.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO turn_messages (turn_id, message_id, position) VALUES (?, ?, ?)",
                )
                .bind(&turn.id)
                .bind(message_id)
                .bind(position as i64)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(CommitImportOutcome {
            summary: ConversationSummary {
                id: conversation_id,
                title: title.to_string(),
                source_kind: request.preview.source_kind,
                source_format: request.preview.source_format,
                external_session_id: request.preview.external_session_id,
                turn_count: request.preview.turns.len(),
                character_count: request.preview.character_count,
                analyze_redacted: request.analyze_redacted,
                first_visible_at: request.preview.first_visible_at,
                last_activity_at: request.preview.last_activity_at,
                last_completed_turn_at: request.preview.last_completed_turn_at,
                last_message_id: request.preview.last_message_id,
                time_coverage: request.preview.time_coverage,
                source_file_size: request.preview.source_file_size,
                source_file_mtime_ns: request.preview.source_file_mtime_ns,
                supersedes_conversation_id: request.preview.supersedes_conversation_id,
                created_at: now,
            },
            already_imported: false,
        })
    }

    pub async fn list_conversations(&self) -> AtlasResult<Vec<ConversationSummary>> {
        let rows = sqlx::query(
            "SELECT c.id, c.title, c.source_kind, c.source_format, c.external_session_id,
                    c.analyze_redacted, c.imported_first_visible_at_utc,
                    c.imported_last_activity_at_utc, c.imported_last_completed_at_utc,
                    c.imported_last_message_id, c.imported_time_coverage,
                    c.source_file_size, c.source_file_mtime_ns, c.supersedes_conversation_id,
                    c.created_at,
                    (SELECT COUNT(*) FROM visible_turns t WHERE t.conversation_id = c.id) AS turn_count,
                    (SELECT COALESCE(SUM(LENGTH(m.text)), 0) FROM source_messages m
                     WHERE m.conversation_id = c.id) AS character_count
             FROM conversations c ORDER BY c.created_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(summary_from_row).collect()
    }

    pub async fn load_conversation(
        &self,
        conversation_id: &str,
    ) -> AtlasResult<StoredConversation> {
        let row = sqlx::query(
            "SELECT id, title, source_kind, source_format, external_session_id, source_path,
                    source_sha256, analyze_redacted, imported_first_visible_at_utc,
                    imported_last_activity_at_utc, imported_last_completed_at_utc,
                    imported_last_message_id, imported_time_coverage, source_file_size,
                    source_file_mtime_ns, supersedes_conversation_id, created_at
             FROM conversations WHERE id = ?",
        )
        .bind(conversation_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AtlasError::NotFound(format!("conversation {conversation_id}")))?;

        let message_rows = sqlx::query(
            "SELECT id, sequence_index, speaker, phase, external_message_id, external_turn_id,
                    source_event_index, occurred_at_utc, occurred_at_raw, time_status,
                    text, text_sha256, redacted_text, redaction_map_json
             FROM source_messages WHERE conversation_id = ? ORDER BY sequence_index",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;
        let mut messages = Vec::with_capacity(message_rows.len());
        for row in message_rows {
            let redaction_json: String = row.try_get("redaction_map_json")?;
            messages.push(SourceMessage {
                id: row.try_get("id")?,
                speaker: parse_speaker(row.try_get::<String, _>("speaker")?.as_str())?,
                phase: row.try_get("phase")?,
                sequence: row.try_get::<i64, _>("sequence_index")? as usize,
                external_message_id: row.try_get("external_message_id")?,
                external_turn_id: row.try_get("external_turn_id")?,
                source_event_index: row
                    .try_get::<Option<i64>, _>("source_event_index")?
                    .map(|value| value as usize),
                occurred_at_utc: parse_optional_time(row.try_get("occurred_at_utc")?)?,
                occurred_at_raw: row.try_get("occurred_at_raw")?,
                time_status: parse_time_status(row.try_get::<String, _>("time_status")?.as_str())?,
                text: row.try_get("text")?,
                text_sha256: row.try_get("text_sha256")?,
                redacted_text: row.try_get("redacted_text")?,
                redaction_map: serde_json::from_str::<Vec<RedactionRange>>(&redaction_json)?,
                turn_ordinal: 0,
                operation_only: false,
                redactions: Vec::new(),
            });
        }
        let turn_rows = sqlx::query(
            "SELECT id, ordinal, speaker, operation_only
             FROM visible_turns WHERE conversation_id = ? ORDER BY ordinal",
        )
        .bind(conversation_id)
        .fetch_all(&self.pool)
        .await?;
        let mut turns = Vec::with_capacity(turn_rows.len());
        for row in turn_rows {
            let turn_id: String = row.try_get("id")?;
            let message_ids = sqlx::query(
                "SELECT message_id FROM turn_messages WHERE turn_id = ? ORDER BY position",
            )
            .bind(&turn_id)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| row.try_get("message_id"))
            .collect::<Result<Vec<String>, _>>()?;
            turns.push(VisibleTurn {
                id: turn_id,
                ordinal: row.try_get::<i64, _>("ordinal")? as usize,
                speaker: parse_speaker(row.try_get::<String, _>("speaker")?.as_str())?,
                operation_only: row.try_get::<bool, _>("operation_only")?,
                message_ids,
            });
        }
        for message in &mut messages {
            if let Some(turn) = turns
                .iter()
                .find(|turn| turn.message_ids.contains(&message.id))
            {
                message.turn_ordinal = turn.ordinal + 1;
                message.operation_only = turn.operation_only;
                message.redactions = message
                    .redaction_map
                    .iter()
                    .map(|range| crate::domain::PreviewRedaction {
                        start: range.original_start_utf16,
                        end: range.original_end_utf16,
                        replacement: range.replacement.clone(),
                        kind: range.kind.clone(),
                    })
                    .collect();
            }
        }
        let created_at = parse_time(row.try_get("created_at")?)?;
        let title: String = row.try_get("title")?;
        let source_kind: String = row.try_get("source_kind")?;
        let source_format =
            parse_source_format(row.try_get::<String, _>("source_format")?.as_str())?;
        let analyze_redacted: bool = row.try_get("analyze_redacted")?;
        Ok(StoredConversation {
            summary: ConversationSummary {
                id: conversation_id.into(),
                title,
                source_kind,
                source_format,
                external_session_id: row.try_get("external_session_id")?,
                turn_count: turns.len(),
                character_count: messages.iter().map(|m| m.text.chars().count()).sum(),
                analyze_redacted,
                first_visible_at: parse_optional_time(
                    row.try_get("imported_first_visible_at_utc")?,
                )?,
                last_activity_at: parse_optional_time(
                    row.try_get("imported_last_activity_at_utc")?,
                )?,
                last_completed_turn_at: parse_optional_time(
                    row.try_get("imported_last_completed_at_utc")?,
                )?,
                last_message_id: row.try_get("imported_last_message_id")?,
                time_coverage: parse_time_coverage(
                    row.try_get::<String, _>("imported_time_coverage")?.as_str(),
                )?,
                source_file_size: optional_i64_to_u64(row.try_get("source_file_size")?)?,
                source_file_mtime_ns: row.try_get("source_file_mtime_ns")?,
                supersedes_conversation_id: row.try_get("supersedes_conversation_id")?,
                created_at,
            },
            source_path: row.try_get("source_path")?,
            source_sha256: row.try_get("source_sha256")?,
            messages,
            turns,
        })
    }

    pub async fn find_conversation_version(
        &self,
        external_session_id: &str,
        source_sha256: &str,
    ) -> AtlasResult<Option<String>> {
        sqlx::query_scalar(
            "SELECT conversation_id FROM conversation_source_versions
             WHERE external_session_id = ? AND source_sha256 = ?",
        )
        .bind(external_session_id)
        .bind(source_sha256)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn count_conversation_versions(
        &self,
        external_session_id: &str,
    ) -> AtlasResult<usize> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM conversation_source_versions WHERE external_session_id = ?",
        )
        .bind(external_session_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count as usize)
    }

    /// Adds source-time metadata to a legacy import only when the current raw
    /// rollout is byte-identical and every stored visible message still matches
    /// its source event index, external message ID, and text hash. Text, turns,
    /// snapshots, corrections, and layout remain untouched.
    pub async fn backfill_legacy_calendar_time(
        &self,
        preview: &crate::domain::ImportPreview,
    ) -> AtlasResult<usize> {
        if preview.source_format != SourceFormat::RawRollout {
            return Ok(0);
        }
        let (Some(source_path), Some(session_id)) = (
            preview.source_path.as_deref(),
            preview.external_session_id.as_deref(),
        ) else {
            return Ok(0);
        };
        validate_preview(preview)?;
        let candidates = sqlx::query(
            "SELECT id FROM conversations
             WHERE source_format = 'legacy_unknown' AND source_path = ? AND source_sha256 = ?",
        )
        .bind(source_path)
        .bind(&preview.source_sha256)
        .fetch_all(&self.pool)
        .await?;
        if candidates.is_empty() {
            return Ok(0);
        }

        let mut verified = Vec::new();
        for row in candidates {
            let conversation_id: String = row.try_get("id")?;
            let messages = sqlx::query(
                "SELECT id, source_event_index, external_message_id, text_sha256
                 FROM source_messages WHERE conversation_id = ? ORDER BY sequence_index",
            )
            .bind(&conversation_id)
            .fetch_all(&self.pool)
            .await?;
            if messages.len() != preview.messages.len() {
                continue;
            }
            let exact = messages
                .iter()
                .zip(&preview.messages)
                .all(|(stored, source)| {
                    stored
                        .try_get::<Option<i64>, _>("source_event_index")
                        .ok()
                        .flatten()
                        == source
                            .source_event_index
                            .and_then(|value| i64::try_from(value).ok())
                        && stored
                            .try_get::<Option<String>, _>("external_message_id")
                            .ok()
                            .flatten()
                            == source.external_message_id
                        && stored.try_get::<String, _>("text_sha256").ok().as_deref()
                            == Some(source.text_sha256.as_str())
                });
            if exact {
                verified.push((conversation_id, messages));
            }
        }
        if verified.is_empty() {
            return Ok(0);
        }

        let mut tx = self.pool.begin().await?;
        for (conversation_id, stored_messages) in &verified {
            for (stored, source) in stored_messages.iter().zip(&preview.messages) {
                let message_id: String = stored.try_get("id")?;
                sqlx::query(
                    "UPDATE source_messages SET external_turn_id = ?, occurred_at_utc = ?,
                       occurred_at_raw = ?, time_status = ? WHERE id = ? AND conversation_id = ?",
                )
                .bind(&source.external_turn_id)
                .bind(source.occurred_at_utc.map(|time| time.to_rfc3339()))
                .bind(&source.occurred_at_raw)
                .bind(source.time_status.as_str())
                .bind(message_id)
                .bind(conversation_id)
                .execute(&mut *tx)
                .await?;
            }
            sqlx::query(
                "UPDATE conversations SET source_format = 'raw_rollout', external_session_id = ?,
                   imported_first_visible_at_utc = ?, imported_last_activity_at_utc = ?,
                   imported_last_completed_at_utc = ?, imported_last_message_id = ?,
                   imported_time_coverage = ?, source_file_size = ?, source_file_mtime_ns = ?
                 WHERE id = ?",
            )
            .bind(session_id)
            .bind(preview.first_visible_at.map(|time| time.to_rfc3339()))
            .bind(preview.last_activity_at.map(|time| time.to_rfc3339()))
            .bind(preview.last_completed_turn_at.map(|time| time.to_rfc3339()))
            .bind(&preview.last_message_id)
            .bind(preview.time_coverage.as_str())
            .bind(optional_u64_to_i64(preview.source_file_size)?)
            .bind(preview.source_file_mtime_ns)
            .bind(conversation_id)
            .execute(&mut *tx)
            .await?;
        }
        let canonical: String = sqlx::query_scalar(
            "SELECT c.id FROM conversations c
             WHERE c.external_session_id = ? AND c.source_sha256 = ?
             ORDER BY EXISTS (
               SELECT 1 FROM analysis_snapshots s JOIN analysis_runs r ON r.id = s.run_id
               WHERE s.conversation_id = c.id AND r.state IN ('ready','partial')
             ) DESC, c.created_at DESC LIMIT 1",
        )
        .bind(session_id)
        .bind(&preview.source_sha256)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO conversation_source_versions
             (external_session_id, source_sha256, conversation_id, source_file_size,
              source_file_mtime_ns, created_at)
             SELECT ?, ?, ?, ?, ?, created_at FROM conversations WHERE id = ?
             ON CONFLICT(external_session_id, source_sha256) DO UPDATE SET
               conversation_id = excluded.conversation_id,
               source_file_size = excluded.source_file_size,
               source_file_mtime_ns = excluded.source_file_mtime_ns,
               created_at = excluded.created_at",
        )
        .bind(session_id)
        .bind(&preview.source_sha256)
        .bind(&canonical)
        .bind(optional_u64_to_i64(preview.source_file_size)?)
        .bind(preview.source_file_mtime_ns)
        .bind(&canonical)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(verified.len())
    }

    pub async fn upsert_codex_session_index(
        &self,
        record: &CodexSessionIndexRecord,
    ) -> AtlasResult<()> {
        sqlx::query(CODEX_INDEX_UPSERT)
            .bind(&record.session_id)
            .bind(&record.canonical_path)
            .bind(&record.title)
            .bind(record.last_activity_at.map(|time| time.to_rfc3339()))
            .bind(record.last_completed_turn_at.map(|time| time.to_rfc3339()))
            .bind(&record.last_message_id)
            .bind(record.source_state.as_str())
            .bind(u64_to_i64(record.source_file_size)?)
            .bind(record.source_file_mtime_ns)
            .bind(record.scan_status.as_str())
            .bind(record.session_id_inferred)
            .bind(record.session_kind.as_str())
            .bind(record.updated_at.to_rfc3339())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn find_codex_session_index_by_path(
        &self,
        canonical_path: &str,
    ) -> AtlasResult<Option<CodexSessionIndexRecord>> {
        let row = sqlx::query(CODEX_INDEX_SELECT_BY_PATH)
            .bind(canonical_path)
            .fetch_optional(&self.pool)
            .await?;
        row.map(codex_index_from_row).transpose()
    }

    pub async fn get_codex_session_index_record(
        &self,
        session_id: &str,
    ) -> AtlasResult<Option<CodexSessionIndexRecord>> {
        let row = sqlx::query(CODEX_INDEX_SELECT_BY_ID)
            .bind(session_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(codex_index_from_row).transpose()
    }

    pub async fn mark_missing_codex_sessions(
        &self,
        seen_session_ids: &HashSet<String>,
        now: DateTime<Utc>,
    ) -> AtlasResult<()> {
        let mut tx = self.pool.begin().await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT session_id FROM codex_session_index")
            .fetch_all(&mut *tx)
            .await?;
        for session_id in ids {
            if !seen_session_ids.contains(&session_id) {
                sqlx::query(
                    "UPDATE codex_session_index SET source_state = 'missing', updated_at = ?
                     WHERE session_id = ?",
                )
                .bind(now.to_rfc3339())
                .bind(session_id)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }

    /// Atomically replaces all rows observed by a complete scan and marks older
    /// cache rows missing. If any upsert fails the previous complete cache is
    /// retained unchanged.
    pub async fn commit_codex_session_index_scan(
        &self,
        records: &[CodexSessionIndexRecord],
        seen_session_ids: &HashSet<String>,
        now: DateTime<Utc>,
    ) -> AtlasResult<()> {
        let mut tx = self.pool.begin().await?;
        for record in records {
            // A rollout may first be indexed from its UUID filename while its
            // session_meta line is still incomplete. Once an authoritative ID
            // becomes available, replace only that inferred row inside the same
            // atomic scan; never overwrite a conflicting authoritative record.
            sqlx::query(
                "DELETE FROM codex_session_index
                 WHERE canonical_path = ? AND session_id <> ? AND session_id_inferred = 1",
            )
            .bind(&record.canonical_path)
            .bind(&record.session_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(CODEX_INDEX_UPSERT)
                .bind(&record.session_id)
                .bind(&record.canonical_path)
                .bind(&record.title)
                .bind(record.last_activity_at.map(|time| time.to_rfc3339()))
                .bind(record.last_completed_turn_at.map(|time| time.to_rfc3339()))
                .bind(&record.last_message_id)
                .bind(record.source_state.as_str())
                .bind(u64_to_i64(record.source_file_size)?)
                .bind(record.source_file_mtime_ns)
                .bind(record.scan_status.as_str())
                .bind(record.session_id_inferred)
                .bind(record.session_kind.as_str())
                .bind(record.updated_at.to_rfc3339())
                .execute(&mut *tx)
                .await?;
        }
        let ids: Vec<String> = sqlx::query_scalar("SELECT session_id FROM codex_session_index")
            .fetch_all(&mut *tx)
            .await?;
        for session_id in ids {
            if !seen_session_ids.contains(&session_id) {
                sqlx::query(
                    "UPDATE codex_session_index SET source_state = 'missing', updated_at = ?
                     WHERE session_id = ?",
                )
                .bind(now.to_rfc3339())
                .bind(session_id)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn query_calendar_entries(
        &self,
        query: &CalendarQuery,
    ) -> AtlasResult<Vec<CalendarEntry>> {
        let (start, end) = calendar_utc_bounds(query)?;
        Ok(self
            .all_calendar_entries()
            .await?
            .into_iter()
            .filter(|entry| {
                entry
                    .last_activity_at
                    .is_some_and(|time| time >= start && time < end)
            })
            .collect())
    }

    pub async fn list_undated_calendar_entries(&self) -> AtlasResult<Vec<CalendarEntry>> {
        Ok(self
            .all_calendar_entries()
            .await?
            .into_iter()
            .filter(|entry| entry.last_activity_at.is_none())
            .collect())
    }

    pub async fn get_calendar_entry(&self, id: &str) -> AtlasResult<CalendarEntry> {
        self.all_calendar_entries()
            .await?
            .into_iter()
            .find(|entry| entry.id == id || entry.latest_conversation_id.as_deref() == Some(id))
            .ok_or_else(|| AtlasError::NotFound(format!("calendar entry {id}")))
    }

    pub async fn list_calendar_entry_versions(
        &self,
        entry_id: &str,
    ) -> AtlasResult<Vec<CalendarConversationVersion>> {
        let session_id = self.get_calendar_entry(entry_id).await?.external_session_id;
        let rows = if let Some(session_id) = session_id {
            sqlx::query(
                "SELECT c.id, c.title, c.imported_last_activity_at_utc, c.created_at,
                        (SELECT COUNT(*) FROM analysis_snapshots s WHERE s.conversation_id = c.id)
                          AS snapshot_count,
                        (SELECT r.state FROM analysis_snapshots s
                         JOIN analysis_runs r ON r.id = s.run_id
                         WHERE s.conversation_id = c.id ORDER BY s.created_at DESC LIMIT 1)
                          AS snapshot_state,
                        (SELECT state FROM analysis_runs r WHERE r.conversation_id = c.id
                         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS latest_run_state
                 FROM conversations c
                 JOIN conversation_source_versions v ON v.conversation_id = c.id
                 WHERE v.external_session_id = ? ORDER BY v.created_at DESC",
            )
            .bind(session_id)
            .fetch_all(&self.pool)
            .await?
        } else {
            let conversation_id = entry_id.strip_prefix("conversation:").unwrap_or(entry_id);
            sqlx::query(
                "SELECT c.id, c.title, c.imported_last_activity_at_utc, c.created_at,
                        (SELECT COUNT(*) FROM analysis_snapshots s WHERE s.conversation_id = c.id)
                          AS snapshot_count,
                        (SELECT r.state FROM analysis_snapshots s
                         JOIN analysis_runs r ON r.id = s.run_id
                         WHERE s.conversation_id = c.id ORDER BY s.created_at DESC LIMIT 1)
                          AS snapshot_state,
                        (SELECT state FROM analysis_runs r WHERE r.conversation_id = c.id
                         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS latest_run_state
                 FROM conversations c WHERE c.id = ? ORDER BY c.created_at DESC",
            )
            .bind(conversation_id)
            .fetch_all(&self.pool)
            .await?
        };
        let latest_id = rows
            .first()
            .map(|row| row.try_get::<String, _>("id"))
            .transpose()?;
        rows.into_iter()
            .map(|row| {
                let conversation_id: String = row.try_get("id")?;
                let state = row
                    .try_get::<Option<String>, _>("snapshot_state")?
                    .or(row.try_get::<Option<String>, _>("latest_run_state")?);
                Ok(CalendarConversationVersion {
                    is_latest: latest_id.as_deref() == Some(conversation_id.as_str()),
                    conversation_id,
                    title: row.try_get("title")?,
                    last_activity_at: parse_optional_time(
                        row.try_get("imported_last_activity_at_utc")?,
                    )?,
                    analysis_state: state
                        .as_deref()
                        .map(calendar_analysis_state)
                        .transpose()?
                        .unwrap_or_default(),
                    snapshot_count: i64_to_usize(row.try_get("snapshot_count")?)?,
                    created_at: parse_time(row.try_get("created_at")?)?,
                })
            })
            .collect()
    }

    async fn all_calendar_entries(&self) -> AtlasResult<Vec<CalendarEntry>> {
        #[derive(Default)]
        struct Aggregate {
            title: String,
            session_id: Option<String>,
            indexed: bool,
            last_activity: Option<DateTime<Utc>>,
            last_completed: Option<DateTime<Utc>>,
            source_state: Option<CalendarSourceState>,
            source_path: Option<String>,
            scan_warning: Option<String>,
            indexed_last_message_id: Option<String>,
            indexed_source_file_size: Option<u64>,
            indexed_source_file_mtime_ns: Option<i64>,
            newest_imported_last_message_id: Option<String>,
            newest_imported_source_file_size: Option<u64>,
            newest_imported_source_file_mtime_ns: Option<i64>,
            newest_imported_at: Option<DateTime<Utc>>,
            version_count: usize,
            snapshot_count: usize,
            latest_conversation_id: Option<String>,
            analysis_state: CalendarAnalysisState,
            newest_source_created_at: Option<DateTime<Utc>>,
            turn_count: Option<usize>,
            active_day_count: Option<usize>,
            time_coverage: Option<TimeCoverage>,
        }

        let mut by_key: HashMap<String, Aggregate> = HashMap::new();
        let mut hidden_index_sessions = HashSet::new();
        let index_rows = sqlx::query(
            "SELECT session_id, canonical_path, title, last_activity_at_utc,
                    last_completed_at_utc, last_message_id, source_state, scan_status,
                    source_file_size, source_file_mtime_ns, session_kind
             FROM codex_session_index",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in index_rows {
            let session_id: String = row.try_get("session_id")?;
            let session_kind =
                parse_codex_session_kind(row.try_get::<String, _>("session_kind")?.as_str())?;
            if session_kind != CodexSessionKind::Primary {
                hidden_index_sessions.insert(session_id);
                continue;
            }
            by_key.insert(
                session_id.clone(),
                Aggregate {
                    title: row.try_get("title")?,
                    session_id: Some(session_id),
                    indexed: true,
                    last_activity: parse_optional_time(row.try_get("last_activity_at_utc")?)?,
                    last_completed: parse_optional_time(row.try_get("last_completed_at_utc")?)?,
                    source_state: Some(parse_calendar_source_state(
                        row.try_get::<String, _>("source_state")?.as_str(),
                    )?),
                    source_path: row.try_get("canonical_path")?,
                    scan_warning: match row.try_get::<String, _>("scan_status")?.as_str() {
                        "ready" => None,
                        "partial" => Some("索引只获得了部分源信息".into()),
                        "failed" => Some("源文件索引失败，可尝试手动刷新".into()),
                        value => {
                            return Err(AtlasError::InvalidInput(format!(
                                "unknown calendar scan status: {value}"
                            )));
                        }
                    },
                    indexed_last_message_id: row.try_get("last_message_id")?,
                    indexed_source_file_size: Some(i64_to_u64(row.try_get("source_file_size")?)?),
                    indexed_source_file_mtime_ns: Some(row.try_get("source_file_mtime_ns")?),
                    ..Default::default()
                },
            );
        }

        let version_rows = sqlx::query(
            "SELECT external_session_id, COUNT(*) AS version_count
             FROM conversation_source_versions GROUP BY external_session_id",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in version_rows {
            let session_id: String = row.try_get("external_session_id")?;
            if hidden_index_sessions.contains(&session_id) {
                continue;
            }
            by_key.entry(session_id.clone()).or_default().session_id = Some(session_id.clone());
            by_key.entry(session_id).or_default().version_count =
                i64_to_usize(row.try_get("version_count")?)?;
        }

        let conversation_rows = sqlx::query(
            "SELECT c.id, c.title, c.external_session_id, c.source_path,
                    c.imported_last_activity_at_utc, c.imported_last_completed_at_utc,
                    c.imported_last_message_id, c.imported_time_coverage, c.created_at,
                    c.source_file_size, c.source_file_mtime_ns,
                    (SELECT COUNT(*) FROM visible_turns t WHERE t.conversation_id = c.id)
                      AS turn_count,
                    (SELECT COUNT(DISTINCT date(m.occurred_at_utc, '+9 hours'))
                     FROM source_messages m WHERE m.conversation_id = c.id
                       AND m.time_status = 'valid') AS active_day_count,
                    (SELECT COUNT(*) FROM analysis_snapshots s WHERE s.conversation_id = c.id)
                      AS snapshot_count,
                    (SELECT r.state FROM analysis_snapshots s
                     JOIN analysis_runs r ON r.id = s.run_id
                     WHERE s.conversation_id = c.id
                     ORDER BY s.created_at DESC LIMIT 1) AS snapshot_state,
                    (SELECT state FROM analysis_runs r WHERE r.conversation_id = c.id
                     ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS latest_run_state
             FROM conversations c
             WHERE c.external_session_id IS NULL OR EXISTS (
               SELECT 1 FROM conversation_source_versions v WHERE v.conversation_id = c.id
             )
             ORDER BY c.created_at",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in conversation_rows {
            let conversation_id: String = row.try_get("id")?;
            let session_id: Option<String> = row.try_get("external_session_id")?;
            if session_id
                .as_ref()
                .is_some_and(|session_id| hidden_index_sessions.contains(session_id))
            {
                continue;
            }
            let key = session_id
                .clone()
                .unwrap_or_else(|| format!("conversation:{conversation_id}"));
            let created_at = parse_time(row.try_get("created_at")?)?;
            let aggregate = by_key.entry(key).or_default();
            if session_id.is_none() {
                aggregate.version_count += 1;
            }
            aggregate.snapshot_count += row.try_get::<i64, _>("snapshot_count")? as usize;
            if aggregate
                .newest_imported_at
                .is_none_or(|latest| created_at >= latest)
            {
                aggregate.newest_imported_at = Some(created_at);
                aggregate.newest_imported_last_message_id =
                    row.try_get("imported_last_message_id")?;
                aggregate.newest_imported_source_file_size =
                    optional_i64_to_u64(row.try_get("source_file_size")?)?;
                aggregate.newest_imported_source_file_mtime_ns =
                    row.try_get("source_file_mtime_ns")?;
            }
            let snapshot_state: Option<String> = row.try_get("snapshot_state")?;
            let turn_count = i64_to_usize(row.try_get("turn_count")?)?;
            let active_day_count = i64_to_usize(row.try_get("active_day_count")?)?;
            // Calendar actions always target the newest immutable source
            // version. A successful snapshot on an older version must not hide
            // that a newer version still needs analysis or retry.
            let is_newest_source_version = aggregate
                .newest_source_created_at
                .is_none_or(|latest| created_at >= latest);
            if is_newest_source_version {
                if !aggregate.indexed {
                    aggregate.title = row.try_get("title")?;
                }
                aggregate.session_id = session_id;
                aggregate.latest_conversation_id = Some(conversation_id);
                if aggregate.source_state.is_none() {
                    aggregate.source_state = Some(CalendarSourceState::ImportOnly);
                    aggregate.source_path = row.try_get("source_path")?;
                    aggregate.last_activity =
                        parse_optional_time(row.try_get("imported_last_activity_at_utc")?)?;
                    aggregate.last_completed =
                        parse_optional_time(row.try_get("imported_last_completed_at_utc")?)?;
                }
                let latest_run_state: Option<String> = row.try_get("latest_run_state")?;
                aggregate.analysis_state = snapshot_state
                    .as_deref()
                    .or(latest_run_state.as_deref())
                    .map(calendar_analysis_state)
                    .transpose()?
                    .unwrap_or(CalendarAnalysisState::None);
                aggregate.newest_source_created_at = Some(created_at);
                aggregate.turn_count = Some(turn_count);
                aggregate.time_coverage = Some(parse_time_coverage(
                    row.try_get::<String, _>("imported_time_coverage")?.as_str(),
                )?);
                aggregate.active_day_count = (aggregate.time_coverage
                    == Some(TimeCoverage::Complete))
                .then_some(active_day_count);
            }
        }

        let mut entries = by_key
            .into_iter()
            .map(|(key, aggregate)| {
                let completion_state = match (aggregate.last_activity, aggregate.last_completed) {
                    (None, _) => CompletionState::Undated,
                    (Some(activity), Some(completed)) if activity == completed => {
                        CompletionState::Completed
                    }
                    _ => CompletionState::InProgressOrUnknown,
                };
                let import_state = match aggregate.latest_conversation_id {
                    None => CalendarImportState::NotImported,
                    Some(_)
                        if aggregate.indexed
                            && aggregate.indexed_last_message_id.is_some()
                            && aggregate.indexed_last_message_id
                                != aggregate.newest_imported_last_message_id =>
                    {
                        CalendarImportState::SourceUpdated
                    }
                    Some(_)
                        if aggregate.indexed
                            && aggregate.indexed_last_message_id.is_none()
                            && (aggregate.indexed_source_file_size
                                != aggregate.newest_imported_source_file_size
                                || aggregate.indexed_source_file_mtime_ns
                                    != aggregate.newest_imported_source_file_mtime_ns) =>
                    {
                        CalendarImportState::SourceUpdated
                    }
                    Some(_) => CalendarImportState::ImportedCurrent,
                };
                CalendarEntry {
                    id: aggregate.session_id.clone().unwrap_or(key),
                    external_session_id: aggregate.session_id,
                    title: aggregate.title,
                    last_activity_at: aggregate.last_activity,
                    last_completed_turn_at: aggregate.last_completed,
                    completion_state,
                    source_state: aggregate
                        .source_state
                        .unwrap_or(CalendarSourceState::ImportOnly),
                    import_state,
                    analysis_state: aggregate.analysis_state,
                    imported_version_count: aggregate.version_count,
                    snapshot_count: aggregate.snapshot_count,
                    latest_conversation_id: aggregate.latest_conversation_id,
                    turn_count: aggregate.turn_count,
                    active_day_count: aggregate.active_day_count,
                    time_coverage: aggregate.time_coverage,
                    source_path: aggregate.source_path,
                    scan_warning: aggregate.scan_warning,
                }
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            right
                .last_activity_at
                .cmp(&left.last_activity_at)
                .then_with(|| left.title.cmp(&right.title))
        });
        Ok(entries)
    }

    pub async fn create_run(
        &self,
        conversation_id: &str,
        provider: AnalysisProviderKind,
        provider_version: Option<&str>,
        credential_mode: &str,
        model_id: &str,
    ) -> AtlasResult<StoredRun> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let state = AnalysisState::Queued;
        sqlx::query(
            "INSERT INTO analysis_runs
             (id, conversation_id, state, provider_id, provider_version, credential_mode,
              model_id, prompt_version, schema_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(conversation_id)
        .bind(state.as_str())
        .bind(provider.as_str())
        .bind(provider_version)
        .bind(credential_mode)
        .bind(model_id)
        .bind(crate::domain::PROMPT_VERSION)
        .bind(crate::domain::SCHEMA_VERSION)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(StoredRun {
            id,
            conversation_id: conversation_id.into(),
            state,
            provider,
            provider_version: provider_version.map(ToOwned::to_owned),
            credential_mode: Some(credential_mode.into()),
            model_id: model_id.into(),
            prompt_version: crate::domain::PROMPT_VERSION.into(),
            schema_version: crate::domain::SCHEMA_VERSION.into(),
        })
    }

    pub async fn get_run(&self, run_id: &str) -> AtlasResult<StoredRun> {
        let row = sqlx::query(
            "SELECT id, conversation_id, state, provider_id, provider_version, credential_mode,
                    model_id, prompt_version, schema_version
             FROM analysis_runs WHERE id = ?",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AtlasError::NotFound(format!("analysis run {run_id}")))?;
        Ok(StoredRun {
            id: row.try_get("id")?,
            conversation_id: row.try_get("conversation_id")?,
            state: parse_analysis_state(row.try_get::<String, _>("state")?.as_str())?,
            provider: parse_provider(row.try_get::<String, _>("provider_id")?.as_str())?,
            provider_version: row.try_get("provider_version")?,
            credential_mode: row.try_get("credential_mode")?,
            model_id: row.try_get("model_id")?,
            prompt_version: row.try_get("prompt_version")?,
            schema_version: row.try_get("schema_version")?,
        })
    }

    pub async fn get_analysis_provider(&self) -> AtlasResult<AnalysisProviderKind> {
        let value: Option<String> =
            sqlx::query_scalar("SELECT analysis_provider FROM app_settings WHERE singleton_id = 1")
                .fetch_optional(&self.pool)
                .await?;
        value
            .as_deref()
            .map(parse_provider)
            .transpose()
            .map(|provider| provider.unwrap_or_default())
    }

    pub async fn set_analysis_provider(
        &self,
        provider: AnalysisProviderKind,
    ) -> AtlasResult<AnalysisProviderKind> {
        sqlx::query(
            "INSERT INTO app_settings (singleton_id, analysis_provider, updated_at)
             VALUES (1, ?, ?)
             ON CONFLICT(singleton_id) DO UPDATE SET
               analysis_provider = excluded.analysis_provider,
               updated_at = excluded.updated_at",
        )
        .bind(provider.as_str())
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(provider)
    }

    pub async fn update_run(
        &self,
        run_id: &str,
        state: AnalysisState,
        error: Option<&str>,
        input_tokens: Option<i64>,
        output_tokens: Option<i64>,
    ) -> AtlasResult<()> {
        sqlx::query(
            "UPDATE analysis_runs SET state = ?, error_message = ?, input_tokens = COALESCE(?, input_tokens),
                    output_tokens = COALESCE(?, output_tokens), updated_at = ? WHERE id = ?",
        )
        .bind(state.as_str())
        .bind(error)
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(Utc::now().to_rfc3339())
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn save_snapshot(&self, snapshot: &AnalysisSnapshot) -> AtlasResult<()> {
        sqlx::query(
            "INSERT INTO analysis_snapshots (id, run_id, conversation_id, payload_json, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&snapshot.id)
        .bind(&snapshot.run_id)
        .bind(&snapshot.conversation_id)
        .bind(serde_json::to_string(snapshot)?)
        .bind(snapshot.created_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn load_snapshot(
        &self,
        conversation_id: Option<&str>,
        snapshot_id: Option<&str>,
    ) -> AtlasResult<AnalysisSnapshot> {
        let payload: Option<String> = if let Some(snapshot_id) = snapshot_id {
            sqlx::query_scalar("SELECT payload_json FROM analysis_snapshots WHERE id = ?")
                .bind(snapshot_id)
                .fetch_optional(&self.pool)
                .await?
        } else if let Some(conversation_id) = conversation_id {
            sqlx::query_scalar(
                "SELECT payload_json FROM analysis_snapshots WHERE conversation_id = ?
                 ORDER BY created_at DESC LIMIT 1",
            )
            .bind(conversation_id)
            .fetch_optional(&self.pool)
            .await?
        } else {
            return Err(AtlasError::InvalidInput(
                "conversationId 或 snapshotId 至少需要一个".into(),
            ));
        };
        let payload = payload.ok_or_else(|| AtlasError::NotFound("analysis snapshot".into()))?;
        Ok(serde_json::from_str(&payload)?)
    }

    pub async fn append_correction(
        &self,
        snapshot_id: &str,
        kind: &str,
        target_id: &str,
        before: Option<Value>,
        after: Value,
    ) -> AtlasResult<CorrectionEvent> {
        let event = CorrectionEvent {
            id: Uuid::new_v4().to_string(),
            snapshot_id: snapshot_id.into(),
            kind: kind.into(),
            target_id: target_id.into(),
            before,
            after,
            created_at: Utc::now(),
        };
        let command = serde_json::json!({
            "kind": event.kind,
            "targetId": event.target_id,
        });
        sqlx::query(
            "INSERT INTO correction_events
             (id, snapshot_id, command_json, before_json, after_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&event.id)
        .bind(snapshot_id)
        .bind(serde_json::to_string(&command)?)
        .bind(
            event
                .before
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
        )
        .bind(serde_json::to_string(&event.after)?)
        .bind(event.created_at.to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(event)
    }

    pub async fn load_corrections(&self, snapshot_id: &str) -> AtlasResult<Vec<CorrectionEvent>> {
        let rows = sqlx::query(
            "SELECT id, command_json, before_json, after_json, created_at
             FROM correction_events WHERE snapshot_id = ? ORDER BY created_at, id",
        )
        .bind(snapshot_id)
        .fetch_all(&self.pool)
        .await?;
        let mut events = Vec::with_capacity(rows.len());
        for row in rows {
            let command: Value = serde_json::from_str(&row.try_get::<String, _>("command_json")?)?;
            let before = row
                .try_get::<Option<String>, _>("before_json")?
                .map(|json| serde_json::from_str(&json))
                .transpose()?;
            let after = serde_json::from_str(&row.try_get::<String, _>("after_json")?)?;
            events.push(CorrectionEvent {
                id: row.try_get("id")?,
                snapshot_id: snapshot_id.into(),
                kind: command
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .into(),
                target_id: command
                    .get("targetId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                before,
                after,
                created_at: parse_time(row.try_get("created_at")?)?,
            });
        }
        Ok(events)
    }

    pub async fn save_layout(
        &self,
        snapshot_id: &str,
        layout: &LayoutState,
    ) -> AtlasResult<LayoutState> {
        let mut persisted = layout.clone();
        persisted.updated_at = Some(Utc::now());
        sqlx::query(
            "INSERT INTO layout_states (snapshot_id, payload_json, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(snapshot_id) DO UPDATE SET payload_json = excluded.payload_json,
                 updated_at = excluded.updated_at",
        )
        .bind(snapshot_id)
        .bind(serde_json::to_string(&persisted)?)
        .bind(persisted.updated_at.expect("just set").to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(persisted)
    }

    pub async fn load_layout(&self, snapshot_id: &str) -> AtlasResult<Option<LayoutState>> {
        let payload: Option<String> =
            sqlx::query_scalar("SELECT payload_json FROM layout_states WHERE snapshot_id = ?")
                .bind(snapshot_id)
                .fetch_optional(&self.pool)
                .await?;
        payload
            .map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }

    pub(crate) async fn insert_relay_share_draft(
        &self,
        draft: &RelayDraftRecord,
        mappings: &[RelayIdMapRecord],
    ) -> AtlasResult<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO relay_share_drafts
             (draft_id, snapshot_id, package_id, client_publish_id, snapshot_sha256,
              title_sha256, created_at, expires_at, published_at, finalized_sha256)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&draft.draft_id)
        .bind(&draft.snapshot_id)
        .bind(&draft.package_id)
        .bind(&draft.client_publish_id)
        .bind(&draft.snapshot_sha256)
        .bind(&draft.title_sha256)
        .bind(draft.created_at.to_rfc3339())
        .bind(draft.expires_at.to_rfc3339())
        .bind(draft.published_at.map(|time| time.to_rfc3339()))
        .bind(&draft.finalized_sha256)
        .execute(&mut *transaction)
        .await?;
        for mapping in mappings {
            sqlx::query(
                "INSERT INTO relay_share_id_maps
                 (draft_id, entity_kind, source_id, source_index, public_id)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&draft.draft_id)
            .bind(&mapping.entity_kind)
            .bind(&mapping.source_id)
            .bind(mapping.source_index)
            .bind(&mapping.public_id)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(crate) async fn load_relay_share_draft(
        &self,
        draft_id: &str,
    ) -> AtlasResult<RelayDraftRecord> {
        let row = sqlx::query(
            "SELECT draft_id, snapshot_id, package_id, client_publish_id, snapshot_sha256,
                    title_sha256, created_at, expires_at, published_at, finalized_sha256
             FROM relay_share_drafts WHERE draft_id = ?",
        )
        .bind(draft_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AtlasError::NotFound(format!("share draft {draft_id}")))?;
        relay_draft_from_row(row)
    }

    pub(crate) async fn load_relay_share_draft_by_package_id(
        &self,
        package_id: &str,
    ) -> AtlasResult<RelayDraftRecord> {
        let row = sqlx::query(
            "SELECT draft_id, snapshot_id, package_id, client_publish_id, snapshot_sha256,
                    title_sha256, created_at, expires_at, published_at, finalized_sha256
             FROM relay_share_drafts WHERE package_id = ?",
        )
        .bind(package_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AtlasError::NotFound(format!("share package {package_id}")))?;
        relay_draft_from_row(row)
    }

    pub(crate) async fn load_relay_id_maps(
        &self,
        draft_id: &str,
    ) -> AtlasResult<Vec<RelayIdMapRecord>> {
        let rows = sqlx::query(
            "SELECT entity_kind, source_id, source_index, public_id
             FROM relay_share_id_maps WHERE draft_id = ?
             ORDER BY CASE entity_kind
                        WHEN 'node' THEN 1 WHEN 'edge' THEN 2 WHEN 'mode' THEN 3
                        WHEN 'node_evidence' THEN 4 ELSE 5 END,
                      public_id",
        )
        .bind(draft_id)
        .fetch_all(&self.pool)
        .await?;
        if rows.is_empty() {
            return Err(AtlasError::NotFound(format!(
                "share draft mappings {draft_id}"
            )));
        }
        rows.into_iter()
            .map(|row| {
                Ok(RelayIdMapRecord {
                    entity_kind: row.try_get("entity_kind")?,
                    source_id: row.try_get("source_id")?,
                    source_index: row.try_get("source_index")?,
                    public_id: row.try_get("public_id")?,
                })
            })
            .collect()
    }

    pub(crate) async fn claim_relay_share_finalization(
        &self,
        draft_id: &str,
        candidate: DateTime<Utc>,
        candidate_sha256: &str,
    ) -> AtlasResult<(DateTime<Utc>, String)> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "UPDATE relay_share_drafts
             SET published_at = ?, finalized_sha256 = ?
             WHERE draft_id = ? AND published_at IS NULL AND finalized_sha256 IS NULL",
        )
        .bind(candidate.to_rfc3339())
        .bind(candidate_sha256)
        .bind(draft_id)
        .execute(&mut *transaction)
        .await?;
        let finalized = sqlx::query(
            "SELECT published_at, finalized_sha256
             FROM relay_share_drafts WHERE draft_id = ?",
        )
        .bind(draft_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| AtlasError::NotFound(format!("share draft {draft_id}")))?;
        let published_at: Option<String> = finalized.try_get("published_at")?;
        let finalized_sha256: Option<String> = finalized.try_get("finalized_sha256")?;
        let (published_at, finalized_sha256) = published_at
            .zip(finalized_sha256)
            .ok_or_else(|| AtlasError::InvalidInput("分享草稿的最终化记录不完整".into()))?;
        transaction.commit().await?;
        Ok((parse_time(published_at)?, finalized_sha256))
    }

    pub(crate) async fn record_relay_share_receipt(
        &self,
        receipt: &ShareReceipt,
    ) -> AtlasResult<ShareReceipt> {
        let mut transaction = self.pool.begin().await?;
        let existing = sqlx::query(
            "SELECT publication_id, snapshot_id, package_id, client_publish_id, room_id,
                    atlas_version_id, package_sha256, relay_url, published_at
             FROM relay_share_publications
             WHERE publication_id = ? OR package_id = ? OR client_publish_id = ?",
        )
        .bind(&receipt.publication_id)
        .bind(&receipt.package_id)
        .bind(&receipt.client_publish_id)
        .fetch_all(&mut *transaction)
        .await?;
        if !existing.is_empty() {
            let existing = existing
                .into_iter()
                .map(relay_receipt_from_row)
                .collect::<AtlasResult<Vec<_>>>()?;
            if existing.iter().all(|item| item == receipt) {
                return Ok(receipt.clone());
            }
            return Err(AtlasError::InvalidInput(
                "发布回执与已有幂等记录冲突".into(),
            ));
        }
        sqlx::query(
            "INSERT INTO relay_share_publications
             (publication_id, snapshot_id, package_id, client_publish_id, room_id,
              atlas_version_id, package_sha256, relay_url, published_at, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&receipt.publication_id)
        .bind(&receipt.snapshot_id)
        .bind(&receipt.package_id)
        .bind(&receipt.client_publish_id)
        .bind(&receipt.room_id)
        .bind(&receipt.atlas_version_id)
        .bind(&receipt.package_sha256)
        .bind(&receipt.relay_url)
        .bind(receipt.published_at.to_rfc3339())
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(receipt.clone())
    }

    pub(crate) async fn list_relay_share_publications(
        &self,
        snapshot_id: &str,
    ) -> AtlasResult<Vec<ShareReceipt>> {
        sqlx::query(
            "SELECT publication_id, snapshot_id, package_id, client_publish_id, room_id,
                    atlas_version_id, package_sha256, relay_url, published_at
             FROM relay_share_publications
             WHERE snapshot_id = ?
             ORDER BY published_at DESC, recorded_at DESC",
        )
        .bind(snapshot_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(relay_receipt_from_row)
        .collect()
    }
}

fn relay_draft_from_row(row: sqlx::sqlite::SqliteRow) -> AtlasResult<RelayDraftRecord> {
    Ok(RelayDraftRecord {
        draft_id: row.try_get("draft_id")?,
        snapshot_id: row.try_get("snapshot_id")?,
        package_id: row.try_get("package_id")?,
        client_publish_id: row.try_get("client_publish_id")?,
        snapshot_sha256: row.try_get("snapshot_sha256")?,
        title_sha256: row.try_get("title_sha256")?,
        created_at: parse_time(row.try_get("created_at")?)?,
        expires_at: parse_time(row.try_get("expires_at")?)?,
        published_at: parse_optional_time(row.try_get("published_at")?)?,
        finalized_sha256: row.try_get("finalized_sha256")?,
    })
}

fn relay_receipt_from_row(row: sqlx::sqlite::SqliteRow) -> AtlasResult<ShareReceipt> {
    Ok(ShareReceipt {
        publication_id: row.try_get("publication_id")?,
        snapshot_id: row.try_get("snapshot_id")?,
        package_id: row.try_get("package_id")?,
        client_publish_id: row.try_get("client_publish_id")?,
        room_id: row.try_get("room_id")?,
        atlas_version_id: row.try_get("atlas_version_id")?,
        package_sha256: row.try_get("package_sha256")?,
        relay_url: row.try_get("relay_url")?,
        published_at: parse_time(row.try_get("published_at")?)?,
    })
}

fn summary_from_row(row: sqlx::sqlite::SqliteRow) -> AtlasResult<ConversationSummary> {
    Ok(ConversationSummary {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        source_kind: row.try_get("source_kind")?,
        source_format: parse_source_format(row.try_get::<String, _>("source_format")?.as_str())?,
        external_session_id: row.try_get("external_session_id")?,
        turn_count: row.try_get::<i64, _>("turn_count")? as usize,
        character_count: row.try_get::<i64, _>("character_count")? as usize,
        analyze_redacted: row.try_get("analyze_redacted")?,
        first_visible_at: parse_optional_time(row.try_get("imported_first_visible_at_utc")?)?,
        last_activity_at: parse_optional_time(row.try_get("imported_last_activity_at_utc")?)?,
        last_completed_turn_at: parse_optional_time(
            row.try_get("imported_last_completed_at_utc")?,
        )?,
        last_message_id: row.try_get("imported_last_message_id")?,
        time_coverage: parse_time_coverage(
            row.try_get::<String, _>("imported_time_coverage")?.as_str(),
        )?,
        source_file_size: optional_i64_to_u64(row.try_get("source_file_size")?)?,
        source_file_mtime_ns: row.try_get("source_file_mtime_ns")?,
        supersedes_conversation_id: row.try_get("supersedes_conversation_id")?,
        created_at: parse_time(row.try_get("created_at")?)?,
    })
}

fn codex_index_from_row(row: sqlx::sqlite::SqliteRow) -> AtlasResult<CodexSessionIndexRecord> {
    Ok(CodexSessionIndexRecord {
        session_id: row.try_get("session_id")?,
        canonical_path: row.try_get("canonical_path")?,
        title: row.try_get("title")?,
        last_activity_at: parse_optional_time(row.try_get("last_activity_at_utc")?)?,
        last_completed_turn_at: parse_optional_time(row.try_get("last_completed_at_utc")?)?,
        last_message_id: row.try_get("last_message_id")?,
        source_state: parse_calendar_source_state(
            row.try_get::<String, _>("source_state")?.as_str(),
        )?,
        source_file_size: i64_to_u64(row.try_get("source_file_size")?)?,
        source_file_mtime_ns: row.try_get("source_file_mtime_ns")?,
        scan_status: parse_calendar_index_scan_status(
            row.try_get::<String, _>("scan_status")?.as_str(),
        )?,
        session_id_inferred: row.try_get("session_id_inferred")?,
        session_kind: parse_codex_session_kind(row.try_get::<String, _>("session_kind")?.as_str())?,
        updated_at: parse_time(row.try_get("updated_at")?)?,
    })
}

fn parse_codex_session_kind(value: &str) -> AtlasResult<CodexSessionKind> {
    match value {
        "primary" => Ok(CodexSessionKind::Primary),
        "internal" => Ok(CodexSessionKind::Internal),
        "unknown" => Ok(CodexSessionKind::Unknown),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown Codex session kind: {value}"
        ))),
    }
}

fn speaker_str(speaker: Speaker) -> &'static str {
    match speaker {
        Speaker::User => "user",
        Speaker::Assistant => "assistant",
    }
}

fn parse_speaker(value: &str) -> AtlasResult<Speaker> {
    match value {
        "user" => Ok(Speaker::User),
        "assistant" => Ok(Speaker::Assistant),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown speaker: {value}"
        ))),
    }
}

fn parse_analysis_state(value: &str) -> AtlasResult<AnalysisState> {
    match value {
        "parsing" => Ok(AnalysisState::Parsing),
        "privacy_review" => Ok(AnalysisState::PrivacyReview),
        "queued" => Ok(AnalysisState::Queued),
        "segmenting" => Ok(AnalysisState::Segmenting),
        "linking" => Ok(AnalysisState::Linking),
        "modes" => Ok(AnalysisState::Modes),
        "validating" => Ok(AnalysisState::Validating),
        "ready" => Ok(AnalysisState::Ready),
        "partial" => Ok(AnalysisState::Partial),
        "failed" => Ok(AnalysisState::Failed),
        "cancelled" => Ok(AnalysisState::Cancelled),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown analysis state: {value}"
        ))),
    }
}

fn calendar_analysis_state(value: &str) -> AtlasResult<CalendarAnalysisState> {
    match value {
        "ready" => Ok(CalendarAnalysisState::Ready),
        "partial" => Ok(CalendarAnalysisState::Partial),
        "failed" | "cancelled" => Ok(CalendarAnalysisState::Failed),
        "parsing" | "privacy_review" | "queued" | "segmenting" | "linking" | "modes"
        | "validating" => Ok(CalendarAnalysisState::None),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown analysis state: {value}"
        ))),
    }
}

fn parse_source_format(value: &str) -> AtlasResult<SourceFormat> {
    match value {
        "raw_rollout" => Ok(SourceFormat::RawRollout),
        "visible_export" => Ok(SourceFormat::VisibleExport),
        "paste" => Ok(SourceFormat::Paste),
        "legacy_unknown" => Ok(SourceFormat::LegacyUnknown),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown source format: {value}"
        ))),
    }
}

fn parse_time_status(value: &str) -> AtlasResult<TimeStatus> {
    match value {
        "valid" => Ok(TimeStatus::Valid),
        "missing" => Ok(TimeStatus::Missing),
        "invalid" => Ok(TimeStatus::Invalid),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown time status: {value}"
        ))),
    }
}

fn parse_time_coverage(value: &str) -> AtlasResult<TimeCoverage> {
    match value {
        "complete" => Ok(TimeCoverage::Complete),
        "partial" => Ok(TimeCoverage::Partial),
        "none" => Ok(TimeCoverage::None),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown time coverage: {value}"
        ))),
    }
}

fn parse_calendar_source_state(value: &str) -> AtlasResult<CalendarSourceState> {
    match value {
        "active" => Ok(CalendarSourceState::Active),
        "archived" => Ok(CalendarSourceState::Archived),
        "missing" => Ok(CalendarSourceState::Missing),
        "import_only" => Ok(CalendarSourceState::ImportOnly),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown calendar source state: {value}"
        ))),
    }
}

fn parse_calendar_index_scan_status(value: &str) -> AtlasResult<CalendarIndexScanStatus> {
    match value {
        "ready" => Ok(CalendarIndexScanStatus::Ready),
        "partial" => Ok(CalendarIndexScanStatus::Partial),
        "failed" => Ok(CalendarIndexScanStatus::Failed),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown calendar scan status: {value}"
        ))),
    }
}

fn parse_provider(value: &str) -> AtlasResult<AnalysisProviderKind> {
    match value {
        "codex_cli" => Ok(AnalysisProviderKind::CodexCli),
        "openai_api" => Ok(AnalysisProviderKind::OpenaiApi),
        _ => Err(AtlasError::InvalidInput(format!(
            "unknown analysis provider: {value}"
        ))),
    }
}

fn parse_time(value: String) -> AtlasResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&value)
        .map(|time| time.with_timezone(&Utc))
        .map_err(|error| AtlasError::InvalidInput(format!("invalid stored timestamp: {error}")))
}

fn parse_optional_time(value: Option<String>) -> AtlasResult<Option<DateTime<Utc>>> {
    value.map(parse_time).transpose()
}

fn u64_to_i64(value: u64) -> AtlasResult<i64> {
    i64::try_from(value).map_err(|_| AtlasError::InvalidInput("文件大小超出 SQLite 范围".into()))
}

fn optional_u64_to_i64(value: Option<u64>) -> AtlasResult<Option<i64>> {
    value.map(u64_to_i64).transpose()
}

fn i64_to_u64(value: i64) -> AtlasResult<u64> {
    u64::try_from(value)
        .map_err(|_| AtlasError::InvalidInput("数据库中的文件大小不能为负数".into()))
}

fn i64_to_usize(value: i64) -> AtlasResult<usize> {
    usize::try_from(value).map_err(|_| AtlasError::InvalidInput("数据库中的计数不能为负数".into()))
}

fn optional_i64_to_u64(value: Option<i64>) -> AtlasResult<Option<u64>> {
    value.map(i64_to_u64).transpose()
}

fn calendar_utc_bounds(query: &CalendarQuery) -> AtlasResult<(DateTime<Utc>, DateTime<Utc>)> {
    if query.time_zone != "Asia/Tokyo" {
        return Err(AtlasError::InvalidInput(
            "日历 v1 仅支持 Asia/Tokyo 时区".into(),
        ));
    }
    let start_date = NaiveDate::parse_from_str(&query.start_date, "%Y-%m-%d")
        .map_err(|_| AtlasError::InvalidInput("日历开始日期必须是 YYYY-MM-DD".into()))?;
    let end_date = NaiveDate::parse_from_str(&query.end_date_exclusive, "%Y-%m-%d")
        .map_err(|_| AtlasError::InvalidInput("日历结束日期必须是 YYYY-MM-DD".into()))?;
    if start_date >= end_date {
        return Err(AtlasError::InvalidInput(
            "日历结束日期必须晚于开始日期".into(),
        ));
    }
    let tokyo = FixedOffset::east_opt(9 * 60 * 60).expect("valid Tokyo offset");
    let start = tokyo
        .from_local_datetime(&start_date.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        .single()
        .expect("fixed offset has one local instant")
        .with_timezone(&Utc);
    let end = tokyo
        .from_local_datetime(&end_date.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        .single()
        .expect("fixed offset has one local instant")
        .with_timezone(&Utc);
    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::{preview_codex_jsonl_content, preview_paste_content};

    #[tokio::test]
    async fn stores_only_normalized_preview_and_round_trips() {
        let repository = Repository::in_memory().await.unwrap();
        let preview = preview_paste_content("用户: 问题\nGPT: 回答").unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "测试".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let stored = repository.load_conversation(&summary.id).await.unwrap();
        assert_eq!(stored.messages.len(), 2);
        assert_eq!(stored.turns.len(), 2);
        assert_eq!(repository.list_conversations().await.unwrap().len(), 1);

        let run = repository
            .create_run(
                &summary.id,
                AnalysisProviderKind::CodexCli,
                Some("codex-cli test"),
                "chatgpt_login",
                crate::domain::CODEX_CLI_MODEL,
            )
            .await
            .unwrap();
        let stored_run = repository.get_run(&run.id).await.unwrap();
        assert_eq!(stored_run.provider, AnalysisProviderKind::CodexCli);
        assert_eq!(
            stored_run.provider_version.as_deref(),
            Some("codex-cli test")
        );
        assert_eq!(stored_run.credential_mode.as_deref(), Some("chatgpt_login"));
        assert_eq!(stored_run.model_id, crate::domain::CODEX_CLI_MODEL);

        repository
            .set_analysis_provider(AnalysisProviderKind::CodexCli)
            .await
            .unwrap();
        repository
            .set_analysis_provider(AnalysisProviderKind::OpenaiApi)
            .await
            .unwrap();
        let stored_run_after_settings_repair = repository.get_run(&run.id).await.unwrap();
        assert_eq!(
            stored_run_after_settings_repair.provider,
            AnalysisProviderKind::CodexCli,
            "repairing app_settings must not rewrite historical run provenance"
        );
    }

    #[tokio::test]
    async fn provider_setting_defaults_to_openai_and_round_trips() {
        let repository = Repository::in_memory().await.unwrap();
        assert_eq!(
            repository.get_analysis_provider().await.unwrap(),
            AnalysisProviderKind::OpenaiApi
        );
        repository
            .set_analysis_provider(AnalysisProviderKind::CodexCli)
            .await
            .unwrap();
        assert_eq!(
            repository.get_analysis_provider().await.unwrap(),
            AnalysisProviderKind::CodexCli
        );
    }

    #[tokio::test]
    async fn temporal_import_round_trips_and_same_session_hash_is_idempotent() {
        let repository = Repository::in_memory().await.unwrap();
        let jsonl = r#"{"type":"session_meta","payload":{"id":"80000000-0000-7000-8000-000000000001"}}
{"timestamp":"2026-08-08T11:30:00Z","type":"response_item","payload":{"type":"message","role":"user","id":"u1","content":[{"type":"input_text","text":"问题"}]}}
{"timestamp":"2026-08-08T11:50:14.446Z","type":"response_item","payload":{"type":"message","role":"assistant","id":"a1","phase":"final","content":[{"type":"output_text","text":"回答"}]}}"#;
        let preview =
            preview_codex_jsonl_content(jsonl, Some("/tmp/rollout.jsonl".into())).unwrap();
        let first = repository
            .commit_import_with_outcome(CommitImportRequest {
                title: "时间测试".into(),
                preview: preview.clone(),
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let second = repository
            .commit_import_with_outcome(CommitImportRequest {
                title: "重复导入".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();

        assert!(!first.already_imported);
        assert!(second.already_imported);
        assert_eq!(first.summary.id, second.summary.id);
        assert_eq!(repository.list_conversations().await.unwrap().len(), 1);
        let stored = repository
            .load_conversation(&first.summary.id)
            .await
            .unwrap();
        assert_eq!(stored.summary.time_coverage, TimeCoverage::Complete);
        assert_eq!(
            stored.summary.last_activity_at.unwrap().to_rfc3339(),
            "2026-08-08T11:50:14.446+00:00"
        );
        assert_eq!(stored.messages[1].time_status, TimeStatus::Valid);
        assert_eq!(
            stored.messages[1].occurred_at_raw.as_deref(),
            Some("2026-08-08T11:50:14.446Z")
        );
    }

    #[tokio::test]
    async fn updated_session_creates_an_immutable_superseding_version() {
        let repository = Repository::in_memory().await.unwrap();
        let session_id = "80000000-0000-7000-8000-000000000001";
        let original = format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\"}}}}\n{{\"timestamp\":\"2026-08-08T11:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"id\":\"u1\",\"content\":[{{\"type\":\"input_text\",\"text\":\"第一版\"}}]}}}}"
        );
        let updated = format!(
            "{original}\n{{\"timestamp\":\"2026-08-08T11:50:14.446Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"assistant\",\"id\":\"a2\",\"phase\":\"final\",\"content\":[{{\"type\":\"output_text\",\"text\":\"第二版新增回复\"}}]}}}}"
        );
        let first = repository
            .commit_import_with_outcome(CommitImportRequest {
                title: "第一版".into(),
                preview: preview_codex_jsonl_content(&original, None).unwrap(),
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let second = repository
            .commit_import_with_outcome(CommitImportRequest {
                title: "第二版".into(),
                preview: preview_codex_jsonl_content(&updated, None).unwrap(),
                analyze_redacted: true,
            })
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO analysis_runs
             (id,conversation_id,state,model_id,prompt_version,schema_version,created_at,updated_at)
             VALUES ('old-ready-run',?,'ready','fixture','v2','1',?,?)",
        )
        .bind(&first.summary.id)
        .bind("2026-08-08T12:00:00Z")
        .bind("2026-08-08T12:00:00Z")
        .execute(repository.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO analysis_snapshots (id,run_id,conversation_id,payload_json,created_at)
             VALUES ('old-ready-snapshot','old-ready-run',?,'{}','2026-08-08T12:00:00Z')",
        )
        .bind(&first.summary.id)
        .execute(repository.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO analysis_runs
             (id,conversation_id,state,model_id,prompt_version,schema_version,created_at,updated_at)
             VALUES ('new-failed-run',?,'failed','fixture','v2','1',?,?)",
        )
        .bind(&second.summary.id)
        .bind("2026-08-08T13:00:00Z")
        .bind("2026-08-08T13:00:00Z")
        .execute(repository.pool())
        .await
        .unwrap();

        assert!(!first.already_imported);
        assert!(!second.already_imported);
        assert_ne!(first.summary.id, second.summary.id);
        assert_eq!(
            second.summary.supersedes_conversation_id.as_deref(),
            Some(first.summary.id.as_str())
        );
        assert_eq!(repository.list_conversations().await.unwrap().len(), 2);
        let entry = repository
            .query_calendar_entries(&CalendarQuery {
                start_date: "2026-08-08".into(),
                end_date_exclusive: "2026-08-09".into(),
                time_zone: "Asia/Tokyo".into(),
            })
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(
            entry.latest_conversation_id.as_deref(),
            Some(second.summary.id.as_str())
        );
        assert_eq!(entry.analysis_state, CalendarAnalysisState::Failed);
        assert_eq!(entry.turn_count, Some(2));
        assert_eq!(
            entry.snapshot_count, 1,
            "older snapshots remain counted as history"
        );
        let versions = repository
            .list_calendar_entry_versions(session_id)
            .await
            .unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].conversation_id, second.summary.id);
        assert!(versions[0].is_latest);
        assert_eq!(versions[0].analysis_state, CalendarAnalysisState::Failed);
        assert_eq!(versions[1].snapshot_count, 1);
        assert_eq!(versions[1].analysis_state, CalendarAnalysisState::Ready);
        assert_eq!(
            repository
                .load_conversation(&first.summary.id)
                .await
                .unwrap()
                .messages
                .len(),
            1,
            "the earlier source version must remain unchanged"
        );
    }

    #[tokio::test]
    async fn legacy_time_backfill_requires_exact_message_provenance() {
        let repository = Repository::in_memory().await.unwrap();
        let jsonl = r#"{"type":"session_meta","payload":{"id":"80000000-0000-7000-8000-000000000001"}}
{"timestamp":"2026-08-08T11:30:00Z","type":"response_item","payload":{"type":"message","role":"user","id":"u1","content":[{"type":"input_text","text":"问题"}]}}
{"timestamp":"2026-08-08T11:50:14.446Z","type":"response_item","payload":{"type":"message","role":"assistant","id":"a1","phase":"final","content":[{"type":"output_text","text":"回答"}]}}"#;
        let preview =
            preview_codex_jsonl_content(jsonl, Some("/tmp/exact-rollout.jsonl".into())).unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "旧导入".into(),
                preview: preview.clone(),
                analyze_redacted: true,
            })
            .await
            .unwrap();
        sqlx::query("DELETE FROM conversation_source_versions WHERE conversation_id = ?")
            .bind(&summary.id)
            .execute(repository.pool())
            .await
            .unwrap();
        sqlx::query(
            "UPDATE conversations SET source_format = 'legacy_unknown', external_session_id = NULL,
             imported_first_visible_at_utc = NULL, imported_last_activity_at_utc = NULL,
             imported_last_completed_at_utc = NULL, imported_last_message_id = NULL,
             imported_time_coverage = 'none' WHERE id = ?",
        )
        .bind(&summary.id)
        .execute(repository.pool())
        .await
        .unwrap();
        sqlx::query(
            "UPDATE source_messages SET external_turn_id = NULL, occurred_at_utc = NULL,
             occurred_at_raw = NULL, time_status = 'missing' WHERE conversation_id = ?",
        )
        .bind(&summary.id)
        .execute(repository.pool())
        .await
        .unwrap();

        assert_eq!(
            repository
                .backfill_legacy_calendar_time(&preview)
                .await
                .unwrap(),
            1
        );
        let restored = repository.load_conversation(&summary.id).await.unwrap();
        assert_eq!(restored.summary.source_format, SourceFormat::RawRollout);
        assert_eq!(restored.summary.time_coverage, TimeCoverage::Complete);
        assert_eq!(
            restored.summary.last_activity_at.unwrap().to_rfc3339(),
            "2026-08-08T11:50:14.446+00:00"
        );

        sqlx::query("DELETE FROM conversation_source_versions WHERE conversation_id = ?")
            .bind(&summary.id)
            .execute(repository.pool())
            .await
            .unwrap();
        sqlx::query(
            "UPDATE conversations SET source_format = 'legacy_unknown', external_session_id = NULL,
             imported_time_coverage = 'none' WHERE id = ?",
        )
        .bind(&summary.id)
        .execute(repository.pool())
        .await
        .unwrap();
        sqlx::query(
            "UPDATE source_messages SET text_sha256 = 'mismatch' WHERE conversation_id = ?",
        )
        .bind(&summary.id)
        .execute(repository.pool())
        .await
        .unwrap();
        assert_eq!(
            repository
                .backfill_legacy_calendar_time(&preview)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            repository
                .load_conversation(&summary.id)
                .await
                .unwrap()
                .summary
                .source_format,
            SourceFormat::LegacyUnknown
        );
    }

    #[tokio::test]
    async fn calendar_query_uses_tokyo_half_open_dates_and_preserves_undated_imports() {
        let repository = Repository::in_memory().await.unwrap();
        for (session, timestamp) in [
            (
                "80000000-0000-7000-8000-000000000001",
                "2026-08-08T14:59:59Z",
            ),
            (
                "80000000-0000-7000-8000-000000000002",
                "2026-08-08T15:00:00Z",
            ),
        ] {
            let jsonl = format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session}\"}}}}\n{{\"timestamp\":\"{timestamp}\",\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"assistant\",\"id\":\"{session}-a\",\"phase\":\"final\",\"content\":[{{\"type\":\"output_text\",\"text\":\"回答\"}}]}}}}"
            );
            let preview = preview_codex_jsonl_content(&jsonl, None).unwrap();
            repository
                .commit_import(CommitImportRequest {
                    title: session.into(),
                    preview,
                    analyze_redacted: true,
                })
                .await
                .unwrap();
        }
        repository
            .commit_import(CommitImportRequest {
                title: "日期未知".into(),
                preview: preview_paste_content("用户: 未定日期").unwrap(),
                analyze_redacted: true,
            })
            .await
            .unwrap();

        let august_eighth = repository
            .query_calendar_entries(&CalendarQuery {
                start_date: "2026-08-08".into(),
                end_date_exclusive: "2026-08-09".into(),
                time_zone: "Asia/Tokyo".into(),
            })
            .await
            .unwrap();
        let august_ninth = repository
            .query_calendar_entries(&CalendarQuery {
                start_date: "2026-08-09".into(),
                end_date_exclusive: "2026-08-10".into(),
                time_zone: "Asia/Tokyo".into(),
            })
            .await
            .unwrap();
        assert_eq!(august_eighth.len(), 1);
        assert_eq!(august_ninth.len(), 1);
        assert_eq!(
            repository
                .list_undated_calendar_entries()
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn calendar_exposes_only_primary_index_sessions() {
        let repository = Repository::in_memory().await.unwrap();
        let now = Utc::now();
        let dated = DateTime::parse_from_rfc3339("2026-08-08T11:00:00Z")
            .unwrap()
            .to_utc();
        let primary_id = Uuid::new_v4().to_string();
        let internal_id = Uuid::new_v4().to_string();
        let unknown_id = Uuid::new_v4().to_string();
        let primary_undated_id = Uuid::new_v4().to_string();
        let internal_undated_id = Uuid::new_v4().to_string();

        for (session_id, activity, session_kind) in [
            (primary_id.as_str(), Some(dated), CodexSessionKind::Primary),
            (
                internal_id.as_str(),
                Some(dated),
                CodexSessionKind::Internal,
            ),
            (unknown_id.as_str(), Some(dated), CodexSessionKind::Unknown),
            (primary_undated_id.as_str(), None, CodexSessionKind::Primary),
            (
                internal_undated_id.as_str(),
                None,
                CodexSessionKind::Internal,
            ),
        ] {
            repository
                .upsert_codex_session_index(&CodexSessionIndexRecord {
                    session_id: session_id.into(),
                    canonical_path: format!("/tmp/{session_id}.jsonl"),
                    title: session_id.into(),
                    last_activity_at: activity,
                    last_completed_turn_at: activity,
                    last_message_id: Some(format!("{session_id}-last")),
                    source_state: CalendarSourceState::Active,
                    source_file_size: 100,
                    source_file_mtime_ns: 1_000,
                    scan_status: CalendarIndexScanStatus::Ready,
                    session_id_inferred: false,
                    session_kind,
                    updated_at: now,
                })
                .await
                .unwrap();
        }

        let dated_entries = repository
            .query_calendar_entries(&CalendarQuery {
                start_date: "2026-08-08".into(),
                end_date_exclusive: "2026-08-09".into(),
                time_zone: "Asia/Tokyo".into(),
            })
            .await
            .unwrap();
        assert_eq!(
            dated_entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec![primary_id.as_str()]
        );
        assert_eq!(
            repository
                .list_undated_calendar_entries()
                .await
                .unwrap()
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec![primary_undated_id.as_str()]
        );
        assert!(repository.get_calendar_entry(&internal_id).await.is_err());
        assert!(repository.get_calendar_entry(&unknown_id).await.is_err());

        let raw_internal_id = Uuid::new_v4().to_string();
        let raw_internal = format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{raw_internal_id}\"}}}}\n{{\"timestamp\":\"2026-08-08T11:30:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"id\":\"u1\",\"content\":[{{\"type\":\"input_text\",\"text\":\"内部任务正文\"}}]}}}}"
        );
        repository
            .commit_import(CommitImportRequest {
                title: "已导入内部任务".into(),
                preview: preview_codex_jsonl_content(&raw_internal, None).unwrap(),
                analyze_redacted: true,
            })
            .await
            .unwrap();
        repository
            .upsert_codex_session_index(&CodexSessionIndexRecord {
                session_id: raw_internal_id.clone(),
                canonical_path: format!("/tmp/{raw_internal_id}.jsonl"),
                title: "已导入内部任务".into(),
                last_activity_at: Some(
                    DateTime::parse_from_rfc3339("2026-08-08T11:30:00Z")
                        .unwrap()
                        .to_utc(),
                ),
                last_completed_turn_at: None,
                last_message_id: Some("u1".into()),
                source_state: CalendarSourceState::Active,
                source_file_size: 100,
                source_file_mtime_ns: 1_000,
                scan_status: CalendarIndexScanStatus::Ready,
                session_id_inferred: false,
                session_kind: CodexSessionKind::Internal,
                updated_at: now,
            })
            .await
            .unwrap();
        assert!(
            repository
                .query_calendar_entries(&CalendarQuery {
                    start_date: "2026-08-08".into(),
                    end_date_exclusive: "2026-08-09".into(),
                    time_zone: "Asia/Tokyo".into(),
                })
                .await
                .unwrap()
                .iter()
                .all(|entry| entry.id != raw_internal_id)
        );
    }

    #[tokio::test]
    async fn no_message_id_uses_file_signature_to_detect_a_source_update() {
        let repository = Repository::in_memory().await.unwrap();
        let session_id = "80000000-0000-7000-8000-000000000001";
        let jsonl = format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\"}}}}\n{{\"timestamp\":\"2026-08-08T11:00:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",\"text\":\"无 ID 消息\"}}]}}}}"
        );
        let mut preview = preview_codex_jsonl_content(&jsonl, None).unwrap();
        preview.source_file_size = Some(100);
        preview.source_file_mtime_ns = Some(1_000);
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "无 ID".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        assert!(summary.last_message_id.is_none());
        repository
            .upsert_codex_session_index(&CodexSessionIndexRecord {
                session_id: session_id.into(),
                canonical_path: "/tmp/no-id-rollout.jsonl".into(),
                title: "无 ID".into(),
                last_activity_at: summary.last_activity_at,
                last_completed_turn_at: None,
                last_message_id: None,
                source_state: CalendarSourceState::Active,
                source_file_size: 120,
                source_file_mtime_ns: 2_000,
                scan_status: CalendarIndexScanStatus::Ready,
                session_id_inferred: false,
                session_kind: CodexSessionKind::Primary,
                updated_at: Utc::now(),
            })
            .await
            .unwrap();
        let entry = repository.get_calendar_entry(session_id).await.unwrap();
        assert_eq!(entry.import_state, CalendarImportState::SourceUpdated);
    }

    #[tokio::test]
    async fn raw_import_without_local_index_remains_imported_current() {
        let repository = Repository::in_memory().await.unwrap();
        let session_id = "80000000-0000-7000-8000-000000000001";
        let jsonl = format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{session_id}\"}}}}\n{{\"timestamp\":\"2026-08-08T11:00:00Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",\"text\":\"外部导入\"}}]}}}}"
        );
        let mut preview =
            preview_codex_jsonl_content(&jsonl, Some("/external/rollout.jsonl".into())).unwrap();
        preview.source_file_size = Some(100);
        preview.source_file_mtime_ns = Some(1_000);
        repository
            .commit_import(CommitImportRequest {
                title: "仅导入".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();

        let entry = repository.get_calendar_entry(session_id).await.unwrap();
        assert_eq!(entry.source_state, CalendarSourceState::ImportOnly);
        assert_eq!(entry.import_state, CalendarImportState::ImportedCurrent);
    }

    #[tokio::test]
    async fn migration_from_pre_calendar_database_preserves_graph_state_and_unknown_time() {
        let path = std::env::temp_dir().join(format!(
            "dialogue-atlas-calendar-migration-{}.sqlite3",
            Uuid::new_v4()
        ));
        let legacy_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
            .execute(&legacy_pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0002_analysis_provider.sql"))
            .execute(&legacy_pool)
            .await
            .unwrap();
        let created = "2026-08-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO conversations
             (id,title,source_kind,source_sha256,analyze_redacted,created_at,updated_at)
             VALUES ('legacy-c','旧对话','codex_jsonl','legacy-hash',1,?,?)",
        )
        .bind(created)
        .bind(created)
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO source_messages
             (id,conversation_id,sequence_index,speaker,text,text_sha256,redacted_text,redaction_map_json)
             VALUES ('legacy-m','legacy-c',0,'user','旧问题','hash','旧问题','[]')",
        )
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO visible_turns (id,conversation_id,ordinal,speaker,operation_only)
             VALUES ('legacy-t','legacy-c',0,'user',0)",
        )
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO turn_messages (turn_id,message_id,position)
             VALUES ('legacy-t','legacy-m',0)",
        )
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO analysis_runs
             (id,conversation_id,state,model_id,prompt_version,schema_version,created_at,updated_at)
             VALUES ('legacy-r','legacy-c','ready','fixture','v1','1',?,?)",
        )
        .bind(created)
        .bind(created)
        .execute(&legacy_pool)
        .await
        .unwrap();
        let snapshot = serde_json::json!({
            "id": "legacy-s", "runId": "legacy-r", "conversationId": "legacy-c",
            "provider": "openai_api", "modelId": "fixture", "promptVersion": "v1",
            "schemaVersion": "1", "status": "ready", "semanticUnits": [],
            "relations": [], "modes": [], "memberships": [], "validationIssues": [],
            "rawModelOutput": {}, "inputTokens": 0, "outputTokens": 0, "createdAt": created,
        });
        sqlx::query(
            "INSERT INTO analysis_snapshots
             (id,run_id,conversation_id,payload_json,created_at)
             VALUES ('legacy-s','legacy-r','legacy-c',?,?)",
        )
        .bind(snapshot.to_string())
        .bind(created)
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO layout_states (snapshot_id,payload_json,updated_at)
             VALUES ('legacy-s',?,?)",
        )
        .bind(
            serde_json::json!({
                "nodes": [], "viewport": {"x": 10.0, "y": 20.0, "zoom": 0.8},
                "showModeIslands": false, "updatedAt": created,
            })
            .to_string(),
        )
        .bind(created)
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO correction_events
             (id,snapshot_id,command_json,before_json,after_json,created_at)
             VALUES ('legacy-e','legacy-s',?,NULL,'{}',?)",
        )
        .bind(serde_json::json!({"kind":"noop","targetId":"legacy"}).to_string())
        .bind(created)
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0003_calendar_time_index.sql"))
            .execute(&legacy_pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO codex_session_index
             (session_id,canonical_path,title,source_state,source_file_size,
              source_file_mtime_ns,scan_status,updated_at)
             VALUES ('legacy-index','/tmp/legacy.jsonl','旧索引','missing',1,1,'ready',?)",
        )
        .bind(created)
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../migrations/0004_primary_session_filter.sql"
        ))
        .execute(&legacy_pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0005_relay_publication.sql"))
            .execute(&legacy_pool)
            .await
            .unwrap();
        let migrated_kind: String = sqlx::query_scalar(
            "SELECT session_kind FROM codex_session_index WHERE session_id = 'legacy-index'",
        )
        .fetch_one(&legacy_pool)
        .await
        .unwrap();
        assert_eq!(migrated_kind, "unknown");
        let repository = Repository {
            pool: legacy_pool,
            import_lock: Arc::new(Mutex::new(())),
        };
        let stored = repository.load_conversation("legacy-c").await.unwrap();
        assert_eq!(stored.summary.source_format, SourceFormat::LegacyUnknown);
        assert_eq!(stored.summary.time_coverage, TimeCoverage::None);
        assert_eq!(stored.summary.last_activity_at, None);
        assert_eq!(stored.messages[0].time_status, TimeStatus::Missing);
        assert_eq!(stored.messages[0].occurred_at_utc, None);
        assert_eq!(
            repository
                .load_snapshot(Some("legacy-c"), None)
                .await
                .unwrap()
                .id,
            "legacy-s"
        );
        let layout = repository.load_layout("legacy-s").await.unwrap().unwrap();
        assert_eq!(layout.viewport.zoom, 0.8);
        assert!(!layout.show_mode_islands);
        assert_eq!(
            repository.load_corrections("legacy-s").await.unwrap().len(),
            1
        );
        let relay_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND name IN
             ('relay_share_drafts', 'relay_share_id_maps', 'relay_share_publications')",
        )
        .fetch_one(repository.pool())
        .await
        .unwrap();
        assert_eq!(relay_tables, 3);

        repository.pool.close().await;
        for suffix in ["", "-wal", "-shm"] {
            let candidate = std::path::PathBuf::from(format!("{}{}", path.display(), suffix));
            if candidate.exists() {
                std::fs::remove_file(candidate).unwrap();
            }
        }
    }
}
