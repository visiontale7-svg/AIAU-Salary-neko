use std::path::Path;

#[cfg(test)]
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use uuid::Uuid;

use crate::{
    domain::{
        AnalysisProviderKind, AnalysisSnapshot, AnalysisState, CommitImportRequest,
        ConversationSummary, CorrectionEvent, LayoutState, RedactionRange, SourceMessage, Speaker,
        VisibleTurn,
    },
    error::{AtlasError, AtlasResult},
    import::validate_preview,
};

#[derive(Debug, Clone)]
pub struct Repository {
    pool: SqlitePool,
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
        Ok(Self { pool })
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
        Ok(Self { pool })
    }

    pub async fn commit_import(
        &self,
        request: CommitImportRequest,
    ) -> AtlasResult<ConversationSummary> {
        validate_preview(&request.preview)?;
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
             (id, title, source_kind, source_path, source_sha256, analyze_redacted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&conversation_id)
        .bind(title)
        .bind(&request.preview.source_kind)
        .bind(&request.preview.source_path)
        .bind(&request.preview.source_sha256)
        .bind(request.analyze_redacted)
        .bind(now.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&mut *tx)
        .await?;

        for message in &request.preview.messages {
            sqlx::query(
                "INSERT INTO source_messages
                 (id, conversation_id, sequence_index, speaker, phase, external_message_id,
                  source_event_index, text, text_sha256, redacted_text, redaction_map_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&message.id)
            .bind(&conversation_id)
            .bind(message.sequence as i64)
            .bind(speaker_str(message.speaker))
            .bind(&message.phase)
            .bind(&message.external_message_id)
            .bind(message.source_event_index.map(|index| index as i64))
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
        Ok(ConversationSummary {
            id: conversation_id,
            title: title.to_string(),
            source_kind: request.preview.source_kind,
            turn_count: request.preview.turns.len(),
            character_count: request.preview.character_count,
            analyze_redacted: request.analyze_redacted,
            created_at: now,
        })
    }

    pub async fn list_conversations(&self) -> AtlasResult<Vec<ConversationSummary>> {
        let rows = sqlx::query(
            "SELECT c.id, c.title, c.source_kind, c.analyze_redacted, c.created_at,
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
            "SELECT id, title, source_kind, source_path, source_sha256, analyze_redacted, created_at
             FROM conversations WHERE id = ?",
        )
        .bind(conversation_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AtlasError::NotFound(format!("conversation {conversation_id}")))?;

        let message_rows = sqlx::query(
            "SELECT id, sequence_index, speaker, phase, external_message_id, source_event_index,
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
                source_event_index: row
                    .try_get::<Option<i64>, _>("source_event_index")?
                    .map(|value| value as usize),
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
        let analyze_redacted: bool = row.try_get("analyze_redacted")?;
        Ok(StoredConversation {
            summary: ConversationSummary {
                id: conversation_id.into(),
                title,
                source_kind,
                turn_count: turns.len(),
                character_count: messages.iter().map(|m| m.text.chars().count()).sum(),
                analyze_redacted,
                created_at,
            },
            source_path: row.try_get("source_path")?,
            source_sha256: row.try_get("source_sha256")?,
            messages,
            turns,
        })
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
}

fn summary_from_row(row: sqlx::sqlite::SqliteRow) -> AtlasResult<ConversationSummary> {
    Ok(ConversationSummary {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        source_kind: row.try_get("source_kind")?,
        turn_count: row.try_get::<i64, _>("turn_count")? as usize,
        character_count: row.try_get::<i64, _>("character_count")? as usize,
        analyze_redacted: row.try_get("analyze_redacted")?,
        created_at: parse_time(row.try_get("created_at")?)?,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::preview_paste_content;

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
}
