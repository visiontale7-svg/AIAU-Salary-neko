use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, Metadata},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use chrono::{DateTime, Utc};
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
    domain::{
        CalendarIndexScanStatus, CalendarSourceState, CodexSessionIndexRecord, CodexSessionKind,
        ImportPreview, MAX_TRANSCRIPT_CHARS, MAX_VISIBLE_TURNS, SourceFormat, SourceMessage,
        Speaker,
    },
    error::{AtlasError, AtlasResult},
    import::{
        detect_visible_conversation_export_header, extract_flat_visible_message, make_message,
        make_preview, parse_rollout_session_id, parse_rollout_visible_record,
    },
    repository::Repository,
};

const INDEX_EVENT: &str = "codex_index_progress";
const PREVIEW_PROGRESS_EVENT: &str = "import_preview_progress";
const HEAD_SCAN_LIMIT: u64 = 16 * 1024 * 1024;
const READ_BUFFER_BYTES: usize = 1024 * 1024;
const MAX_REVERSE_RECORD_BYTES: usize = 2 * 1024 * 1024;
const MAX_INDEX_CONCURRENCY: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexIndexStatus {
    pub running: bool,
    pub stage: String,
    pub completed: usize,
    pub total: usize,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible_sessions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_sessions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_completed_at: Option<DateTime<Utc>>,
}

impl Default for CodexIndexStatus {
    fn default() -> Self {
        Self {
            running: false,
            stage: if cfg!(target_os = "macos") {
                "idle".into()
            } else {
                "idle".into()
            },
            completed: 0,
            total: 0,
            message: if cfg!(target_os = "macos") {
                "尚未扫描本机 Codex 会话".into()
            } else {
                "此平台暂不开放 Codex 会话目录索引".into()
            },
            visible_sessions: None,
            skipped_sessions: None,
            last_completed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewProgress {
    pub preview_id: String,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewReady {
    pub preview_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<ImportPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewStart {
    pub preview_id: String,
    pub preview: Option<ImportPreview>,
}

#[derive(Clone, Default)]
pub struct CalendarRuntime {
    status: Arc<Mutex<CodexIndexStatus>>,
    index_cancel: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    preview_jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl CalendarRuntime {
    pub async fn status(&self) -> CodexIndexStatus {
        self.status.lock().await.clone()
    }

    pub async fn cancel_index(&self) -> bool {
        let guard = self.index_cancel.lock().await;
        let Some(cancel) = guard.as_ref() else {
            return false;
        };
        cancel.store(true, Ordering::Relaxed);
        true
    }

    pub async fn begin_preview(&self, preview_id: &str) -> Arc<AtomicBool> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.preview_jobs
            .lock()
            .await
            .insert(preview_id.to_string(), cancel.clone());
        cancel
    }

    pub async fn finish_preview(&self, preview_id: &str) {
        self.preview_jobs.lock().await.remove(preview_id);
    }

    pub async fn cancel_preview(&self, preview_id: &str) -> bool {
        let jobs = self.preview_jobs.lock().await;
        let Some(cancel) = jobs.get(preview_id) else {
            return false;
        };
        cancel.store(true, Ordering::Relaxed);
        true
    }

    #[cfg(target_os = "macos")]
    pub async fn start_index(
        &self,
        app: AppHandle,
        repository: Repository,
        codex_home: PathBuf,
    ) -> AtlasResult<CodexIndexStatus> {
        {
            let status = self.status.lock().await;
            if status.running {
                return Ok(status.clone());
            }
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *self.index_cancel.lock().await = Some(cancel.clone());
        let starting = CodexIndexStatus {
            running: true,
            stage: "discovering".into(),
            completed: 0,
            total: 0,
            message: "正在发现本机 Codex 会话".into(),
            visible_sessions: None,
            skipped_sessions: None,
            last_completed_at: None,
        };
        *self.status.lock().await = starting.clone();
        let _ = app.emit(INDEX_EVENT, &starting);

        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = run_index_scan(
                app.clone(),
                repository,
                codex_home,
                cancel.clone(),
                runtime.clone(),
            )
            .await;
            let final_status = match result {
                Ok(status) => status,
                Err(AtlasError::Cancelled) => CodexIndexStatus {
                    running: false,
                    stage: "cancelled".into(),
                    completed: runtime.status.lock().await.completed,
                    total: runtime.status.lock().await.total,
                    message: "扫描已取消；继续使用上次完整索引".into(),
                    visible_sessions: None,
                    skipped_sessions: None,
                    last_completed_at: None,
                },
                Err(error) => CodexIndexStatus {
                    running: false,
                    stage: "failed".into(),
                    completed: runtime.status.lock().await.completed,
                    total: runtime.status.lock().await.total,
                    message: format!("扫描失败；继续使用上次完整索引：{error}"),
                    visible_sessions: None,
                    skipped_sessions: None,
                    last_completed_at: None,
                },
            };
            *runtime.status.lock().await = final_status.clone();
            *runtime.index_cancel.lock().await = None;
            let _ = app.emit(INDEX_EVENT, final_status);
        });
        Ok(starting)
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn start_index(
        &self,
        _app: AppHandle,
        _repository: Repository,
        _codex_home: PathBuf,
    ) -> AtlasResult<CodexIndexStatus> {
        Ok(CodexIndexStatus::default())
    }
}

#[derive(Debug, Clone)]
struct DiscoveredFile {
    path: PathBuf,
    source_state: CalendarSourceState,
    signature: FileSignature,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileSignature {
    size: u64,
    mtime_ns: i64,
}

#[derive(Debug)]
struct ScanOutcome {
    record: Option<CodexSessionIndexRecord>,
    diagnostic: Option<String>,
}

#[cfg(target_os = "macos")]
async fn run_index_scan(
    app: AppHandle,
    repository: Repository,
    codex_home: PathBuf,
    cancel: Arc<AtomicBool>,
    runtime: CalendarRuntime,
) -> AtlasResult<CodexIndexStatus> {
    let discovery_root = codex_home.clone();
    let files = tokio::task::spawn_blocking(move || discover_rollouts(&discovery_root))
        .await
        .map_err(|error| AtlasError::Io(std::io::Error::other(error.to_string())))??;
    if cancel.load(Ordering::Relaxed) {
        return Err(AtlasError::Cancelled);
    }
    let title_hints = load_title_hints(&codex_home.join("session_index.jsonl"));
    let mut status = CodexIndexStatus {
        running: true,
        stage: "scanning".into(),
        completed: 0,
        total: files.len(),
        message: format!("正在检查 {} 个本机会话文件", files.len()),
        visible_sessions: Some(0),
        skipped_sessions: Some(0),
        last_completed_at: None,
    };
    *runtime.status.lock().await = status.clone();
    let _ = app.emit(INDEX_EVENT, &status);

    let mut staged: HashMap<String, CodexSessionIndexRecord> = HashMap::new();
    let mut to_scan = Vec::new();
    let now = Utc::now();
    for file in files {
        if cancel.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        let canonical = file.path.to_string_lossy().to_string();
        let cached = repository
            .find_codex_session_index_by_path(&canonical)
            .await?;
        if let Some(mut cached) = cached.clone()
            && can_reuse_cached_index(&cached, &file)
        {
            cached.source_state = file.source_state;
            cached.updated_at = now;
            merge_index_record(&mut staged, cached);
            status.completed += 1;
        } else {
            to_scan.push((file, cached));
        }
    }
    emit_index_status(&app, &runtime, &status).await;

    let mut skipped = 0usize;
    for chunk in to_scan.chunks(MAX_INDEX_CONCURRENCY) {
        let mut jobs = Vec::with_capacity(chunk.len());
        for (file, cached) in chunk.iter().cloned() {
            let hints = title_hints.clone();
            let cancel = cancel.clone();
            jobs.push(tokio::task::spawn_blocking(move || {
                scan_rollout_file_with_retry(file, cached, &hints, &cancel)
            }));
        }
        for job in jobs {
            if cancel.load(Ordering::Relaxed) {
                return Err(AtlasError::Cancelled);
            }
            let outcome = job
                .await
                .map_err(|error| AtlasError::Io(std::io::Error::other(error.to_string())))??;
            status.completed += 1;
            let had_record = outcome.record.is_some();
            if let Some(record) = outcome.record {
                merge_index_record(&mut staged, record);
            } else {
                skipped += 1;
            }
            let _has_partial_diagnostic = outcome.diagnostic.is_some() && had_record;
            status.visible_sessions = Some(
                staged
                    .values()
                    .filter(|record| record.session_kind == CodexSessionKind::Primary)
                    .count(),
            );
            status.skipped_sessions = Some(skipped);
            status.message = format!("已检查 {}/{} 个会话", status.completed, status.total);
            emit_index_status(&app, &runtime, &status).await;
        }
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(AtlasError::Cancelled);
    }

    commit_index_batch(&repository, staged.values(), now).await?;
    let visible_sessions = staged
        .values()
        .filter(|record| record.session_kind == CodexSessionKind::Primary)
        .count();
    let internal_sessions = staged
        .values()
        .filter(|record| record.session_kind == CodexSessionKind::Internal)
        .count();
    let finished = CodexIndexStatus {
        running: false,
        stage: "ready".into(),
        completed: status.total,
        total: status.total,
        message: format!(
            "本地索引已更新：{visible_sessions} 段主要对话，已隐藏 {internal_sessions} 个内部任务"
        ),
        visible_sessions: Some(visible_sessions),
        skipped_sessions: Some(skipped),
        last_completed_at: Some(now),
    };
    Ok(finished)
}

fn can_reuse_cached_index(cached: &CodexSessionIndexRecord, file: &DiscoveredFile) -> bool {
    cached.source_file_size == file.signature.size
        && cached.source_file_mtime_ns == file.signature.mtime_ns
        && cached.session_kind != CodexSessionKind::Unknown
}

fn scan_rollout_file_with_retry(
    mut file: DiscoveredFile,
    cached: Option<CodexSessionIndexRecord>,
    title_hints: &HashMap<String, String>,
    cancel: &AtomicBool,
) -> AtlasResult<ScanOutcome> {
    let first_error = match scan_rollout_file(&file, title_hints, cancel) {
        Ok(outcome) => return Ok(outcome),
        Err(AtlasError::Cancelled) => return Err(AtlasError::Cancelled),
        Err(error) => error,
    };
    if cancel.load(Ordering::Relaxed) {
        return Err(AtlasError::Cancelled);
    }
    let retry = fs::symlink_metadata(&file.path)
        .map_err(AtlasError::from)
        .and_then(|metadata| {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(AtlasError::InvalidInput("源会话不再是普通文件".into()));
            }
            file.signature = signature_from_metadata(&metadata)?;
            scan_rollout_file(&file, title_hints, cancel)
        });
    match retry {
        Ok(outcome) => Ok(outcome),
        Err(AtlasError::Cancelled) => Err(AtlasError::Cancelled),
        Err(second_error) => {
            let diagnostic = format!(
                "本次扫描源文件不稳定，重试后仍失败；已保留上次索引：{first_error}; {second_error}"
            );
            if let Some(mut record) = cached {
                record.source_state = file.source_state;
                record.scan_status = CalendarIndexScanStatus::Partial;
                record.updated_at = Utc::now();
                Ok(ScanOutcome {
                    record: Some(record),
                    diagnostic: Some(diagnostic),
                })
            } else {
                Ok(ScanOutcome {
                    record: None,
                    diagnostic: Some(diagnostic),
                })
            }
        }
    }
}

async fn emit_index_status(app: &AppHandle, runtime: &CalendarRuntime, status: &CodexIndexStatus) {
    *runtime.status.lock().await = status.clone();
    let _ = app.emit(INDEX_EVENT, status);
}

fn merge_index_record(
    staged: &mut HashMap<String, CodexSessionIndexRecord>,
    candidate: CodexSessionIndexRecord,
) {
    let replace = staged.get(&candidate.session_id).is_none_or(|current| {
        let source_priority = |state| match state {
            CalendarSourceState::Active => 2,
            CalendarSourceState::Archived => 1,
            _ => 0,
        };
        source_priority(candidate.source_state) > source_priority(current.source_state)
            || (candidate.source_state == current.source_state
                && candidate.source_file_mtime_ns > current.source_file_mtime_ns)
    });
    if replace {
        staged.insert(candidate.session_id.clone(), candidate);
    }
}

async fn commit_index_batch<'a>(
    repository: &Repository,
    records: impl Iterator<Item = &'a CodexSessionIndexRecord>,
    now: DateTime<Utc>,
) -> AtlasResult<()> {
    let records: Vec<_> = records.cloned().collect();
    let seen: HashSet<_> = records
        .iter()
        .map(|record| record.session_id.clone())
        .collect();
    repository
        .commit_codex_session_index_scan(&records, &seen, now)
        .await
}

fn discover_rollouts(codex_home: &Path) -> AtlasResult<Vec<DiscoveredFile>> {
    let mut files = Vec::new();
    walk_rollouts(
        &codex_home.join("sessions"),
        CalendarSourceState::Active,
        &mut files,
    )?;
    walk_rollouts(
        &codex_home.join("archived_sessions"),
        CalendarSourceState::Archived,
        &mut files,
    )?;
    Ok(files)
}

fn walk_rollouts(
    root: &Path,
    source_state: CalendarSourceState,
    output: &mut Vec<DiscoveredFile>,
) -> AtlasResult<()> {
    if let Ok(metadata) = fs::symlink_metadata(root)
        && metadata.file_type().is_symlink()
    {
        return Ok(());
    }
    let read_dir = match fs::read_dir(root) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in read_dir {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            walk_rollouts(&path, source_state, output)?;
            continue;
        }
        if !file_type.is_file() || !is_rollout_filename(&path) {
            continue;
        }
        let metadata = entry.metadata()?;
        output.push(DiscoveredFile {
            path: fs::canonicalize(path)?,
            source_state,
            signature: signature_from_metadata(&metadata)?,
        });
    }
    Ok(())
}

fn is_rollout_filename(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
}

fn signature_from_metadata(metadata: &Metadata) -> AtlasResult<FileSignature> {
    let modified = metadata.modified()?;
    let mtime_ns = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| AtlasError::InvalidInput(format!("文件修改时间早于 Unix epoch：{error}")))?
        .as_nanos();
    Ok(FileSignature {
        size: metadata.len(),
        mtime_ns: i64::try_from(mtime_ns)
            .map_err(|_| AtlasError::InvalidInput("文件修改时间超出可记录范围".into()))?,
    })
}

fn load_title_hints(path: &Path) -> HashMap<String, String> {
    let Ok(file) = File::open(path) else {
        return HashMap::new();
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .filter_map(|value| {
            Some((
                value.get("id")?.as_str()?.to_string(),
                value.get("thread_name")?.as_str()?.trim().to_string(),
            ))
        })
        .filter(|(_, title)| !title.is_empty())
        .collect()
}

fn scan_rollout_file(
    file: &DiscoveredFile,
    title_hints: &HashMap<String, String>,
    cancel: &AtomicBool,
) -> AtlasResult<ScanOutcome> {
    if cancel.load(Ordering::Relaxed) {
        return Err(AtlasError::Cancelled);
    }
    let (authoritative_session_id, first_user_title, session_kind) = scan_head(&file.path, cancel)?;
    let inferred = authoritative_session_id.is_none();
    let inferred_id = infer_session_id_from_filename(&file.path);
    let Some(session_id) = authoritative_session_id.or(inferred_id) else {
        return Ok(ScanOutcome {
            record: None,
            diagnostic: Some("session_meta 与文件名均没有合法 session ID".into()),
        });
    };
    if Uuid::parse_str(&session_id).is_err() {
        return Ok(ScanOutcome {
            record: None,
            diagnostic: Some("session ID 不是合法 UUID".into()),
        });
    }
    let tail = scan_tail(&file.path, cancel)?;
    let end_metadata = fs::symlink_metadata(&file.path)?;
    if !end_metadata.is_file() || end_metadata.file_type().is_symlink() {
        return Err(AtlasError::InvalidInput(format!(
            "索引期间源会话不再是普通文件：{}",
            file.path.display()
        )));
    }
    let end_signature = signature_from_metadata(&end_metadata)?;
    if end_signature != file.signature {
        return Err(AtlasError::InvalidInput(format!(
            "索引期间源会话发生变化：{}",
            file.path.display()
        )));
    }
    let partial_time = tail
        .last_visible
        .as_ref()
        .is_some_and(|message| message.time_status != crate::domain::TimeStatus::Valid)
        || tail
            .last_final
            .as_ref()
            .is_some_and(|message| message.time_status != crate::domain::TimeStatus::Valid);
    let Some(last_message) = tail.last_visible else {
        return Ok(ScanOutcome {
            record: None,
            diagnostic: Some("没有可见 user/assistant 消息".into()),
        });
    };
    let title = title_hints
        .get(&session_id)
        .cloned()
        .or(first_user_title)
        .unwrap_or_else(|| "未命名 Codex 对话".into());
    Ok(ScanOutcome {
        record: Some(CodexSessionIndexRecord {
            session_id: session_id.clone(),
            canonical_path: file.path.to_string_lossy().to_string(),
            title: truncate_title(&title),
            last_activity_at: last_message.occurred_at_utc,
            last_completed_turn_at: tail.last_final.and_then(|item| item.occurred_at_utc),
            last_message_id: last_message.external_id,
            source_state: file.source_state,
            source_file_size: file.signature.size,
            source_file_mtime_ns: file.signature.mtime_ns,
            scan_status: if tail.oversized_records > 0 || tail.incomplete_tail || partial_time {
                CalendarIndexScanStatus::Partial
            } else {
                CalendarIndexScanStatus::Ready
            },
            session_id_inferred: inferred,
            session_kind,
            updated_at: Utc::now(),
        }),
        diagnostic: if tail.incomplete_tail {
            Some("源会话末尾仍在写入；不完整记录未推进活动时间".into())
        } else if partial_time {
            Some("末可见消息或最后完成回复缺少有效时间".into())
        } else {
            (tail.oversized_records > 0)
                .then(|| format!("跳过 {} 条超大非预览记录", tail.oversized_records))
        },
    })
}

fn truncate_title(value: &str) -> String {
    let value = strip_leading_skill_reference(value);
    let title: String = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect();
    if title.is_empty() {
        "未命名 Codex 对话".into()
    } else {
        title
    }
}

fn strip_leading_skill_reference(value: &str) -> &str {
    let mut remaining = value.trim_start();
    loop {
        if !remaining.starts_with("[$") {
            return remaining;
        }
        let Some(label_end) = remaining.find("](") else {
            return remaining;
        };
        let destination_start = label_end + 2;
        let Some(destination_end_offset) = remaining[destination_start..].find(')') else {
            return remaining;
        };
        let destination_end = destination_start + destination_end_offset;
        let destination = &remaining[destination_start..destination_end];
        if !destination.replace('\\', "/").ends_with("/SKILL.md") {
            return remaining;
        }
        remaining = remaining[destination_end + 1..].trim_start();
    }
}

fn infer_session_id_from_filename(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    (stem.len() >= 36)
        .then(|| &stem[stem.len() - 36..])
        .filter(|candidate| Uuid::parse_str(candidate).is_ok())
        .map(ToOwned::to_owned)
}

fn scan_head(
    path: &Path,
    cancel: &AtomicBool,
) -> AtlasResult<(Option<String>, Option<String>, CodexSessionKind)> {
    let file = File::open(path)?;
    let reader = CancelReader::new(file, cancel, None);
    let mut stream = serde_json::Deserializer::from_reader(reader).into_iter::<MinimalRecord>();
    let mut selected_file = File::open(path)?;
    let mut record_start = 0u64;
    let mut session_id = None;
    let mut title = None;
    let mut session_kind = CodexSessionKind::Unknown;
    while let Some(record) = stream.next() {
        if cancel.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        let record = match record {
            Ok(record) => record,
            Err(error) if error.is_eof() => break,
            Err(error) => return Err(AtlasError::Json(error)),
        };
        let record_end = stream.byte_offset() as u64;
        let record = hydrate_visible_record_from_range(
            record,
            &mut selected_file,
            record_start,
            record_end,
            cancel,
            false,
        )?;
        record_start = record_end;
        if session_kind == CodexSessionKind::Unknown {
            session_kind = classify_session_record(&record);
        }
        let value = serde_json::to_value(record)?;
        session_id = session_id.or_else(|| parse_rollout_session_id(&value));
        if title.is_none()
            && let Some(message) = parse_rollout_visible_record(&value)
            && message.speaker == Speaker::User
        {
            title = Some(truncate_title(&message.visible_text));
        }
        if session_id.is_some() && title.is_some() || stream.byte_offset() as u64 >= HEAD_SCAN_LIMIT
        {
            break;
        }
    }
    Ok((session_id, title, session_kind))
}

fn classify_session_record(record: &MinimalRecord) -> CodexSessionKind {
    if record.kind.as_deref() != Some("session_meta") {
        return CodexSessionKind::Unknown;
    }
    let Some(payload) = record.payload.as_ref() else {
        return CodexSessionKind::Unknown;
    };
    if payload.thread_source.as_deref() == Some("subagent")
        || payload
            .source
            .as_ref()
            .is_some_and(|source| source.has_subagent)
    {
        CodexSessionKind::Internal
    } else {
        CodexSessionKind::Primary
    }
}

#[derive(Debug)]
struct TailScan {
    last_visible: Option<crate::import::ParsedVisibleMessage>,
    last_final: Option<crate::import::ParsedVisibleMessage>,
    oversized_records: usize,
    incomplete_tail: bool,
}

fn scan_tail(path: &Path, cancel: &AtomicBool) -> AtlasResult<TailScan> {
    let mut file = File::open(path)?;
    let mut position = file.metadata()?.len();
    let mut fragment = Vec::new();
    let mut fragment_oversized = false;
    let mut result = TailScan {
        last_visible: None,
        last_final: None,
        oversized_records: 0,
        incomplete_tail: false,
    };
    let mut block = vec![0u8; READ_BUFFER_BYTES];
    while position > 0 && (result.last_visible.is_none() || result.last_final.is_none()) {
        if cancel.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        let read_len = usize::try_from(position.min(READ_BUFFER_BYTES as u64)).unwrap();
        position -= read_len as u64;
        file.seek(SeekFrom::Start(position))?;
        file.read_exact(&mut block[..read_len])?;
        let bytes = &block[..read_len];
        if let Some(last_newline) = bytes.iter().rposition(|byte| *byte == b'\n') {
            let suffix = &bytes[last_newline + 1..];
            if fragment_oversized || suffix.len() + fragment.len() > MAX_REVERSE_RECORD_BYTES {
                result.oversized_records += 1;
            } else {
                let mut line = Vec::with_capacity(suffix.len() + fragment.len());
                line.extend_from_slice(suffix);
                line.extend_from_slice(&fragment);
                consider_reverse_line(&line, &mut result)?;
            }
            let prefix_and_lines = &bytes[..last_newline];
            let mut pieces = prefix_and_lines
                .split(|byte| *byte == b'\n')
                .collect::<Vec<_>>();
            let prefix = pieces.first().copied().unwrap_or_default();
            for line in pieces.drain(1..).rev() {
                if line.len() > MAX_REVERSE_RECORD_BYTES {
                    result.oversized_records += 1;
                } else {
                    consider_reverse_line(line, &mut result)?;
                }
                if result.last_visible.is_some() && result.last_final.is_some() {
                    break;
                }
            }
            fragment = prefix.to_vec();
            fragment_oversized = fragment.len() > MAX_REVERSE_RECORD_BYTES;
            if fragment_oversized {
                fragment.clear();
            }
        } else if !fragment_oversized {
            if bytes.len() + fragment.len() > MAX_REVERSE_RECORD_BYTES {
                fragment.clear();
                fragment_oversized = true;
            } else {
                let mut joined = Vec::with_capacity(bytes.len() + fragment.len());
                joined.extend_from_slice(bytes);
                joined.extend_from_slice(&fragment);
                fragment = joined;
            }
        }
    }
    if position == 0 && (result.last_visible.is_none() || result.last_final.is_none()) {
        if fragment_oversized {
            result.oversized_records += 1;
        } else {
            consider_reverse_line(&fragment, &mut result)?;
        }
    }
    if result.oversized_records > 0 {
        return scan_tail_forward(path, cancel);
    }
    Ok(result)
}

fn scan_tail_forward(path: &Path, cancel: &AtomicBool) -> AtlasResult<TailScan> {
    let reader = CancelReader::new(
        BufReader::with_capacity(READ_BUFFER_BYTES, File::open(path)?),
        cancel,
        None,
    );
    let mut stream = serde_json::Deserializer::from_reader(reader).into_iter::<MinimalRecord>();
    let mut selected_file = File::open(path)?;
    let mut record_start = 0u64;
    let mut result = TailScan {
        last_visible: None,
        last_final: None,
        oversized_records: 0,
        incomplete_tail: false,
    };
    while let Some(item) = stream.next() {
        if cancel.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        let record = match item {
            Ok(record) => record,
            Err(error) if error.is_eof() => {
                result.incomplete_tail = true;
                break;
            }
            Err(error) => return Err(AtlasError::Json(error)),
        };
        let record_end = stream.byte_offset() as u64;
        let record = hydrate_visible_record_from_range(
            record,
            &mut selected_file,
            record_start,
            record_end,
            cancel,
            false,
        )?;
        record_start = record_end;
        let value = serde_json::to_value(record)?;
        if let Some(message) = parse_rollout_visible_record(&value) {
            if message.phase.as_deref() == Some("final") {
                result.last_final = Some(message.clone());
            }
            result.last_visible = Some(message);
        }
    }
    Ok(result)
}

fn consider_reverse_line(line: &[u8], result: &mut TailScan) -> AtlasResult<()> {
    if line.iter().all(u8::is_ascii_whitespace) {
        return Ok(());
    }
    let record: MinimalRecord = match serde_json::from_slice(line) {
        Ok(record) => record,
        Err(error) if error.is_eof() => {
            result.incomplete_tail = true;
            return Ok(());
        }
        Err(_) => return Ok(()),
    };
    let record = hydrate_visible_record_from_slice(record, line, false)?;
    let value = serde_json::to_value(record)?;
    let Some(message) = parse_rollout_visible_record(&value) else {
        return Ok(());
    };
    if result.last_visible.is_none() {
        result.last_visible = Some(message.clone());
    }
    if result.last_final.is_none() && message.phase.as_deref() == Some("final") {
        result.last_final = Some(message);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
struct MinimalRecord {
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    timestamp: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload: Option<MinimalPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    record_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

impl<'de> Deserialize<'de> for MinimalRecord {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        MinimalRecordSeed {
            capture_payload_content: false,
            capture_top_level_text: false,
        }
        .deserialize(deserializer)
    }
}

/// Deserializes the small routing metadata for every record, but only captures
/// payload content after a metadata-only pass has proved that the record is a
/// visible user/assistant message. This makes JSON key order irrelevant without
/// allocating developer, tool, or reasoning bodies.
struct MinimalRecordSeed {
    capture_payload_content: bool,
    capture_top_level_text: bool,
}

impl<'de> DeserializeSeed<'de> for MinimalRecordSeed {
    type Value = MinimalRecord;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RecordVisitor {
            capture_payload_content: bool,
            capture_top_level_text: bool,
        }

        impl<'de> Visitor<'de> for RecordVisitor {
            type Value = MinimalRecord;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a Codex JSONL record object")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut record = MinimalRecord {
                    kind: None,
                    timestamp: None,
                    payload: None,
                    record_type: None,
                    scope: None,
                    thread_id: None,
                    title: None,
                    turn_id: None,
                    message_id: None,
                    role: None,
                    phase: None,
                    text: None,
                };
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => record.kind = map.next_value()?,
                        "timestamp" => record.timestamp = map.next_value()?,
                        "payload" => {
                            record.payload = map.next_value_seed(OptionalMinimalPayloadSeed {
                                capture_content: self.capture_payload_content,
                            })?
                        }
                        "record_type" => record.record_type = map.next_value()?,
                        "scope" => record.scope = map.next_value()?,
                        "thread_id" => record.thread_id = map.next_value()?,
                        "title" => record.title = map.next_value()?,
                        "turn_id" => record.turn_id = map.next_value()?,
                        "message_id" => record.message_id = map.next_value()?,
                        "role" => record.role = map.next_value()?,
                        "phase" => record.phase = map.next_value()?,
                        "text" if self.capture_top_level_text => record.text = map.next_value()?,
                        _ => {
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }
                Ok(record)
            }
        }

        deserializer.deserialize_map(RecordVisitor {
            capture_payload_content: self.capture_payload_content,
            capture_top_level_text: self.capture_top_level_text,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
struct MinimalPayload {
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    thread_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source: Option<MinimalSessionSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    internal_chat_message_metadata_passthrough: Option<MinimalMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content: Option<MinimalContent>,
}

#[derive(Debug, Clone, Serialize)]
struct MinimalSessionSource {
    has_subagent: bool,
}

impl<'de> Deserialize<'de> for MinimalSessionSource {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct SourceVisitor;

        impl<'de> Visitor<'de> for SourceVisitor {
            type Value = MinimalSessionSource;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("any Codex session source representation")
            }

            fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_string<E>(self, _value: String) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(MinimalSessionSource {
                    has_subagent: false,
                })
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut has_subagent = false;
                while let Some(key) = map.next_key::<String>()? {
                    if key == "subagent" {
                        map.next_value::<IgnoredAny>()?;
                        has_subagent = true;
                    } else {
                        map.next_value::<IgnoredAny>()?;
                    }
                }
                Ok(MinimalSessionSource { has_subagent })
            }
        }

        deserializer.deserialize_any(SourceVisitor)
    }
}

impl<'de> Deserialize<'de> for MinimalPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        MinimalPayloadSeed {
            capture_content: false,
        }
        .deserialize(deserializer)
    }
}

struct MinimalPayloadSeed {
    capture_content: bool,
}

struct OptionalMinimalPayloadSeed {
    capture_content: bool,
}

impl<'de> DeserializeSeed<'de> for OptionalMinimalPayloadSeed {
    type Value = Option<MinimalPayload>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct OptionalPayloadVisitor {
            capture_content: bool,
        }

        impl<'de> Visitor<'de> for OptionalPayloadVisitor {
            type Value = Option<MinimalPayload>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a Codex rollout payload object or null")
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(None)
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(None)
            }

            fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
            where
                D: Deserializer<'de>,
            {
                MinimalPayloadSeed {
                    capture_content: self.capture_content,
                }
                .deserialize(deserializer)
                .map(Some)
            }
        }

        deserializer.deserialize_option(OptionalPayloadVisitor {
            capture_content: self.capture_content,
        })
    }
}

impl<'de> DeserializeSeed<'de> for MinimalPayloadSeed {
    type Value = MinimalPayload;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct PayloadVisitor {
            capture_content: bool,
        }

        impl<'de> Visitor<'de> for PayloadVisitor {
            type Value = MinimalPayload;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a Codex rollout payload object")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut payload = MinimalPayload {
                    kind: None,
                    id: None,
                    session_id: None,
                    message_id: None,
                    turn_id: None,
                    role: None,
                    phase: None,
                    thread_source: None,
                    source: None,
                    internal_chat_message_metadata_passthrough: None,
                    content: None,
                };
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "type" => payload.kind = map.next_value()?,
                        "id" => payload.id = map.next_value()?,
                        "session_id" => payload.session_id = map.next_value()?,
                        "message_id" => payload.message_id = map.next_value()?,
                        "turn_id" => payload.turn_id = map.next_value()?,
                        "role" => payload.role = map.next_value()?,
                        "phase" => payload.phase = map.next_value()?,
                        "thread_source" => payload.thread_source = map.next_value()?,
                        "source" => payload.source = map.next_value()?,
                        "internal_chat_message_metadata_passthrough" => {
                            payload.internal_chat_message_metadata_passthrough = map.next_value()?
                        }
                        "content" if self.capture_content => payload.content = map.next_value()?,
                        _ => {
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }
                Ok(payload)
            }
        }

        deserializer.deserialize_map(PayloadVisitor {
            capture_content: self.capture_content,
        })
    }
}

fn is_visible_rollout_candidate(record: &MinimalRecord) -> bool {
    record.kind.as_deref() == Some("response_item")
        && record.payload.as_ref().is_some_and(|payload| {
            payload.kind.as_deref() == Some("message")
                && matches!(payload.role.as_deref(), Some("user" | "assistant"))
        })
}

fn is_visible_export_candidate(record: &MinimalRecord) -> bool {
    matches!(record.record_type.as_deref(), None | Some("message"))
        && record.turn_id.is_some()
        && record.message_id.is_some()
        && matches!(record.role.as_deref(), Some("user" | "assistant"))
}

fn hydrate_visible_record_from_range(
    record: MinimalRecord,
    file: &mut File,
    start: u64,
    end: u64,
    cancel: &AtomicBool,
    allow_visible_export: bool,
) -> AtlasResult<MinimalRecord> {
    let capture_payload_content = is_visible_rollout_candidate(&record);
    let capture_top_level_text = allow_visible_export && is_visible_export_candidate(&record);
    if !capture_payload_content && !capture_top_level_text {
        return Ok(record);
    }
    file.seek(SeekFrom::Start(start))?;
    let reader = CancelReader::new((&mut *file).take(end.saturating_sub(start)), cancel, None);
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    let selected = MinimalRecordSeed {
        capture_payload_content,
        capture_top_level_text,
    }
    .deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(selected)
}

fn hydrate_visible_record_from_slice(
    record: MinimalRecord,
    bytes: &[u8],
    allow_visible_export: bool,
) -> AtlasResult<MinimalRecord> {
    let capture_payload_content = is_visible_rollout_candidate(&record);
    let capture_top_level_text = allow_visible_export && is_visible_export_candidate(&record);
    if !capture_payload_content && !capture_top_level_text {
        return Ok(record);
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let selected = MinimalRecordSeed {
        capture_payload_content,
        capture_top_level_text,
    }
    .deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(selected)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum MinimalContent {
    Text(String),
    Parts(Vec<MinimalContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MinimalMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MinimalContentPart {
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

struct CancelReader<'a, R> {
    inner: R,
    cancel: &'a AtomicBool,
    progress: Option<Arc<AtomicU64>>,
    hasher: Option<Arc<StdMutex<Sha256>>>,
}

impl<'a, R> CancelReader<'a, R> {
    fn new(inner: R, cancel: &'a AtomicBool, progress: Option<Arc<AtomicU64>>) -> Self {
        Self {
            inner,
            cancel,
            progress,
            hasher: None,
        }
    }

    fn with_hasher(mut self, hasher: Arc<StdMutex<Sha256>>) -> Self {
        self.hasher = Some(hasher);
        self
    }
}

impl<R: Read> Read for CancelReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "preview cancelled",
            ));
        }
        let read = self.inner.read(buffer)?;
        if read > 0 {
            if let Some(progress) = &self.progress {
                progress.fetch_add(read as u64, Ordering::Relaxed);
            }
            if let Some(hasher) = &self.hasher {
                hasher
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .update(&buffer[..read]);
            }
        }
        Ok(read)
    }
}

pub fn stream_import_preview<R: Runtime>(
    app: &AppHandle<R>,
    preview_id: &str,
    path: &Path,
    title: String,
    expected_session_id: Option<String>,
    cancel: &AtomicBool,
) -> AtlasResult<ImportPreview> {
    let start_metadata = fs::symlink_metadata(path)?;
    if !start_metadata.is_file() || start_metadata.file_type().is_symlink() {
        return Err(AtlasError::InvalidInput(
            "源会话不是可读取的普通 JSONL 文件".into(),
        ));
    }
    let start_signature = signature_from_metadata(&start_metadata)?;
    let total = start_signature.size;
    let progress = Arc::new(AtomicU64::new(0));
    let hasher = Arc::new(StdMutex::new(Sha256::new()));
    let reader = CancelReader::new(
        BufReader::with_capacity(READ_BUFFER_BYTES, File::open(path)?),
        cancel,
        Some(progress.clone()),
    )
    .with_hasher(hasher.clone());
    let mut stream = serde_json::Deserializer::from_reader(reader).into_iter::<MinimalRecord>();
    let mut selected_file = File::open(path)?;
    let mut record_start = 0u64;
    let mut messages: Vec<SourceMessage> = Vec::new();
    let mut seen = HashSet::new();
    let mut warnings = Vec::new();
    let mut duplicate_message_count = 0usize;
    let mut source_format = SourceFormat::RawRollout;
    let expected_session_id = expected_session_id;
    let mut session_id = None;
    let mut resolved_title = title;
    let mut flat_export = false;
    let mut event_index = 0usize;
    let mut turn_count = 0usize;
    let mut last_speaker = None;
    let mut chars = 0usize;
    let mut last_emit = 0u64;
    let mut source_still_writing = false;
    while let Some(item) = stream.next() {
        if cancel.load(Ordering::Relaxed) {
            return Err(AtlasError::Cancelled);
        }
        let record = match item {
            Ok(record) => record,
            Err(error) if error.is_eof() => {
                warnings.push("源会话末尾仍在写入；不完整记录未进入预览".into());
                source_still_writing = true;
                break;
            }
            Err(error) => return Err(AtlasError::Json(error)),
        };
        let record_end = stream.byte_offset() as u64;
        let record = hydrate_visible_record_from_range(
            record,
            &mut selected_file,
            record_start,
            record_end,
            cancel,
            flat_export,
        )?;
        record_start = record_end;
        let value = serde_json::to_value(record)?;
        if event_index == 0 {
            let serialized = serde_json::to_string(&value)?;
            if let Some(header) = detect_visible_conversation_export_header(&serialized) {
                source_format = SourceFormat::VisibleExport;
                session_id = header.external_session_id;
                if let Some(header_title) = header.title {
                    resolved_title = header_title;
                }
                flat_export = true;
            }
        }
        if session_id.is_none() && !flat_export {
            session_id = parse_rollout_session_id(&value);
        }
        let parsed = if flat_export {
            extract_flat_visible_message(&value)
        } else {
            parse_rollout_visible_record(&value)
        };
        if let Some(parsed) = parsed {
            if let Some(external_id) = parsed.external_id.as_ref()
                && !seen.insert(external_id.clone())
            {
                duplicate_message_count += 1;
                event_index += 1;
                continue;
            }
            chars += parsed.visible_text.chars().count();
            if chars > MAX_TRANSCRIPT_CHARS {
                return Err(AtlasError::InvalidInput(format!(
                    "对话超过 {MAX_TRANSCRIPT_CHARS} 字符；请拆分后再导入，不会静默截断"
                )));
            }
            if last_speaker != Some(parsed.speaker) || parsed.speaker == Speaker::User {
                turn_count += 1;
                last_speaker = Some(parsed.speaker);
            }
            if turn_count > MAX_VISIBLE_TURNS {
                return Err(AtlasError::InvalidInput(format!(
                    "可见轮次超过 {MAX_VISIBLE_TURNS}；请拆分后再导入，不会静默截断"
                )));
            }
            messages.push(make_message(
                messages.len(),
                parsed.speaker,
                parsed.phase,
                parsed.external_id,
                parsed.external_turn_id,
                Some(event_index),
                parsed.occurred_at_utc,
                parsed.occurred_at_raw,
                parsed.time_status,
                parsed.visible_text,
            ));
        }
        event_index += 1;
        let completed = progress.load(Ordering::Relaxed);
        if completed.saturating_sub(last_emit) >= 4 * 1024 * 1024 {
            last_emit = completed;
            let _ = app.emit(
                PREVIEW_PROGRESS_EVENT,
                ImportPreviewProgress {
                    preview_id: preview_id.into(),
                    completed_bytes: completed.min(total),
                    total_bytes: total,
                    message: "正在本地读取可见消息".into(),
                },
            );
        }
    }
    if messages.is_empty() {
        return Err(AtlasError::InvalidInput(
            "没有找到支持的可见 user/assistant 消息".into(),
        ));
    }
    if duplicate_message_count > 0 {
        warnings.push(format!(
            "已跳过 {duplicate_message_count} 条重复消息 ID 记录"
        ));
    }
    if let (Some(expected), Some(actual)) = (expected_session_id.as_deref(), session_id.as_deref())
        && expected != actual
    {
        return Err(AtlasError::InvalidInput(
            "索引 session ID 与源文件 session_meta 不一致；预览已拒绝".into(),
        ));
    }
    if session_id.is_none() && source_format == SourceFormat::RawRollout {
        session_id = expected_session_id.or_else(|| infer_session_id_from_filename(path));
    }
    let end_metadata = fs::symlink_metadata(path)?;
    let end_signature = signature_from_metadata(&end_metadata)?;
    if end_signature != start_signature {
        return Err(AtlasError::InvalidInput(
            "源会话在预览期间发生变化；此次预览已丢弃，请重新读取".into(),
        ));
    }
    let digest = hasher
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
        .finalize();
    let mut preview = make_preview(
        "codex_jsonl",
        source_format,
        resolved_title,
        Some(path.to_string_lossy().to_string()),
        format!("{digest:x}"),
        session_id,
        messages,
        warnings,
    )?;
    // The signature becomes a commit-time optimistic concurrency guard.
    preview.id = preview_id.into();
    preview.source_file_size = Some(start_signature.size);
    preview.source_file_mtime_ns = Some(start_signature.mtime_ns);
    preview.source_still_writing = source_still_writing;
    let _ = app.emit(
        PREVIEW_PROGRESS_EVENT,
        ImportPreviewProgress {
            preview_id: preview_id.into(),
            completed_bytes: total,
            total_bytes: total,
            message: "本地预览已完成".into(),
        },
    );
    Ok(preview)
}

pub fn verify_preview_source_unchanged(preview: &ImportPreview) -> AtlasResult<()> {
    let (Some(path), Some(expected_size), Some(expected_mtime)) = (
        preview.source_path.as_deref(),
        preview.source_file_size,
        preview.source_file_mtime_ns,
    ) else {
        return Ok(());
    };
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AtlasError::InvalidInput("源会话文件已不可用".into()));
    }
    let signature = signature_from_metadata(&metadata)?;
    if signature.size != expected_size || signature.mtime_ns != expected_mtime {
        return Err(AtlasError::InvalidInput(
            "源会话自预览后已更新；请重新读取新版本".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use chrono::DateTime;

    use super::*;
    use crate::import::preview_codex_jsonl_content;

    struct TestRollout {
        dir: PathBuf,
        path: PathBuf,
    }

    impl TestRollout {
        fn create(file_session_id: &str, body: impl FnOnce(&mut File)) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("dialogue-atlas-calendar-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!(
                "rollout-2026-08-13T00-00-00-{file_session_id}.jsonl"
            ));
            let mut file = File::create(&path).unwrap();
            body(&mut file);
            file.flush().unwrap();
            Self { dir, path }
        }

        fn discovered(&self) -> DiscoveredFile {
            let metadata = fs::metadata(&self.path).unwrap();
            DiscoveredFile {
                path: fs::canonicalize(&self.path).unwrap(),
                source_state: CalendarSourceState::Active,
                signature: signature_from_metadata(&metadata).unwrap(),
            }
        }
    }

    impl Drop for TestRollout {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn visible(timestamp: &str, role: &str, phase: &str, id: &str, text: &str) -> String {
        let part_type = if role == "user" {
            "input_text"
        } else {
            "output_text"
        };
        format!(
            "{{\"timestamp\":{},\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":{},\"phase\":{},\"id\":{},\"content\":[{{\"type\":{},\"text\":{}}}]}}}}",
            serde_json::to_string(timestamp).unwrap(),
            serde_json::to_string(role).unwrap(),
            serde_json::to_string(phase).unwrap(),
            serde_json::to_string(id).unwrap(),
            serde_json::to_string(part_type).unwrap(),
            serde_json::to_string(text).unwrap(),
        )
    }

    #[test]
    fn authoritative_session_meta_is_not_marked_inferred() {
        let filename_id = Uuid::new_v4().to_string();
        let authoritative_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&filename_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({
                    "type":"session_meta",
                    "payload":{"id":authoritative_id,"parent_thread_id":Uuid::new_v4()}
                })
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible("2026-08-08T11:50:14.446Z", "user", "", "u1", "真实标题")
            )
            .unwrap();
        });
        let outcome = scan_rollout_file(
            &rollout.discovered(),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let record = outcome
            .record
            .unwrap_or_else(|| panic!("{:?}", outcome.diagnostic));
        assert_eq!(record.session_id, authoritative_id);
        assert!(!record.session_id_inferred);
        assert_eq!(record.title, "真实标题");
        assert_eq!(record.session_kind, CodexSessionKind::Primary);
    }

    #[test]
    fn classifies_subagents_from_structured_session_metadata() {
        let guardian_id = Uuid::new_v4().to_string();
        let guardian = TestRollout::create(&guardian_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({
                    "type":"session_meta",
                    "payload":{
                        "id":guardian_id,
                        "thread_source":"subagent",
                        "source":{"subagent":{"other":"guardian"}},
                        "parent_thread_id":Uuid::new_v4()
                    }
                })
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible(
                    "2026-08-08T11:50:14.446Z",
                    "user",
                    "",
                    "u1",
                    "The following is the Codex agent history"
                )
            )
            .unwrap();
        });
        let record = scan_rollout_file(
            &guardian.discovered(),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap()
        .record
        .unwrap();
        assert_eq!(record.session_kind, CodexSessionKind::Internal);

        let spawned_id = Uuid::new_v4().to_string();
        let spawned = TestRollout::create(&spawned_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({
                    "type":"session_meta",
                    "payload":{
                        "id":spawned_id,
                        "source":{"subagent":{"thread_spawn":{"depth":1}}}
                    }
                })
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible("2026-08-08T11:50:14.446Z", "user", "", "u1", "子任务")
            )
            .unwrap();
        });
        let record = scan_rollout_file(
            &spawned.discovered(),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap()
        .record
        .unwrap();
        assert_eq!(record.session_kind, CodexSessionKind::Internal);
    }

    #[test]
    fn string_source_is_primary_and_skill_attachment_is_removed_from_title() {
        let session_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&session_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({
                    "type":"session_meta",
                    "payload":{"id":session_id,"thread_source":"user","source":"vscode"}
                })
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible(
                    "2026-08-08T11:50:14.446Z",
                    "user",
                    "",
                    "u1",
                    "[$visual-product](/Users/example/.codex/skills/visual-product/SKILL.md) 我想做一个对话工具"
                )
            )
            .unwrap();
        });
        let record = scan_rollout_file(
            &rollout.discovered(),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap()
        .record
        .unwrap();
        assert_eq!(record.session_kind, CodexSessionKind::Primary);
        assert_eq!(record.title, "我想做一个对话工具");

        let file = rollout.discovered();
        assert!(can_reuse_cached_index(&record, &file));
        let mut migrated_unknown = record.clone();
        migrated_unknown.session_kind = CodexSessionKind::Unknown;
        assert!(!can_reuse_cached_index(&migrated_unknown, &file));

        let hinted = scan_rollout_file(
            &file,
            &HashMap::from([(
                session_id,
                "[$first](/tmp/first/SKILL.md) [$second](C:\\skills\\second\\SKILL.md) 清理后的标题"
                    .into(),
            )]),
            &AtomicBool::new(false),
        )
        .unwrap()
        .record
        .unwrap();
        assert_eq!(hinted.title, "清理后的标题");
    }

    #[test]
    fn oversized_non_visible_records_are_skipped_and_late_routing_keys_still_parse() {
        let session_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&session_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({"type":"session_meta","payload":{"id":session_id}})
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible("2026-08-08T01:00:00Z", "user", "", "u1", "问题")
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible("2026-08-08T01:30:00Z", "assistant", "final", "a1", "答案")
            )
            .unwrap();
            let giant = "x".repeat(MAX_REVERSE_RECORD_BYTES + 1024);
            write!(
                file,
                "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"developer\",\"content\":\""
            )
            .unwrap();
            file.write_all(giant.as_bytes()).unwrap();
            writeln!(file, "\"}}}}").unwrap();
            write!(
                file,
                "{{\"type\":\"response_item\",\"payload\":{{\"content\":\""
            )
            .unwrap();
            file.write_all(giant.as_bytes()).unwrap();
            writeln!(file, "\",\"type\":\"function_call_output\"}}}}").unwrap();
            writeln!(
                file,
                r#"{{"timestamp":"2026-08-08T02:00:00Z","payload":{{"content":[{{"text":"继续处理","type":"output_text"}}],"id":"a2","phase":"commentary","role":"assistant","type":"message"}},"type":"response_item"}}"#
            )
            .unwrap();
        });
        let outcome = scan_rollout_file(
            &rollout.discovered(),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let record = outcome
            .record
            .unwrap_or_else(|| panic!("{:?}", outcome.diagnostic));
        assert_eq!(
            record.last_activity_at,
            Some(
                DateTime::parse_from_rfc3339("2026-08-08T02:00:00Z")
                    .unwrap()
                    .to_utc()
            )
        );
        assert_eq!(
            record.last_completed_turn_at,
            Some(
                DateTime::parse_from_rfc3339("2026-08-08T01:30:00Z")
                    .unwrap()
                    .to_utc()
            )
        );
        assert_eq!(record.scan_status, CalendarIndexScanStatus::Ready);
    }

    #[test]
    fn incomplete_tail_is_partial_and_does_not_advance_activity() {
        let session_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&session_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({"type":"session_meta","payload":{"id":session_id}})
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible("2026-08-08T03:00:00Z", "assistant", "final", "a1", "完成")
            )
            .unwrap();
            write!(file, "{{\"timestamp\":\"2026-08-08T04:00:00Z\"").unwrap();
        });
        let outcome = scan_rollout_file(
            &rollout.discovered(),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let record = outcome
            .record
            .unwrap_or_else(|| panic!("{:?}", outcome.diagnostic));
        assert_eq!(record.scan_status, CalendarIndexScanStatus::Partial);
        assert_eq!(
            record.last_activity_at,
            Some(
                DateTime::parse_from_rfc3339("2026-08-08T03:00:00Z")
                    .unwrap()
                    .to_utc()
            )
        );
        assert!(outcome.diagnostic.unwrap().contains("仍在写入"));
    }

    #[test]
    fn unstable_or_invalid_file_preserves_cached_index_after_one_retry() {
        let session_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&session_id, |file| {
            writeln!(file, "this is not json").unwrap();
        });
        let cached = CodexSessionIndexRecord {
            session_id: session_id.clone(),
            canonical_path: rollout.path.to_string_lossy().into_owned(),
            title: "上次完整索引".into(),
            last_activity_at: Some(
                DateTime::parse_from_rfc3339("2026-08-08T03:00:00Z")
                    .unwrap()
                    .to_utc(),
            ),
            last_completed_turn_at: None,
            last_message_id: Some("cached-message".into()),
            source_state: CalendarSourceState::Active,
            source_file_size: 1,
            source_file_mtime_ns: 1,
            scan_status: CalendarIndexScanStatus::Ready,
            session_id_inferred: false,
            session_kind: CodexSessionKind::Primary,
            updated_at: Utc::now(),
        };
        let outcome = scan_rollout_file_with_retry(
            rollout.discovered(),
            Some(cached),
            &HashMap::new(),
            &AtomicBool::new(false),
        )
        .unwrap();
        let record = outcome.record.unwrap();
        assert_eq!(record.session_id, session_id);
        assert_eq!(record.title, "上次完整索引");
        assert_eq!(record.scan_status, CalendarIndexScanStatus::Partial);
        assert!(outcome.diagnostic.unwrap().contains("重试后仍失败"));
    }

    #[test]
    fn metadata_pass_skips_content_and_selected_pass_is_key_order_independent() {
        let tool = format!(
            "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"function_call_output\",\"content\":{:?}}}}}",
            "x".repeat(MAX_REVERSE_RECORD_BYTES + 1024)
        );
        let parsed: MinimalRecord = serde_json::from_str(&tool).unwrap();
        assert!(parsed.payload.unwrap().content.is_none());

        let developer = format!(
            "{{\"payload\":{{\"type\":\"message\",\"role\":\"developer\",\"content\":{:?}}},\"type\":\"response_item\"}}",
            "x".repeat(MAX_REVERSE_RECORD_BYTES + 1024)
        );
        let parsed: MinimalRecord = serde_json::from_str(&developer).unwrap();
        assert!(parsed.payload.unwrap().content.is_none());

        let message = br#"{"payload":{"content":"hello","phase":"final","role":"user","type":"message"},"type":"response_item"}"#;
        let metadata: MinimalRecord = serde_json::from_slice(message).unwrap();
        assert!(metadata.payload.as_ref().unwrap().content.is_none());
        assert!(is_visible_rollout_candidate(&metadata));
        let parsed = hydrate_visible_record_from_slice(metadata, message, false).unwrap();
        assert!(matches!(
            parsed.payload.unwrap().content,
            Some(MinimalContent::Text(text)) if text == "hello"
        ));

        let hidden_flat = format!(
            "{{\"text\":{:?},\"role\":\"assistant\",\"record_type\":\"reasoning\"}}",
            "x".repeat(MAX_REVERSE_RECORD_BYTES + 1024)
        );
        let parsed: MinimalRecord = serde_json::from_str(&hidden_flat).unwrap();
        assert!(parsed.text.is_none());
        assert!(!is_visible_export_candidate(&parsed));

        let visible_flat = br#"{"text":"flat hello","phase":"final","role":"assistant","message_id":"m1","turn_id":"t1","record_type":"message"}"#;
        let metadata: MinimalRecord = serde_json::from_slice(visible_flat).unwrap();
        assert!(metadata.text.is_none());
        assert!(is_visible_export_candidate(&metadata));
        let selected = hydrate_visible_record_from_slice(metadata, visible_flat, true).unwrap();
        assert_eq!(selected.text.as_deref(), Some("flat hello"));
    }

    #[test]
    fn preview_streams_a_rollout_larger_than_fifty_megabytes_without_a_size_rejection() {
        let session_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&session_id, |file| {
            writeln!(
                file,
                "{}",
                serde_json::json!({"type":"session_meta","payload":{"id":session_id}})
            )
            .unwrap();
            writeln!(
                file,
                "{}",
                visible("2026-08-08T01:00:00Z", "user", "", "u1", "问题")
            )
            .unwrap();
            let hidden_chunk = vec![b'x'; 1024 * 1024];
            for _ in 0..51 {
                write!(
                    file,
                    "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"developer\",\"content\":\""
                )
                .unwrap();
                file.write_all(&hidden_chunk).unwrap();
                writeln!(file, "\"}}}}").unwrap();
            }
            writeln!(
                file,
                "{}",
                visible("2026-08-08T02:00:00Z", "assistant", "final", "a1", "答案")
            )
            .unwrap();
        });
        assert!(fs::metadata(&rollout.path).unwrap().len() > 50 * 1024 * 1024);

        let app = tauri::test::mock_app();
        let preview = stream_import_preview(
            app.handle(),
            "large-preview",
            &rollout.path,
            "大文件流式预览".into(),
            Some(session_id),
            &AtomicBool::new(false),
        )
        .unwrap();

        assert_eq!(preview.messages.len(), 2);
        assert_eq!(preview.messages[0].text, "问题");
        assert_eq!(preview.messages[1].text, "答案");
        assert!(preview.source_file_size.unwrap() > 50 * 1024 * 1024);
        assert_eq!(preview.source_sha256.len(), 64);
    }

    #[cfg(unix)]
    #[test]
    fn discovery_does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let session_id = Uuid::new_v4().to_string();
        let rollout = TestRollout::create(&session_id, |file| {
            writeln!(
                file,
                "{}",
                visible("2026-08-08T03:00:00Z", "user", "", "u1", "问题")
            )
            .unwrap();
        });
        let link = rollout.dir.join(format!("rollout-link-{session_id}.jsonl"));
        symlink(&rollout.path, &link).unwrap();
        let mut found = Vec::new();
        walk_rollouts(&rollout.dir, CalendarSourceState::Active, &mut found).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, fs::canonicalize(&rollout.path).unwrap());
    }

    #[test]
    #[ignore = "requires explicit local sample paths; performs no model or network request"]
    fn real_rollout_calendar_timestamps_match_verified_samples() {
        let first = std::env::var("DIALOGUE_ATLAS_REAL_ROLLOUT_ONE")
            .expect("set DIALOGUE_ATLAS_REAL_ROLLOUT_ONE");
        let second = std::env::var("DIALOGUE_ATLAS_REAL_ROLLOUT_TWO")
            .expect("set DIALOGUE_ATLAS_REAL_ROLLOUT_TWO");
        for (path, expected) in [
            (first, "2026-08-08T11:50:14.446+00:00"),
            (second, "2026-08-07T06:43:08.312+00:00"),
        ] {
            let path = PathBuf::from(path);
            let metadata = fs::metadata(&path).unwrap();
            let outcome = scan_rollout_file(
                &DiscoveredFile {
                    path: fs::canonicalize(path).unwrap(),
                    source_state: CalendarSourceState::Active,
                    signature: signature_from_metadata(&metadata).unwrap(),
                },
                &HashMap::new(),
                &AtomicBool::new(false),
            )
            .unwrap();
            let record = outcome
                .record
                .unwrap_or_else(|| panic!("{:?}", outcome.diagnostic));
            assert_eq!(record.last_activity_at.unwrap().to_rfc3339(), expected);
        }

        if let Ok(path) = std::env::var("DIALOGUE_ATLAS_REAL_VISIBLE_EXPORT") {
            let content = fs::read_to_string(path).unwrap();
            let preview = preview_codex_jsonl_content(&content, None).unwrap();
            assert_eq!(preview.source_format, SourceFormat::VisibleExport);
            assert!(preview.last_activity_at.is_none());
            assert_eq!(preview.time_coverage, crate::domain::TimeCoverage::None);
        }
    }

    #[test]
    #[ignore = "scans an explicitly selected local Codex home; performs no model or network request"]
    fn real_codex_home_index_smoke() {
        let codex_home = PathBuf::from(
            std::env::var("DIALOGUE_ATLAS_REAL_CODEX_HOME")
                .expect("set DIALOGUE_ATLAS_REAL_CODEX_HOME"),
        );
        let files = discover_rollouts(&codex_home).unwrap();
        assert!(!files.is_empty());
        let hints = load_title_hints(&codex_home.join("session_index.jsonl"));
        let cancel = AtomicBool::new(false);
        let mut visible = 0usize;
        let mut skipped = 0usize;
        let mut partial = 0usize;
        for file in &files {
            let outcome = scan_rollout_file_with_retry(file.clone(), None, &hints, &cancel)
                .unwrap_or_else(|error| panic!("failed to scan {}: {error}", file.path.display()));
            match outcome.record {
                Some(record) => {
                    visible += 1;
                    if record.scan_status == CalendarIndexScanStatus::Partial {
                        partial += 1;
                    }
                }
                None => skipped += 1,
            }
        }
        eprintln!(
            "calendar index smoke: discovered={}, visible={}, partial={}, skipped={}",
            files.len(),
            visible,
            partial,
            skipped
        );
        assert!(visible > 0);
        assert_eq!(visible + skipped, files.len());
    }
}
