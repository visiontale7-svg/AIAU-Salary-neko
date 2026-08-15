use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
};

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::codex_cli::{CodexCliProvider, discover_codex_executable};

use crate::{
    analysis::run_analysis_job,
    calendar::{
        CalendarRuntime, CodexIndexStatus, ImportPreviewReady, ImportPreviewStart,
        stream_import_preview, verify_preview_source_unchanged,
    },
    corrections::{current_value, prepare_correction, replay, reset_command},
    domain::{
        AnalysisProgress, AnalysisProviderKind, AnalysisProviderStatus, AnalysisSettings,
        AnalysisSnapshot, AnalysisStart, AnalysisState, ApiKeyStatus, CODEX_CLI_MODEL,
        CalendarConversationVersion, CalendarEntry, CalendarQuery, CommitImportOptions,
        CommitImportRequest, CommitImportResponse, ConversationSummary, CorrectionCommand,
        CorrectionEvent, DEFAULT_MODEL, DIALOGUE_ACTS, ImportPreview, LayoutItemInput, LayoutState,
        ModeMembership, NodeLayout, PlatformCapabilities, Provenance, RELATION_KINDS, Relation,
        SnapshotBundle, SourceMessage, SourceSpan, StartAnalysisOptions, ViewportState,
    },
    error::{AtlasError, AtlasResult, CommandResult},
    import::{preview_paste_content, refresh_preview_after_speaker_corrections},
    keychain::KeyStore,
    openai::OpenAiClient,
    platform,
    provider::AnalysisProvider,
    repository::Repository,
    spans::{sha256_hex, validate_span},
};

pub struct AppState {
    pub repository: Repository,
    pub openai: OpenAiClient,
    pub key_store: KeyStore,
    jobs: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    active_conversations: Arc<StdMutex<HashSet<String>>>,
    previews: Arc<Mutex<HashMap<String, ImportPreview>>>,
    pub calendar: CalendarRuntime,
}

impl AppState {
    pub fn new(repository: Repository, openai: OpenAiClient) -> Self {
        Self {
            repository,
            openai,
            key_store: KeyStore,
            jobs: Arc::new(Mutex::new(HashMap::new())),
            active_conversations: Arc::new(StdMutex::new(HashSet::new())),
            previews: Arc::new(Mutex::new(HashMap::new())),
            calendar: CalendarRuntime::default(),
        }
    }
}

#[tauri::command]
pub async fn preview_codex_jsonl(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> CommandResult<ImportPreview> {
    let path = PathBuf::from(path);
    let title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Codex 对话")
        .to_string();
    let preview_id = Uuid::new_v4().to_string();
    let app_for_read = app.clone();
    let path_for_read = path.clone();
    let preview_id_for_read = preview_id.clone();
    let preview = tokio::task::spawn_blocking(move || {
        let cancel = AtomicBool::new(false);
        stream_import_preview(
            &app_for_read,
            &preview_id_for_read,
            &path_for_read,
            title,
            None,
            &cancel,
        )
    })
    .await
    .map_err(|error| AtlasError::Io(std::io::Error::other(error.to_string())))?
    .map_err(crate::error::CommandError::from)?;
    state
        .repository
        .backfill_legacy_calendar_time(&preview)
        .await
        .map_err(crate::error::CommandError::from)?;
    cache_preview(&state, preview.clone()).await;
    Ok(preview)
}

#[tauri::command]
pub async fn preview_paste(
    state: State<'_, AppState>,
    text: String,
) -> CommandResult<ImportPreview> {
    let preview = preview_paste_content(&text).map_err(crate::error::CommandError::from)?;
    cache_preview(&state, preview.clone()).await;
    Ok(preview)
}

#[tauri::command]
pub async fn start_codex_session_index(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<CodexIndexStatus> {
    let codex_home = app
        .path()
        .home_dir()
        .map_err(|error| AtlasError::Io(std::io::Error::other(error.to_string())))?
        .join(".codex");
    state
        .calendar
        .start_index(app, state.repository.clone(), codex_home)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cancel_codex_session_index(state: State<'_, AppState>) -> CommandResult<bool> {
    Ok(state.calendar.cancel_index().await)
}

#[tauri::command]
pub async fn get_codex_session_index_status(
    state: State<'_, AppState>,
) -> CommandResult<CodexIndexStatus> {
    Ok(state.calendar.status().await)
}

#[tauri::command]
pub async fn query_calendar_entries(
    state: State<'_, AppState>,
    query: CalendarQuery,
) -> CommandResult<Vec<CalendarEntry>> {
    state
        .repository
        .query_calendar_entries(&query)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_undated_calendar_entries(
    state: State<'_, AppState>,
) -> CommandResult<Vec<CalendarEntry>> {
    state
        .repository
        .list_undated_calendar_entries()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_calendar_entry(
    state: State<'_, AppState>,
    entry_id: String,
) -> CommandResult<CalendarEntry> {
    state
        .repository
        .get_calendar_entry(&entry_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn list_calendar_entry_versions(
    state: State<'_, AppState>,
    entry_id: String,
) -> CommandResult<Vec<CalendarConversationVersion>> {
    state
        .repository
        .list_calendar_entry_versions(&entry_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn start_import_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: String,
) -> CommandResult<ImportPreviewStart> {
    let entry = state
        .repository
        .get_calendar_entry(&entry_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let session_id = entry
        .external_session_id
        .clone()
        .ok_or_else(|| AtlasError::InvalidInput("该条目没有可读取的 Codex 源会话".into()))
        .map_err(crate::error::CommandError::from)?;
    let record = state
        .repository
        .get_codex_session_index_record(&session_id)
        .await
        .map_err(crate::error::CommandError::from)?
        .ok_or_else(|| AtlasError::NotFound(format!("codex session {session_id}")))
        .map_err(crate::error::CommandError::from)?;
    if record.source_state == crate::domain::CalendarSourceState::Missing {
        return Err(AtlasError::InvalidInput("源会话文件不可用，无法读取预览".into()).into());
    }
    let preview_id = Uuid::new_v4().to_string();
    let cancel = state.calendar.begin_preview(&preview_id).await;
    let path = PathBuf::from(record.canonical_path);
    let title = entry.title;
    let app_for_task = app.clone();
    let preview_id_for_task = preview_id.clone();
    let previews = state.previews.clone();
    let repository = state.repository.clone();
    let calendar = state.calendar.clone();
    tauri::async_runtime::spawn(async move {
        let id_for_read = preview_id_for_task.clone();
        let app_for_read = app_for_task.clone();
        let result = tokio::task::spawn_blocking(move || {
            stream_import_preview(
                &app_for_read,
                &id_for_read,
                &path,
                title,
                Some(session_id),
                &cancel,
            )
        })
        .await;
        match result {
            Ok(Ok(preview)) => {
                if let Err(error) = repository.backfill_legacy_calendar_time(&preview).await {
                    let _ = app_for_task.emit(
                        "import_preview_ready",
                        ImportPreviewReady {
                            preview_id: preview_id_for_task.clone(),
                            preview: None,
                            error: Some(error.to_string()),
                        },
                    );
                    calendar.finish_preview(&preview_id_for_task).await;
                    return;
                }
                let mut cache = previews.lock().await;
                if cache.len() >= 16 {
                    cache.clear();
                }
                cache.insert(preview.id.clone(), preview.clone());
                drop(cache);
                let _ = app_for_task.emit(
                    "import_preview_ready",
                    ImportPreviewReady {
                        preview_id: preview_id_for_task.clone(),
                        preview: Some(preview),
                        error: None,
                    },
                );
            }
            Ok(Err(error)) => {
                let _ = app_for_task.emit(
                    "import_preview_ready",
                    ImportPreviewReady {
                        preview_id: preview_id_for_task.clone(),
                        preview: None,
                        error: Some(error.to_string()),
                    },
                );
            }
            Err(error) => {
                let _ = app_for_task.emit(
                    "import_preview_ready",
                    ImportPreviewReady {
                        preview_id: preview_id_for_task.clone(),
                        preview: None,
                        error: Some(format!("本地预览任务异常：{error}")),
                    },
                );
            }
        }
        calendar.finish_preview(&preview_id_for_task).await;
    });
    Ok(ImportPreviewStart {
        preview_id,
        preview: None,
    })
}

#[tauri::command]
pub async fn cancel_import_preview(
    state: State<'_, AppState>,
    preview_id: String,
) -> CommandResult<bool> {
    Ok(state.calendar.cancel_preview(&preview_id).await)
}

#[tauri::command]
pub async fn commit_import(
    state: State<'_, AppState>,
    options: CommitImportOptions,
) -> CommandResult<CommitImportResponse> {
    let cached = state
        .previews
        .lock()
        .await
        .get(&options.preview_id)
        .cloned()
        .ok_or_else(|| AtlasError::InvalidInput("导入预览已失效，请重新预览".into()))
        .map_err(crate::error::CommandError::from)?;
    if cached.messages.len() != options.messages.len() {
        return Err(AtlasError::InvalidInput("确认消息数量与预览不一致".into()).into());
    }
    let confirmations: HashMap<_, _> = options
        .messages
        .iter()
        .map(|message| (message.id.as_str(), message))
        .collect();
    if confirmations.len() != options.messages.len() {
        return Err(AtlasError::InvalidInput("确认消息 ID 重复".into()).into());
    }
    if let Err(error) = verify_preview_source_unchanged(&cached) {
        state.previews.lock().await.remove(&options.preview_id);
        return Err(error.into());
    }
    if let (Some(session_id), source_sha256) = (
        cached.external_session_id.as_deref(),
        cached.source_sha256.as_str(),
    ) && let Some(conversation_id) = state
        .repository
        .find_conversation_version(session_id, source_sha256)
        .await
        .map_err(crate::error::CommandError::from)?
    {
        state.previews.lock().await.remove(&options.preview_id);
        return Ok(CommitImportResponse {
            conversation_id,
            already_imported: true,
        });
    }
    ensure_analysis_source_configured(&state).await?;
    let mut preview = cached;
    for message in &mut preview.messages {
        let confirmation = confirmations
            .get(message.id.as_str())
            .ok_or_else(|| AtlasError::InvalidInput("确认内容缺少预览消息".into()))
            .map_err(crate::error::CommandError::from)?;
        if confirmation.text != message.text {
            return Err(AtlasError::InvalidInput(
                "预览阶段只能校正说话者，不能静默改写原文".into(),
            )
            .into());
        }
        message.speaker = confirmation.speaker;
    }
    refresh_preview_after_speaker_corrections(&mut preview);
    let outcome = state
        .repository
        .commit_import_with_outcome(CommitImportRequest {
            title: options.title,
            preview,
            analyze_redacted: options.redaction_enabled,
        })
        .await
        .map_err(crate::error::CommandError::from)?;
    state.previews.lock().await.remove(&options.preview_id);
    Ok(CommitImportResponse {
        conversation_id: outcome.summary.id,
        already_imported: outcome.already_imported,
    })
}

#[tauri::command]
pub async fn list_conversations(
    state: State<'_, AppState>,
) -> CommandResult<Vec<ConversationSummary>> {
    state
        .repository
        .list_conversations()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn set_api_key(
    state: State<'_, AppState>,
    api_key: String,
) -> CommandResult<ApiKeyStatus> {
    state
        .key_store
        .set(&api_key)
        .map_err(crate::error::CommandError::from)?;
    Ok(ApiKeyStatus {
        ok: true,
        configured: true,
        valid: None,
        model: DEFAULT_MODEL.into(),
        message: format!(
            "API key 已安全保存到{}，尚未联网验证",
            platform::current_capabilities().credential_store.label()
        ),
    })
}

#[tauri::command]
pub async fn test_api_key(state: State<'_, AppState>) -> CommandResult<ApiKeyStatus> {
    if !state.key_store.configured() {
        return Ok(ApiKeyStatus {
            ok: false,
            configured: false,
            valid: None,
            model: DEFAULT_MODEL.into(),
            message: "尚未配置 OpenAI API key".into(),
        });
    }
    let key = state
        .key_store
        .get()
        .map_err(crate::error::CommandError::from)?;
    match state.openai.test_key(&key).await {
        Ok(()) => Ok(ApiKeyStatus {
            ok: true,
            configured: true,
            valid: Some(true),
            model: DEFAULT_MODEL.into(),
            message: "OpenAI API key 可用".into(),
        }),
        Err(error) => Ok(ApiKeyStatus {
            ok: false,
            configured: true,
            valid: Some(false),
            model: DEFAULT_MODEL.into(),
            message: error.to_string(),
        }),
    }
}

#[tauri::command]
pub async fn get_analysis_settings(state: State<'_, AppState>) -> CommandResult<AnalysisSettings> {
    let provider = provider_for_settings(&state.repository)
        .await
        .map_err(crate::error::CommandError::from)?;
    Ok(analysis_settings(provider))
}

#[tauri::command]
pub async fn set_analysis_provider(
    state: State<'_, AppState>,
    provider: AnalysisProviderKind,
) -> CommandResult<AnalysisSettings> {
    platform::ensure_provider_supported(provider).map_err(crate::error::CommandError::from)?;
    let provider = state
        .repository
        .set_analysis_provider(provider)
        .await
        .map_err(crate::error::CommandError::from)?;
    Ok(analysis_settings(provider))
}

#[tauri::command]
pub async fn test_analysis_provider(
    state: State<'_, AppState>,
) -> CommandResult<AnalysisProviderStatus> {
    let provider = provider_for_execution(&state.repository)
        .await
        .map_err(crate::error::CommandError::from)?;
    match provider {
        AnalysisProviderKind::OpenaiApi => {
            if !state.key_store.configured() {
                return Ok(AnalysisProviderStatus {
                    provider,
                    ok: false,
                    configured: false,
                    available: true,
                    authenticated: false,
                    model: DEFAULT_MODEL.into(),
                    version: None,
                    message: "尚未配置 OpenAI API key；测试未发送模型请求".into(),
                });
            }
            let key = match state.key_store.get() {
                Ok(key) => key,
                Err(error) => {
                    return Ok(AnalysisProviderStatus {
                        provider,
                        ok: false,
                        configured: true,
                        available: true,
                        authenticated: false,
                        model: DEFAULT_MODEL.into(),
                        version: None,
                        message: error.to_string(),
                    });
                }
            };
            match state.openai.test_key(&key).await {
                Ok(()) => Ok(AnalysisProviderStatus {
                    provider,
                    ok: true,
                    configured: true,
                    available: true,
                    authenticated: true,
                    model: DEFAULT_MODEL.into(),
                    version: None,
                    message: "OpenAI API key 可访问 /models；测试未创建模型响应，也未确认目标模型、额度或本次费用".into(),
                }),
                Err(error) => Ok(AnalysisProviderStatus {
                    provider,
                    ok: false,
                    configured: true,
                    available: true,
                    authenticated: false,
                    model: DEFAULT_MODEL.into(),
                    version: None,
                    message: error.to_string(),
                }),
            }
        }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        AnalysisProviderKind::CodexCli => {
            if discover_codex_executable().is_none() {
                return Ok(AnalysisProviderStatus {
                    provider,
                    ok: false,
                    configured: false,
                    available: false,
                    authenticated: false,
                    model: CODEX_CLI_MODEL.into(),
                    version: None,
                    message: "未找到 Codex CLI；测试未发送模型请求".into(),
                });
            }
            match CodexCliProvider::inspect_readiness().await {
                Ok((_, readiness)) => Ok(AnalysisProviderStatus {
                    provider,
                    ok: readiness.authenticated,
                    configured: true,
                    available: true,
                    authenticated: readiness.authenticated,
                    model: CODEX_CLI_MODEL.into(),
                    version: Some(readiness.version),
                    message: readiness.message,
                }),
                Err(error) => Ok(AnalysisProviderStatus {
                    provider,
                    ok: false,
                    configured: true,
                    available: false,
                    authenticated: false,
                    model: CODEX_CLI_MODEL.into(),
                    version: None,
                    message: error.to_string(),
                }),
            }
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        AnalysisProviderKind::CodexCli => Err(platform::unsupported_provider_error(
            provider,
            platform::current_capabilities().platform,
        )
        .into()),
    }
}

#[tauri::command]
pub async fn start_analysis(
    app: AppHandle,
    state: State<'_, AppState>,
    options: StartAnalysisOptions,
) -> CommandResult<AnalysisStart> {
    let model = if options.model_id.trim().is_empty() {
        DEFAULT_MODEL
    } else {
        options.model_id.trim()
    };
    let provider = provider_for_execution(&state.repository)
        .await
        .map_err(crate::error::CommandError::from)?;
    spawn_analysis(&app, &state, &options.conversation_id, provider, model).await
}

#[tauri::command]
pub async fn cancel_analysis(state: State<'_, AppState>, run_id: String) -> CommandResult<bool> {
    let jobs = state.jobs.lock().await;
    let Some(cancelled) = jobs.get(&run_id) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Relaxed);
    Ok(true)
}

#[tauri::command]
pub async fn retry_failed_stage(
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> CommandResult<AnalysisStart> {
    let prior = state
        .repository
        .get_run(&run_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    if !matches!(prior.state, AnalysisState::Failed | AnalysisState::Partial) {
        return Err(AtlasError::InvalidInput(
            "只有 failed 或 partial 的分析可以重试；重试会创建新快照".into(),
        )
        .into());
    }
    platform::ensure_provider_supported(prior.provider)
        .map_err(crate::error::CommandError::from)?;
    spawn_analysis(
        &app,
        &state,
        &prior.conversation_id,
        prior.provider,
        &prior.model_id,
    )
    .await
}

#[tauri::command]
pub async fn get_snapshot(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    snapshot_id: Option<String>,
) -> CommandResult<SnapshotBundle> {
    let base = state
        .repository
        .load_snapshot(conversation_id.as_deref(), snapshot_id.as_deref())
        .await
        .map_err(crate::error::CommandError::from)?;
    let corrections = state
        .repository
        .load_corrections(&base.id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let effective = replay(&base, &corrections).map_err(crate::error::CommandError::from)?;
    let layout = state
        .repository
        .load_layout(&base.id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let conversation = state
        .repository
        .load_conversation(&base.conversation_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    Ok(SnapshotBundle {
        conversation: conversation.summary,
        base,
        effective,
        corrections,
        layout,
        messages: conversation.messages,
        turns: conversation.turns,
    })
}

#[tauri::command]
pub async fn apply_correction(
    state: State<'_, AppState>,
    snapshot_id: String,
    command: serde_json::Value,
) -> CommandResult<Vec<CorrectionEvent>> {
    let base = state
        .repository
        .load_snapshot(None, Some(&snapshot_id))
        .await
        .map_err(crate::error::CommandError::from)?;
    let corrections = state
        .repository
        .load_corrections(&snapshot_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let mut effective = replay(&base, &corrections).map_err(crate::error::CommandError::from)?;
    let kind = command
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AtlasError::InvalidInput("纠正命令缺少 kind".into()))
        .map_err(crate::error::CommandError::from)?;
    let mut events = Vec::new();
    match kind {
        "update_unit" => {
            let unit_id = value_string(&command, "unitId")?;
            let mut unit = effective
                .semantic_units
                .iter()
                .find(|unit| unit.id == unit_id)
                .cloned()
                .ok_or_else(|| AtlasError::NotFound(format!("unit {unit_id}")))
                .map_err(crate::error::CommandError::from)?;
            if let Some(label) = command.get("label").and_then(serde_json::Value::as_str) {
                if label.trim().is_empty() {
                    return Err(AtlasError::InvalidInput("节点标签不能为空".into()).into());
                }
                unit.label = label.trim().chars().take(80).collect();
            }
            let acts = command
                .get("acts")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| AtlasError::InvalidInput("update_unit 缺少 acts".into()))
                .map_err(crate::error::CommandError::from)?;
            unit.acts = acts
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
                .collect();
            if unit.acts.len() != acts.len() || unit.acts.iter().any(|act| !valid_dialogue_act(act))
            {
                return Err(AtlasError::InvalidInput("存在未知的对话行为标签".into()).into());
            }
            if unit.acts.is_empty() {
                unit.acts.push("其他".into());
            }
            unit.provenance = Provenance::User;
            let desired: std::collections::HashSet<String> = command
                .get("modeIds")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
                .collect();
            if desired
                .iter()
                .any(|mode_id| !effective.modes.iter().any(|mode| &mode.id == mode_id))
            {
                return Err(AtlasError::InvalidInput("模式归属引用了未知模式".into()).into());
            }
            let generic = CorrectionCommand {
                kind: "update_unit".into(),
                target_id: unit_id.clone(),
                after: serde_json::to_value(unit).map_err(AtlasError::from)?,
            };
            events.push(
                persist_command(&state.repository, &snapshot_id, &mut effective, generic).await?,
            );

            let existing: Vec<_> = effective
                .memberships
                .iter()
                .filter(|membership| membership.unit_id == unit_id)
                .cloned()
                .collect();
            for membership in existing {
                if !desired.contains(&membership.mode_id) {
                    let generic = CorrectionCommand {
                        kind: "delete_membership".into(),
                        target_id: membership.id,
                        after: serde_json::Value::Null,
                    };
                    events.push(
                        persist_command(&state.repository, &snapshot_id, &mut effective, generic)
                            .await?,
                    );
                }
            }
            let current_mode_ids: std::collections::HashSet<_> = effective
                .memberships
                .iter()
                .filter(|membership| membership.unit_id == unit_id)
                .map(|membership| membership.mode_id.clone())
                .collect();
            for mode_id in desired.difference(&current_mode_ids) {
                let membership = ModeMembership {
                    id: Uuid::new_v4().to_string(),
                    mode_id: mode_id.clone(),
                    unit_id: unit_id.clone(),
                    confidence: 1.0,
                };
                let generic = CorrectionCommand {
                    kind: "set_membership".into(),
                    target_id: membership.id.clone(),
                    after: serde_json::to_value(membership).map_err(AtlasError::from)?,
                };
                events.push(
                    persist_command(&state.repository, &snapshot_id, &mut effective, generic)
                        .await?,
                );
            }
        }
        "update_relation" => {
            let relation_id = value_string(&command, "relationId")?;
            let mut relation = effective
                .relations
                .iter()
                .find(|relation| relation.id == relation_id)
                .cloned()
                .ok_or_else(|| AtlasError::NotFound(format!("relation {relation_id}")))
                .map_err(crate::error::CommandError::from)?;
            relation.kind = value_string(&command, "type")?;
            if !valid_relation_kind(&relation.kind) {
                return Err(AtlasError::InvalidInput("存在未知的关系类型".into()).into());
            }
            relation.label = command
                .get("label")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&relation.kind)
                .trim()
                .to_string();
            let generic = CorrectionCommand {
                kind: "upsert_relation".into(),
                target_id: relation_id,
                after: serde_json::to_value(relation).map_err(AtlasError::from)?,
            };
            events.push(
                persist_command(&state.repository, &snapshot_id, &mut effective, generic).await?,
            );
        }
        "add_relation" => {
            let conversation = state
                .repository
                .load_conversation(&base.conversation_id)
                .await
                .map_err(crate::error::CommandError::from)?;
            let relation = parse_frontend_relation(
                command
                    .get("relation")
                    .ok_or_else(|| AtlasError::InvalidInput("add_relation 缺少 relation".into()))
                    .map_err(crate::error::CommandError::from)?,
                &conversation.messages,
            )?;
            if effective
                .relations
                .iter()
                .any(|item| item.id == relation.id)
            {
                return Err(AtlasError::InvalidInput("add_relation 的 ID 已存在".into()).into());
            }
            let generic = CorrectionCommand {
                kind: "upsert_relation".into(),
                target_id: relation.id.clone(),
                after: serde_json::to_value(relation).map_err(AtlasError::from)?,
            };
            events.push(
                persist_command(&state.repository, &snapshot_id, &mut effective, generic).await?,
            );
        }
        "delete_relation" => {
            let relation_id = value_string(&command, "relationId")?;
            let generic = CorrectionCommand {
                kind: "delete_relation".into(),
                target_id: relation_id,
                after: serde_json::Value::Null,
            };
            events.push(
                persist_command(&state.repository, &snapshot_id, &mut effective, generic).await?,
            );
        }
        "update_mode" => {
            let mode_id = value_string(&command, "modeId")?;
            let mut mode = effective
                .modes
                .iter()
                .find(|mode| mode.id == mode_id)
                .cloned()
                .ok_or_else(|| AtlasError::NotFound(format!("mode {mode_id}")))
                .map_err(crate::error::CommandError::from)?;
            mode.label = value_string(&command, "label")?
                .trim()
                .chars()
                .take(50)
                .collect();
            if mode.label.is_empty() {
                return Err(AtlasError::InvalidInput("模式名称不能为空".into()).into());
            }
            let generic = CorrectionCommand {
                kind: "update_mode".into(),
                target_id: mode_id,
                after: serde_json::to_value(mode).map_err(AtlasError::from)?,
            };
            events.push(
                persist_command(&state.repository, &snapshot_id, &mut effective, generic).await?,
            );
        }
        "move_node" => {
            let unit_id = value_string(&command, "unitId")?;
            let position = command
                .get("position")
                .ok_or_else(|| AtlasError::InvalidInput("move_node 缺少 position".into()))
                .map_err(crate::error::CommandError::from)?;
            let input = LayoutItemInput {
                x: position
                    .get("x")
                    .and_then(serde_json::Value::as_f64)
                    .ok_or_else(|| AtlasError::InvalidInput("position.x 无效".into()))
                    .map_err(crate::error::CommandError::from)?,
                y: position
                    .get("y")
                    .and_then(serde_json::Value::as_f64)
                    .ok_or_else(|| AtlasError::InvalidInput("position.y 无效".into()))
                    .map_err(crate::error::CommandError::from)?,
                pinned: command
                    .get("pinned")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(true),
            };
            persist_single_node_layout(&state.repository, &base, &unit_id, input).await?;
        }
        _ => {
            return Err(AtlasError::InvalidInput(format!(
                "unknown frontend correction kind: {kind}"
            ))
            .into());
        }
    }
    Ok(events)
}

#[tauri::command]
pub async fn reset_item_to_model(
    state: State<'_, AppState>,
    snapshot_id: String,
    item_id: String,
) -> CommandResult<CorrectionEvent> {
    let base = state
        .repository
        .load_snapshot(None, Some(&snapshot_id))
        .await
        .map_err(crate::error::CommandError::from)?;
    let corrections = state
        .repository
        .load_corrections(&snapshot_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let mut effective = replay(&base, &corrections).map_err(crate::error::CommandError::from)?;
    let target_kind = if effective
        .semantic_units
        .iter()
        .any(|item| item.id == item_id)
    {
        "unit"
    } else if effective.relations.iter().any(|item| item.id == item_id) {
        "relation"
    } else if effective.modes.iter().any(|item| item.id == item_id) {
        "mode"
    } else if effective.memberships.iter().any(|item| item.id == item_id) {
        "membership"
    } else {
        return Err(AtlasError::NotFound(format!("item {item_id}")).into());
    };
    let mut commands = Vec::new();
    if target_kind == "unit" {
        if current_value(&base, "update_unit", &item_id)
            != current_value(&effective, "update_unit", &item_id)
        {
            commands.push(
                reset_command(&base, &effective, target_kind, &item_id)
                    .map_err(crate::error::CommandError::from)?,
            );
        }
        for membership in effective
            .memberships
            .iter()
            .filter(|membership| membership.unit_id == item_id)
        {
            if !base
                .memberships
                .iter()
                .any(|base_membership| base_membership.id == membership.id)
            {
                commands.push(CorrectionCommand {
                    kind: "delete_membership".into(),
                    target_id: membership.id.clone(),
                    after: serde_json::Value::Null,
                });
            }
        }
        for membership in base
            .memberships
            .iter()
            .filter(|membership| membership.unit_id == item_id)
        {
            if current_value(&base, "set_membership", &membership.id)
                != current_value(&effective, "set_membership", &membership.id)
            {
                commands.push(CorrectionCommand {
                    kind: "set_membership".into(),
                    target_id: membership.id.clone(),
                    after: serde_json::to_value(membership).map_err(AtlasError::from)?,
                });
            }
        }
    } else {
        commands.push(
            reset_command(&base, &effective, target_kind, &item_id)
                .map_err(crate::error::CommandError::from)?,
        );
    }
    if commands.is_empty() {
        return Err(AtlasError::InvalidInput("该项目已经与模型快照一致".into()).into());
    }
    let mut last = None;
    for command in commands {
        last =
            Some(persist_command(&state.repository, &snapshot_id, &mut effective, command).await?);
    }
    Ok(last.expect("at least one reset command"))
}

#[tauri::command]
pub async fn save_layout(
    state: State<'_, AppState>,
    snapshot_id: String,
    layout: HashMap<String, LayoutItemInput>,
    viewport: Option<ViewportState>,
    show_mode_islands: Option<bool>,
) -> CommandResult<LayoutState> {
    let snapshot = state
        .repository
        .load_snapshot(None, Some(&snapshot_id))
        .await
        .map_err(crate::error::CommandError::from)?;
    let valid_ids: std::collections::HashSet<_> = snapshot
        .semantic_units
        .iter()
        .map(|unit| unit.id.as_str())
        .collect();
    if layout.iter().any(|(unit_id, item)| {
        !valid_ids.contains(unit_id.as_str()) || !item.x.is_finite() || !item.y.is_finite()
    }) {
        return Err(AtlasError::InvalidInput("布局含未知节点或非有限坐标".into()).into());
    }
    let previous = state
        .repository
        .load_layout(&snapshot_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let collapsed: HashMap<_, _> = previous
        .as_ref()
        .into_iter()
        .flat_map(|layout| layout.nodes.iter())
        .map(|node| (node.unit_id.as_str(), node.collapsed))
        .collect();
    let mut nodes: Vec<_> = layout
        .into_iter()
        .map(|(unit_id, item)| NodeLayout {
            collapsed: collapsed.get(unit_id.as_str()).copied().unwrap_or(false),
            unit_id,
            x: item.x,
            y: item.y,
            pinned: item.pinned,
        })
        .collect();
    nodes.sort_by(|a, b| a.unit_id.cmp(&b.unit_id));
    let layout = LayoutState {
        nodes,
        viewport: viewport
            .or_else(|| previous.as_ref().map(|layout| layout.viewport.clone()))
            .unwrap_or(ViewportState {
                x: 0.0,
                y: 0.0,
                zoom: 1.0,
            }),
        show_mode_islands: show_mode_islands
            .or_else(|| previous.as_ref().map(|layout| layout.show_mode_islands))
            .unwrap_or(true),
        updated_at: None,
    };
    state
        .repository
        .save_layout(&snapshot_id, &layout)
        .await
        .map_err(Into::into)
}

async fn spawn_analysis(
    app: &AppHandle,
    state: &State<'_, AppState>,
    conversation_id: &str,
    provider_kind: AnalysisProviderKind,
    model_id: &str,
) -> CommandResult<AnalysisStart> {
    platform::ensure_provider_supported(provider_kind).map_err(crate::error::CommandError::from)?;
    let reservation =
        ConversationReservation::acquire(state.active_conversations.clone(), conversation_id)
            .map_err(crate::error::CommandError::from)?;
    state
        .repository
        .load_conversation(conversation_id)
        .await
        .map_err(crate::error::CommandError::from)?;
    let provider = match provider_kind {
        AnalysisProviderKind::OpenaiApi => AnalysisProvider::OpenaiApi {
            client: state.openai.clone(),
            api_key: state
                .key_store
                .get()
                .map_err(crate::error::CommandError::from)?,
            model: model_id.into(),
        },
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        AnalysisProviderKind::CodexCli => {
            let (provider, _) = CodexCliProvider::discover_ready()
                .await
                .map_err(crate::error::CommandError::from)?;
            AnalysisProvider::CodexCli(provider)
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        AnalysisProviderKind::CodexCli => {
            return Err(platform::unsupported_provider_error(
                provider_kind,
                platform::current_capabilities().platform,
            )
            .into());
        }
    };
    let resolved_model = provider.model().to_string();
    let run = state
        .repository
        .create_run(
            conversation_id,
            provider.kind(),
            provider.provider_version(),
            provider.credential_mode(),
            &resolved_model,
        )
        .await
        .map_err(crate::error::CommandError::from)?;
    let cancelled = Arc::new(AtomicBool::new(false));
    state
        .jobs
        .lock()
        .await
        .insert(run.id.clone(), cancelled.clone());
    let _ = app.emit(
        "analysis_progress",
        AnalysisProgress {
            run_id: run.id.clone(),
            conversation_id: run.conversation_id.clone(),
            stage: AnalysisState::Parsing,
            progress: 0.0,
            completed: 1,
            total: 7,
            message: "分析已在本机排队".into(),
        },
    );
    let repository = state.repository.clone();
    let jobs = state.jobs.clone();
    let app_handle = app.clone();
    let run_for_task = run.clone();
    tauri::async_runtime::spawn(async move {
        // Moving this guard into the task releases the conversation even if
        // the future is cancelled or panics. Setup errors release it through
        // normal stack unwinding before this spawn point.
        let _reservation = reservation;
        let result = run_analysis_job(
            repository.clone(),
            provider,
            app_handle.clone(),
            run_for_task.clone(),
            cancelled,
        )
        .await;
        if let Err(error) = result {
            let state_value = if matches!(error, AtlasError::Cancelled) {
                AnalysisState::Cancelled
            } else {
                AnalysisState::Failed
            };
            let _ = repository
                .update_run(
                    &run_for_task.id,
                    state_value.clone(),
                    Some(&error.to_string()),
                    None,
                    None,
                )
                .await;
            let _ = app_handle.emit(
                "analysis_progress",
                AnalysisProgress {
                    run_id: run_for_task.id.clone(),
                    conversation_id: run_for_task.conversation_id.clone(),
                    stage: state_value,
                    progress: 1.0,
                    completed: 7,
                    total: 7,
                    message: error.to_string(),
                },
            );
        }
        jobs.lock().await.remove(&run_for_task.id);
    });
    Ok(AnalysisStart {
        run_id: run.id,
        conversation_id: run.conversation_id,
        state: AnalysisState::Queued,
    })
}

#[derive(Debug)]
struct ConversationReservation {
    active: Arc<StdMutex<HashSet<String>>>,
    conversation_id: String,
}

impl ConversationReservation {
    fn acquire(
        active: Arc<StdMutex<HashSet<String>>>,
        conversation_id: &str,
    ) -> crate::error::AtlasResult<Self> {
        let mut conversations = active.lock().unwrap_or_else(|error| error.into_inner());
        if !conversations.insert(conversation_id.to_string()) {
            return Err(AtlasError::InvalidInput(
                "该对话已有分析正在准备或运行，请等待完成或先取消".into(),
            ));
        }
        drop(conversations);
        Ok(Self {
            active,
            conversation_id: conversation_id.into(),
        })
    }
}

impl Drop for ConversationReservation {
    fn drop(&mut self) {
        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.conversation_id);
    }
}

fn analysis_settings(provider: AnalysisProviderKind) -> AnalysisSettings {
    AnalysisSettings {
        provider,
        default_openai_model: DEFAULT_MODEL.into(),
        codex_cli_model: CODEX_CLI_MODEL.into(),
        capabilities: platform::current_capabilities(),
    }
}

async fn provider_for_settings(repository: &Repository) -> AtlasResult<AnalysisProviderKind> {
    provider_for_settings_with_capabilities(repository, &platform::current_capabilities()).await
}

async fn provider_for_settings_with_capabilities(
    repository: &Repository,
    capabilities: &PlatformCapabilities,
) -> AtlasResult<AnalysisProviderKind> {
    let provider = repository.get_analysis_provider().await?;
    if capabilities.available_providers.contains(&provider) {
        return Ok(provider);
    }
    repository
        .set_analysis_provider(AnalysisProviderKind::OpenaiApi)
        .await?;
    Ok(AnalysisProviderKind::OpenaiApi)
}

async fn provider_for_execution(repository: &Repository) -> AtlasResult<AnalysisProviderKind> {
    provider_for_execution_with_capabilities(repository, &platform::current_capabilities()).await
}

async fn ensure_analysis_source_configured(state: &State<'_, AppState>) -> CommandResult<()> {
    let provider = provider_for_execution(&state.repository)
        .await
        .map_err(crate::error::CommandError::from)?;
    match provider {
        AnalysisProviderKind::OpenaiApi if !state.key_store.configured() => {
            Err(AtlasError::Provider("尚未配置 OpenAI API key；本次没有创建对话记录".into()).into())
        }
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        AnalysisProviderKind::CodexCli => {
            if discover_codex_executable().is_none() {
                return Err(AtlasError::Provider(
                    "未找到可用 Codex CLI；本次没有创建对话记录".into(),
                )
                .into());
            }
            match CodexCliProvider::inspect_readiness().await {
                Ok((_, readiness)) if readiness.authenticated => Ok(()),
                Ok((_, readiness)) => Err(AtlasError::Provider(format!(
                    "Codex 尚未登录：{}；本次没有创建对话记录",
                    readiness.message
                ))
                .into()),
                Err(error) => Err(AtlasError::Provider(format!(
                    "Codex 来源不可用：{error}；本次没有创建对话记录"
                ))
                .into()),
            }
        }
        _ => Ok(()),
    }
}

async fn provider_for_execution_with_capabilities(
    repository: &Repository,
    capabilities: &PlatformCapabilities,
) -> AtlasResult<AnalysisProviderKind> {
    let provider = repository.get_analysis_provider().await?;
    if !capabilities.available_providers.contains(&provider) {
        repository
            .set_analysis_provider(AnalysisProviderKind::OpenaiApi)
            .await?;
        let message = platform::unsupported_provider_message(provider, capabilities.platform);
        return Err(AtlasError::Provider(format!(
            "{message}；设置已恢复为 OpenAI API，本次操作未执行，请确认凭据后重试"
        )));
    }
    Ok(provider)
}

async fn cache_preview(state: &State<'_, AppState>, preview: ImportPreview) {
    let mut previews = state.previews.lock().await;
    if previews.len() >= 16 {
        previews.clear();
    }
    previews.insert(preview.id.clone(), preview);
}

fn value_string(value: &serde_json::Value, key: &str) -> CommandResult<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AtlasError::InvalidInput(format!("命令缺少 {key}")).into())
}

fn valid_dialogue_act(value: &str) -> bool {
    DIALOGUE_ACTS.contains(&value)
}

fn valid_relation_kind(value: &str) -> bool {
    RELATION_KINDS.contains(&value)
}

async fn persist_command(
    repository: &Repository,
    snapshot_id: &str,
    effective: &mut AnalysisSnapshot,
    command: CorrectionCommand,
) -> CommandResult<CorrectionEvent> {
    let before =
        prepare_correction(effective, &command).map_err(crate::error::CommandError::from)?;
    let event = repository
        .append_correction(
            snapshot_id,
            &command.kind,
            &command.target_id,
            before,
            command.after,
        )
        .await
        .map_err(crate::error::CommandError::from)?;
    let next = replay(effective, std::slice::from_ref(&event))
        .map_err(crate::error::CommandError::from)?;
    *effective = next;
    Ok(event)
}

fn parse_frontend_relation(
    value: &serde_json::Value,
    messages: &[SourceMessage],
) -> CommandResult<Relation> {
    let evidence_value = value
        .get("evidence")
        .ok_or_else(|| AtlasError::InvalidInput("人工关系必须提供 evidence".into()))
        .map_err(crate::error::CommandError::from)?;
    let mut evidence = Vec::new();
    for key in ["user", "assistant"] {
        if let Some(span) = evidence_value.get(key)
            && !span.is_null()
        {
            evidence.push(parse_frontend_span(span, messages)?);
        }
    }
    if evidence.is_empty() {
        return Err(AtlasError::InvalidInput("人工新增关系必须选择至少一段逐字证据".into()).into());
    }
    let kind = value_string(value, "type")?;
    if !valid_relation_kind(&kind) {
        return Err(AtlasError::InvalidInput("存在未知的关系类型".into()).into());
    }
    Ok(Relation {
        id: value_string(value, "id")?,
        source: value_string(value, "source")?,
        target: value_string(value, "target")?,
        label: value
            .get("label")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&kind)
            .trim()
            .to_string(),
        kind,
        confidence: value
            .get("confidence")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(1.0)
            .clamp(0.0, 1.0) as f32,
        evidence,
        user_created: true,
    })
}

fn parse_frontend_span(
    value: &serde_json::Value,
    messages: &[SourceMessage],
) -> CommandResult<SourceSpan> {
    let message_id = value_string(value, "messageId")?;
    let start = value
        .get("start")
        .or_else(|| value.get("startUtf16"))
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| AtlasError::InvalidInput("证据 start 无效".into()))
        .map_err(crate::error::CommandError::from)? as usize;
    let end = value
        .get("end")
        .or_else(|| value.get("endUtf16"))
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| AtlasError::InvalidInput("证据 end 无效".into()))
        .map_err(crate::error::CommandError::from)? as usize;
    let exact_quote = value_string(value, "exactQuote")?;
    let span = SourceSpan {
        message_id: message_id.clone(),
        start_utf16: start,
        end_utf16: end,
        sha256: sha256_hex(&exact_quote),
        exact_quote,
        model_saw_redacted: value
            .get("redacted")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    };
    let message = messages
        .iter()
        .find(|message| message.id == message_id)
        .ok_or_else(|| AtlasError::InvalidInput("证据引用了未知消息".into()))
        .map_err(crate::error::CommandError::from)?;
    validate_span(message, &span).map_err(crate::error::CommandError::from)?;
    Ok(span)
}

async fn persist_single_node_layout(
    repository: &Repository,
    snapshot: &AnalysisSnapshot,
    unit_id: &str,
    input: LayoutItemInput,
) -> CommandResult<()> {
    if !snapshot
        .semantic_units
        .iter()
        .any(|unit| unit.id == unit_id)
        || !input.x.is_finite()
        || !input.y.is_finite()
    {
        return Err(AtlasError::InvalidInput("节点位置无效".into()).into());
    }
    let mut layout = repository
        .load_layout(&snapshot.id)
        .await
        .map_err(crate::error::CommandError::from)?
        .unwrap_or(LayoutState {
            nodes: Vec::new(),
            viewport: ViewportState {
                x: 0.0,
                y: 0.0,
                zoom: 1.0,
            },
            show_mode_islands: true,
            updated_at: None,
        });
    if let Some(node) = layout.nodes.iter_mut().find(|node| node.unit_id == unit_id) {
        node.x = input.x;
        node.y = input.y;
        node.pinned = input.pinned;
    } else {
        layout.nodes.push(NodeLayout {
            unit_id: unit_id.into(),
            x: input.x,
            y: input.y,
            pinned: input.pinned,
            collapsed: false,
        });
    }
    repository
        .save_layout(&snapshot.id, &layout)
        .await
        .map_err(crate::error::CommandError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_reservation_is_single_flight_and_releases_on_drop() {
        let active = Arc::new(StdMutex::new(HashSet::new()));
        let first = ConversationReservation::acquire(active.clone(), "conversation-1").unwrap();
        let duplicate = ConversationReservation::acquire(active.clone(), "conversation-1")
            .expect_err("same conversation must be rejected while active");
        assert!(matches!(duplicate, AtlasError::InvalidInput(_)));

        let other = ConversationReservation::acquire(active.clone(), "conversation-2")
            .expect("different conversations may run concurrently");
        drop(first);
        let replacement = ConversationReservation::acquire(active, "conversation-1")
            .expect("dropping the active run releases its conversation");
        drop((other, replacement));
    }

    #[tokio::test]
    async fn settings_read_repairs_stale_codex_provider_only() {
        let repository = Repository::in_memory().await.unwrap();
        repository
            .set_analysis_provider(AnalysisProviderKind::CodexCli)
            .await
            .unwrap();

        let capabilities = crate::domain::PlatformCapabilities {
            platform: crate::domain::PlatformKind::Windows,
            available_providers: vec![AnalysisProviderKind::OpenaiApi],
            credential_store: crate::domain::CredentialStoreKind::WindowsCredentialManager,
        };
        let selected = provider_for_settings_with_capabilities(&repository, &capabilities)
            .await
            .unwrap();

        assert_eq!(selected, AnalysisProviderKind::OpenaiApi);
        assert_eq!(
            repository.get_analysis_provider().await.unwrap(),
            AnalysisProviderKind::OpenaiApi
        );
    }

    #[tokio::test]
    async fn execution_rejects_stale_codex_provider_after_repairing_setting() {
        let repository = Repository::in_memory().await.unwrap();
        repository
            .set_analysis_provider(AnalysisProviderKind::CodexCli)
            .await
            .unwrap();

        let capabilities = crate::domain::PlatformCapabilities {
            platform: crate::domain::PlatformKind::Windows,
            available_providers: vec![AnalysisProviderKind::OpenaiApi],
            credential_store: crate::domain::CredentialStoreKind::WindowsCredentialManager,
        };
        let error = provider_for_execution_with_capabilities(&repository, &capabilities)
            .await
            .unwrap_err();

        assert!(matches!(error, AtlasError::Provider(_)));
        assert_eq!(
            error.to_string(),
            "analysis provider error: 当前 Windows 平台不支持分析 provider `codex_cli`；设置已恢复为 OpenAI API，本次操作未执行，请确认凭据后重试"
        );
        assert_eq!(
            repository.get_analysis_provider().await.unwrap(),
            AnalysisProviderKind::OpenaiApi
        );
    }
}
