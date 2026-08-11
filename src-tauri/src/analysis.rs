use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::{
    domain::{
        AnalysisProgress, AnalysisSnapshot, AnalysisState, IssueSeverity, MAX_SEMANTIC_UNITS, Mode,
        ModeMembership, Provenance, Relation, SemanticUnit, SourceMessage, SourceSpan, Speaker,
        ValidationIssue, VisibleTurn,
    },
    error::{AtlasError, AtlasResult},
    openai::StructuredResult,
    provider::AnalysisProvider,
    repository::{Repository, StoredConversation, StoredRun},
    schemas::{modes_schema, relations_schema, segmentation_schema},
    spans::{
        model_span_to_source, sha256_hex, source_span_to_model_quote, utf16_len, validate_span,
    },
};

const SEGMENT_CHARS: usize = 12_000;
const RELATION_SOURCE_BATCH: usize = 80;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSpan {
    message_id: String,
    start_utf16: usize,
    end_utf16: usize,
    exact_quote: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelUnit {
    turn_id: String,
    speaker: String,
    label: String,
    acts: Vec<String>,
    importance: f32,
    primary: bool,
    operation_only: bool,
    spans: Vec<ModelSpan>,
}

#[derive(Debug, Deserialize)]
struct SegmentationOutput {
    units: Vec<ModelUnit>,
}

#[derive(Debug, Deserialize)]
struct RelationsOutput {
    relations: Vec<ModelRelation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRelation {
    source: String,
    target: String,
    kind: String,
    label: String,
    confidence: f32,
    evidence_unit_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ModesOutput {
    modes: Vec<ModelMode>,
    memberships: Vec<ModelMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelMode {
    local_id: String,
    kind: String,
    label: String,
    confidence: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelMembership {
    mode_local_id: String,
    unit_id: String,
    confidence: f32,
}

pub async fn run_analysis_job(
    repository: Repository,
    provider: AnalysisProvider,
    app: AppHandle,
    run: StoredRun,
    cancelled: Arc<AtomicBool>,
) -> AtlasResult<AnalysisSnapshot> {
    let conversation = repository.load_conversation(&run.conversation_id).await?;
    check_cancelled(&cancelled)?;
    transition(
        &repository,
        &app,
        &run,
        AnalysisState::Segmenting,
        0.08,
        "正在拆分可观察发言并分类对话行为",
    )
    .await?;

    let mut issues = Vec::new();
    let mut partial = false;
    let mut input_tokens = 0i64;
    let mut output_tokens = 0i64;
    let mut raw_segmentation = Vec::new();
    let chunks = build_turn_chunks(&conversation);
    let mut model_units = Vec::new();
    let mut valid_segment_calls = 0usize;
    let mut first_segment_error = None;
    for (index, turn_ids) in chunks.iter().enumerate() {
        check_cancelled(&cancelled)?;
        let input = segmentation_input(&conversation, turn_ids);
        match call_model_once(
            &provider,
            "dialogue_units",
            segmentation_schema(),
            SEGMENT_SYSTEM,
            input,
            &cancelled,
        )
        .await
        {
            Ok(result) => {
                input_tokens += result.input_tokens;
                output_tokens += result.output_tokens;
                raw_segmentation.push(result.value.clone());
                match serde_json::from_value::<SegmentationOutput>(result.value) {
                    Ok(output) => {
                        valid_segment_calls += 1;
                        model_units.extend(output.units);
                    }
                    Err(error) => {
                        partial = true;
                        issues.push(issue(
                            "segmenting",
                            None,
                            IssueSeverity::Error,
                            format!("第 {} 个分块结构无效：{error}", index + 1),
                        ));
                    }
                }
            }
            Err(error) => {
                partial = true;
                let message = format!("第 {} 个分块请求失败：{error}", index + 1);
                issues.push(issue("segmenting", None, IssueSeverity::Error, message));
                if first_segment_error.is_none() {
                    first_segment_error = Some(error);
                }
            }
        }
        emit_progress(
            &app,
            &run,
            AnalysisState::Segmenting,
            0.08 + 0.34 * ((index + 1) as f32 / chunks.len().max(1) as f32),
            "正在校验逐字证据",
        );
    }

    let (mut units, conversion_issues, used_fallback) = normalize_units(&conversation, model_units);
    issues.extend(conversion_issues);
    partial |= used_fallback || valid_segment_calls < chunks.len();
    require_model_segmentation(&units, first_segment_error)?;
    if units.len() > MAX_SEMANTIC_UNITS {
        units.sort_by_key(|unit| {
            conversation
                .turns
                .iter()
                .find(|turn| turn.id == unit.turn_id)
                .map(|turn| turn.ordinal)
                .unwrap_or(usize::MAX)
        });
        units.truncate(MAX_SEMANTIC_UNITS);
        partial = true;
        issues.push(issue(
            "segmenting",
            None,
            IssueSeverity::Error,
            format!("语义单元超过 {MAX_SEMANTIC_UNITS}，超出部分未进入图谱"),
        ));
    }

    check_cancelled(&cancelled)?;
    transition(
        &repository,
        &app,
        &run,
        AnalysisState::Linking,
        0.46,
        "正在识别有方向、可举证的逻辑关系",
    )
    .await?;
    let relational_units = primary_relational_units(&units);
    let (relations, relation_issues, relation_partial, relation_usage, raw_relations) =
        if valid_segment_calls > 0 && relational_units.len() > 1 {
            analyze_relations(&provider, &conversation, &relational_units, &cancelled).await
        } else if valid_segment_calls > 0 {
            (Vec::new(), Vec::new(), false, (0, 0), Vec::new())
        } else {
            (
                Vec::new(),
                vec![issue(
                    "linking",
                    None,
                    IssueSeverity::Error,
                    "语义切片完全失败，已跳过关系推断".into(),
                )],
                true,
                (0, 0),
                Vec::new(),
            )
        };
    input_tokens += relation_usage.0;
    output_tokens += relation_usage.1;
    issues.extend(relation_issues);
    partial |= relation_partial;

    check_cancelled(&cancelled)?;
    transition(
        &repository,
        &app,
        &run,
        AnalysisState::Modes,
        0.72,
        "正在生成可重复、可重叠的模式叠层",
    )
    .await?;
    let (modes, memberships, mode_issues, mode_partial, mode_usage, raw_modes) =
        if valid_segment_calls > 0 {
            analyze_modes(&provider, &units, &cancelled).await
        } else {
            fallback_unclassified(&units)
        };
    input_tokens += mode_usage.0;
    output_tokens += mode_usage.1;
    issues.extend(mode_issues);
    partial |= mode_partial;

    check_cancelled(&cancelled)?;
    transition(
        &repository,
        &app,
        &run,
        AnalysisState::Validating,
        0.91,
        "正在执行端点、引用和 UTF-16 边界检查",
    )
    .await?;
    let mut snapshot = AnalysisSnapshot {
        id: Uuid::new_v4().to_string(),
        run_id: run.id.clone(),
        conversation_id: run.conversation_id.clone(),
        provider: run.provider,
        provider_version: run.provider_version.clone(),
        credential_mode: run.credential_mode.clone(),
        model_id: run.model_id.clone(),
        prompt_version: run.prompt_version.clone(),
        schema_version: run.schema_version.clone(),
        status: if partial {
            AnalysisState::Partial
        } else {
            AnalysisState::Ready
        },
        semantic_units: units,
        relations,
        modes,
        memberships,
        validation_issues: issues,
        raw_model_output: json!({
            "segmentation": raw_segmentation,
            "relations": raw_relations,
            "modes": raw_modes,
        }),
        input_tokens: Some(input_tokens),
        output_tokens: Some(output_tokens),
        created_at: Utc::now(),
    };
    let final_issues = validate_snapshot(&conversation.messages, &snapshot);
    if !final_issues.is_empty() {
        snapshot.status = AnalysisState::Partial;
        snapshot.validation_issues.extend(final_issues);
    }
    repository.save_snapshot(&snapshot).await?;
    repository
        .update_run(
            &run.id,
            snapshot.status.clone(),
            None,
            snapshot.input_tokens,
            snapshot.output_tokens,
        )
        .await?;
    emit_progress(
        &app,
        &run,
        snapshot.status.clone(),
        1.0,
        if snapshot.status == AnalysisState::Ready {
            "分析完成"
        } else {
            "分析已完成，但有项目需要复核"
        },
    );
    Ok(snapshot)
}

async fn analyze_relations(
    provider: &AnalysisProvider,
    conversation: &StoredConversation,
    units: &[SemanticUnit],
    cancelled: &Arc<AtomicBool>,
) -> (
    Vec<Relation>,
    Vec<ValidationIssue>,
    bool,
    (i64, i64),
    Vec<Value>,
) {
    let mut relations = Vec::new();
    let mut issues = Vec::new();
    let mut partial = false;
    let mut usage = (0, 0);
    let mut raw_outputs = Vec::new();
    let unit_ids: HashSet<_> = units.iter().map(|unit| unit.id.as_str()).collect();
    let units_by_id: HashMap<_, _> = units.iter().map(|unit| (unit.id.as_str(), unit)).collect();
    let mut seen = HashSet::new();

    for batch in units.chunks(RELATION_SOURCE_BATCH) {
        if check_cancelled(cancelled).is_err() {
            return (relations, issues, true, usage, raw_outputs);
        }
        let allowed_sources: HashSet<_> = batch.iter().map(|unit| unit.id.as_str()).collect();
        let input = relation_input(conversation, units, batch);
        match call_model_once(
            provider,
            "dialogue_relations",
            relations_schema(),
            RELATION_SYSTEM,
            input,
            cancelled,
        )
        .await
        {
            Ok(result) => {
                usage.0 += result.input_tokens;
                usage.1 += result.output_tokens;
                raw_outputs.push(result.value.clone());
                match serde_json::from_value::<RelationsOutput>(result.value) {
                    Ok(output) => {
                        for candidate in output.relations {
                            let dedupe = format!(
                                "{}|{}|{}",
                                candidate.source, candidate.target, candidate.kind
                            );
                            if !allowed_sources.contains(candidate.source.as_str())
                                || !unit_ids.contains(candidate.source.as_str())
                                || !unit_ids.contains(candidate.target.as_str())
                                || candidate.source == candidate.target
                                || !seen.insert(dedupe)
                            {
                                issues.push(issue(
                                    "linking",
                                    None,
                                    IssueSeverity::Warning,
                                    "已丢弃端点无效、重复或自指的关系".into(),
                                ));
                                continue;
                            }
                            let mut evidence_ids = HashSet::new();
                            let evidence: Vec<SourceSpan> = candidate
                                .evidence_unit_ids
                                .iter()
                                .filter(|id| evidence_ids.insert(id.as_str()))
                                .filter_map(|id| units_by_id.get(id.as_str()))
                                .flat_map(|unit| unit.source_spans.clone())
                                .collect();
                            if evidence.is_empty() {
                                issues.push(issue(
                                    "linking",
                                    None,
                                    IssueSeverity::Warning,
                                    "已丢弃没有可核验语义单元证据的关系".into(),
                                ));
                                continue;
                            }
                            relations.push(Relation {
                                id: Uuid::new_v4().to_string(),
                                source: candidate.source,
                                target: candidate.target,
                                kind: candidate.kind,
                                label: candidate.label.trim().to_string(),
                                confidence: candidate.confidence.clamp(0.0, 1.0),
                                evidence,
                                user_created: false,
                            });
                        }
                    }
                    Err(error) => {
                        partial = true;
                        issues.push(issue(
                            "linking",
                            None,
                            IssueSeverity::Error,
                            format!("关系结果结构无效：{error}"),
                        ));
                    }
                }
            }
            Err(error) => {
                partial = true;
                issues.push(issue(
                    "linking",
                    None,
                    IssueSeverity::Error,
                    format!("关系阶段请求失败：{error}"),
                ));
            }
        }
    }
    (relations, issues, partial, usage, raw_outputs)
}

async fn analyze_modes(
    provider: &AnalysisProvider,
    units: &[SemanticUnit],
    cancelled: &Arc<AtomicBool>,
) -> (
    Vec<Mode>,
    Vec<ModeMembership>,
    Vec<ValidationIssue>,
    bool,
    (i64, i64),
    Vec<Value>,
) {
    let result = call_model_once(
        provider,
        "dialogue_modes",
        modes_schema(),
        MODE_SYSTEM,
        mode_input(units),
        cancelled,
    )
    .await;
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            let mut fallback = fallback_unclassified(units);
            fallback.2.push(issue(
                "modes",
                None,
                IssueSeverity::Error,
                format!("模式阶段请求失败：{error}"),
            ));
            return fallback;
        }
    };
    let usage = (result.input_tokens, result.output_tokens);
    let raw_output = result.value.clone();
    let output: ModesOutput = match serde_json::from_value(result.value) {
        Ok(output) => output,
        Err(error) => {
            let mut fallback = fallback_unclassified(units);
            fallback.2.push(issue(
                "modes",
                None,
                IssueSeverity::Error,
                format!("模式结果结构无效：{error}"),
            ));
            fallback.4 = usage;
            fallback.5 = vec![raw_output];
            return fallback;
        }
    };
    let unit_ids: HashSet<_> = units.iter().map(|unit| unit.id.as_str()).collect();
    let mut local_to_id = HashMap::new();
    let mut modes = Vec::new();
    let mut issues = Vec::new();
    for candidate in output.modes {
        if local_to_id.contains_key(&candidate.local_id) {
            issues.push(issue(
                "modes",
                None,
                IssueSeverity::Warning,
                "已丢弃重复的模式 localId".into(),
            ));
            continue;
        }
        let id = Uuid::new_v4().to_string();
        local_to_id.insert(candidate.local_id, id.clone());
        modes.push(Mode {
            id,
            color: mode_color(&candidate.kind).into(),
            kind: candidate.kind,
            label: candidate.label.trim().to_string(),
            confidence: candidate.confidence.clamp(0.0, 1.0),
        });
    }
    let mut memberships = Vec::new();
    let mut seen = HashSet::new();
    for candidate in output.memberships {
        let Some(mode_id) = local_to_id.get(&candidate.mode_local_id) else {
            issues.push(issue(
                "modes",
                None,
                IssueSeverity::Warning,
                "已丢弃指向未知模式的归属".into(),
            ));
            continue;
        };
        if !unit_ids.contains(candidate.unit_id.as_str())
            || !seen.insert((mode_id.clone(), candidate.unit_id.clone()))
        {
            continue;
        }
        memberships.push(ModeMembership {
            id: Uuid::new_v4().to_string(),
            mode_id: mode_id.clone(),
            unit_id: candidate.unit_id,
            confidence: candidate.confidence.clamp(0.0, 1.0),
        });
    }
    (modes, memberships, issues, false, usage, vec![raw_output])
}

fn normalize_units(
    conversation: &StoredConversation,
    candidates: Vec<ModelUnit>,
) -> (Vec<SemanticUnit>, Vec<ValidationIssue>, bool) {
    let messages: HashMap<_, _> = conversation
        .messages
        .iter()
        .map(|message| (message.id.as_str(), message))
        .collect();
    let turns: HashMap<_, _> = conversation
        .turns
        .iter()
        .map(|turn| (turn.id.as_str(), turn))
        .collect();
    let mut normalized = Vec::new();
    let mut issues = Vec::new();
    let mut seen_spans = HashSet::new();

    for candidate in candidates {
        let Some(turn) = turns.get(candidate.turn_id.as_str()) else {
            issues.push(issue(
                "segmenting",
                None,
                IssueSeverity::Warning,
                "已丢弃引用未知轮次的语义单元".into(),
            ));
            continue;
        };
        let speaker = match candidate.speaker.as_str() {
            "user" => Speaker::User,
            "assistant" => Speaker::Assistant,
            _ => continue,
        };
        if speaker != turn.speaker {
            continue;
        }
        if candidate
            .spans
            .iter()
            .any(|span| !turn.message_ids.contains(&span.message_id))
        {
            issues.push(issue(
                "segmenting",
                None,
                IssueSeverity::Warning,
                "已丢弃跨越错误轮次的语义单元".into(),
            ));
            continue;
        }
        let Ok(source_spans) = normalize_spans(
            &candidate.spans,
            &messages,
            conversation.summary.analyze_redacted,
        ) else {
            issues.push(issue(
                "segmenting",
                None,
                IssueSeverity::Warning,
                "已丢弃无法逐字核验的语义单元".into(),
            ));
            continue;
        };
        let signature = source_spans
            .iter()
            .map(|span| {
                format!(
                    "{}:{}:{}",
                    span.message_id, span.start_utf16, span.end_utf16
                )
            })
            .collect::<Vec<_>>()
            .join("|");
        if source_spans.is_empty() || !seen_spans.insert(signature) {
            continue;
        }
        let mut seen_acts = HashSet::new();
        let acts = candidate
            .acts
            .into_iter()
            .filter(|act| seen_acts.insert(act.clone()))
            .collect();
        let commentary_only = speaker == Speaker::Assistant
            && source_spans.iter().all(|span| {
                messages
                    .get(span.message_id.as_str())
                    .and_then(|message| message.phase.as_deref())
                    == Some("commentary")
            });
        let operation_only = turn.operation_only || candidate.operation_only || commentary_only;
        let importance = if operation_only {
            candidate.importance.clamp(0.0, 0.45)
        } else {
            candidate.importance.clamp(0.0, 1.0)
        };
        normalized.push(SemanticUnit {
            id: Uuid::new_v4().to_string(),
            turn_id: candidate.turn_id,
            speaker,
            label: candidate.label.trim().chars().take(80).collect(),
            acts,
            importance,
            provenance: Provenance::Model,
            source_spans,
            primary: candidate.primary && !operation_only,
            operation_only,
        });
    }

    let mut result = Vec::new();
    let mut used_fallback = false;
    for turn in &conversation.turns {
        let mut turn_units: Vec<SemanticUnit> = normalized
            .iter()
            .filter(|unit| unit.turn_id == turn.id)
            .cloned()
            .collect();
        if turn.speaker == Speaker::User {
            let fallback = fallback_unit(conversation, turn);
            let mut acts = Vec::new();
            for act in turn_units.iter().flat_map(|unit| unit.acts.iter()) {
                if !acts.contains(act) {
                    acts.push(act.clone());
                }
            }
            let label = turn_units
                .first()
                .map(|unit| unit.label.clone())
                .unwrap_or_else(|| fallback.label.clone());
            let operation_only =
                turn.operation_only || turn_units.iter().any(|unit| unit.operation_only);
            let importance = turn_units
                .iter()
                .map(|unit| unit.importance)
                .fold(fallback.importance, f32::max);
            if turn_units.is_empty() {
                used_fallback = true;
                issues.push(issue(
                    "segmenting",
                    Some(fallback.id.clone()),
                    IssueSeverity::Warning,
                    "该用户轮次未获得可核验的模型切片，已保留为确定性锚点".into(),
                ));
            }
            result.push(SemanticUnit {
                label,
                acts: if acts.is_empty() { fallback.acts } else { acts },
                importance: if operation_only {
                    importance.min(0.45)
                } else {
                    importance
                },
                provenance: if turn_units.is_empty() {
                    Provenance::DeterministicFallback
                } else {
                    Provenance::Model
                },
                primary: !operation_only,
                operation_only,
                ..fallback
            });
        } else if turn_units.is_empty() {
            used_fallback = true;
            let fallback = fallback_unit(conversation, turn);
            issues.push(issue(
                "segmenting",
                Some(fallback.id.clone()),
                IssueSeverity::Warning,
                "该 GPT 轮次未获得可核验的模型切片，已使用逐字回退单元".into(),
            ));
            result.push(fallback);
        } else {
            turn_units.sort_by_key(|unit| {
                unit.source_spans
                    .first()
                    .map(|span| (span.message_id.clone(), span.start_utf16))
            });
            result.extend(turn_units);
        }
    }
    (result, issues, used_fallback)
}

fn require_model_segmentation(
    units: &[SemanticUnit],
    first_segment_error: Option<AtlasError>,
) -> AtlasResult<()> {
    if units
        .iter()
        .any(|unit| unit.provenance == Provenance::Model)
    {
        return Ok(());
    }

    Err(first_segment_error.unwrap_or_else(|| {
        AtlasError::Provider("语义切片未产生任何可核验语义单元，未生成图谱".into())
    }))
}

fn primary_relational_units(units: &[SemanticUnit]) -> Vec<SemanticUnit> {
    units
        .iter()
        .filter(|unit| unit.primary && !unit.operation_only)
        .cloned()
        .collect()
}

fn normalize_spans(
    candidates: &[ModelSpan],
    messages: &HashMap<&str, &SourceMessage>,
    used_redacted: bool,
) -> AtlasResult<Vec<SourceSpan>> {
    candidates
        .iter()
        .map(|span| {
            let message = messages
                .get(span.message_id.as_str())
                .ok_or_else(|| AtlasError::InvalidInput("span message not found".into()))?;
            model_span_to_source(
                message,
                span.start_utf16,
                span.end_utf16,
                &span.exact_quote,
                used_redacted,
            )
            .or_else(|_| repair_span(message, &span.exact_quote, used_redacted))
        })
        .collect()
}

fn repair_span(
    message: &SourceMessage,
    quote: &str,
    used_redacted: bool,
) -> AtlasResult<SourceSpan> {
    let text = if used_redacted {
        &message.redacted_text
    } else {
        &message.text
    };
    let matches: Vec<_> = text.match_indices(quote).collect();
    if matches.len() != 1 {
        return Err(AtlasError::InvalidInput(
            "quote was absent or not unique; offsets cannot be repaired".into(),
        ));
    }
    let byte_start = matches[0].0;
    let start = utf16_len(&text[..byte_start]);
    let end = start + utf16_len(quote);
    model_span_to_source(message, start, end, quote, used_redacted)
}

fn fallback_unit(conversation: &StoredConversation, turn: &VisibleTurn) -> SemanticUnit {
    let messages: Vec<_> = turn
        .message_ids
        .iter()
        .filter_map(|id| {
            conversation
                .messages
                .iter()
                .find(|message| &message.id == id)
        })
        .collect();
    let source_spans = messages
        .iter()
        .filter(|message| !message.text.is_empty())
        .map(|message| SourceSpan {
            message_id: message.id.clone(),
            start_utf16: 0,
            end_utf16: utf16_len(&message.text),
            exact_quote: message.text.clone(),
            sha256: sha256_hex(&message.text),
            model_saw_redacted: false,
        })
        .collect();
    let full_text = messages
        .iter()
        .map(|message| {
            if conversation.summary.analyze_redacted {
                message.redacted_text.as_str()
            } else {
                message.text.as_str()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    SemanticUnit {
        id: Uuid::new_v4().to_string(),
        turn_id: turn.id.clone(),
        speaker: turn.speaker,
        label: short_label(&full_text),
        acts: vec![if turn.operation_only {
            "话语管理".into()
        } else if turn.speaker == Speaker::User
            && (full_text.contains('?') || full_text.contains('？'))
        {
            "提问".into()
        } else {
            "其他".into()
        }],
        importance: if turn.operation_only {
            0.25
        } else if turn.speaker == Speaker::User {
            0.8
        } else {
            0.5
        },
        provenance: Provenance::DeterministicFallback,
        source_spans,
        primary: !turn.operation_only,
        operation_only: turn.operation_only,
    }
}

fn build_turn_chunks(conversation: &StoredConversation) -> Vec<Vec<String>> {
    let messages: HashMap<_, _> = conversation
        .messages
        .iter()
        .map(|message| (message.id.as_str(), message))
        .collect();
    let mut chunks = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut current_chars = 0usize;
    for turn in &conversation.turns {
        let turn_chars: usize = turn
            .message_ids
            .iter()
            .filter_map(|id| messages.get(id.as_str()))
            .map(|message| {
                if conversation.summary.analyze_redacted {
                    message.redacted_text.chars().count()
                } else {
                    message.text.chars().count()
                }
            })
            .sum();
        if !current.is_empty() && current_chars + turn_chars > SEGMENT_CHARS {
            let overlap = current.last().cloned();
            chunks.push(current);
            current = overlap.into_iter().collect();
            current_chars = current
                .iter()
                .filter_map(|id| conversation.turns.iter().find(|turn| &turn.id == id))
                .flat_map(|turn| turn.message_ids.iter())
                .filter_map(|id| messages.get(id.as_str()))
                .map(|message| {
                    if conversation.summary.analyze_redacted {
                        message.redacted_text.chars().count()
                    } else {
                        message.text.chars().count()
                    }
                })
                .sum();
        }
        current.push(turn.id.clone());
        current_chars += turn_chars;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn segmentation_input(conversation: &StoredConversation, turn_ids: &[String]) -> Value {
    let turn_set: HashSet<_> = turn_ids.iter().collect();
    json!({
        "instructions": "仅分析提供的可见文本。UTF-16 offset 相对于对应 text。每个实质性用户轮次保持一个结构锚点。assistant 的 commentary 若只是说明即将检索、读取、导出或检查，最多保留一个 operationOnly=true、primary=false、importance<=0.45 的次级单元。只管理对话工件的请求与结果（例如请求导出 JSONL、报告保存路径）也标为 operationOnly=true、primary=false、importance<=0.45；不要把借助附件讨论海报等实质内容误判为工件管理。final 只在多个意思能被独立引用或连接时拆分。primary 仅用于复述主逻辑必需的目标、结论、证据、决定和修正，不要把所有单元设为 primary。不要推断隐藏思维。",
        "turns": conversation.turns.iter().filter(|turn| turn_set.contains(&turn.id)).map(|turn| json!({
            "turnId": turn.id,
            "ordinal": turn.ordinal,
            "speaker": match turn.speaker { Speaker::User => "user", Speaker::Assistant => "assistant" },
            "operationOnly": turn.operation_only,
            "messages": turn.message_ids.iter().filter_map(|id| conversation.messages.iter().find(|m| &m.id == id)).map(|message| json!({
                "messageId": message.id,
                "phase": message.phase,
                "text": if conversation.summary.analyze_redacted { &message.redacted_text } else { &message.text }
            })).collect::<Vec<_>>()
        })).collect::<Vec<_>>()
    })
}

fn relation_input(
    conversation: &StoredConversation,
    units: &[SemanticUnit],
    sources: &[SemanticUnit],
) -> Value {
    let messages: HashMap<_, _> = conversation
        .messages
        .iter()
        .map(|message| (message.id.as_str(), message))
        .collect();
    json!({
        "instructions": "只输出 sourceUnitIds 中单元发出的关系；target 可为 catalog 任意单元。方向必须遵守 codebook，不得把时间先后当作逻辑关系。每条关系必须提供可逐字核验的已知 span。",
        "sourceUnitIds": sources.iter().map(|unit| &unit.id).collect::<Vec<_>>(),
        "catalog": units.iter().map(|unit| json!({
            "unitId": unit.id,
            "turnId": unit.turn_id,
            "speaker": match unit.speaker { Speaker::User => "user", Speaker::Assistant => "assistant" },
            "label": unit.label,
            "acts": unit.acts,
            "evidenceExcerpts": unit.source_spans.iter().filter_map(|span| {
                messages.get(span.message_id.as_str()).and_then(|message| {
                    source_span_to_model_quote(message, span, conversation.summary.analyze_redacted).ok()
                })
            }).collect::<Vec<_>>()
        })).collect::<Vec<_>>()
    })
}

fn mode_input(units: &[SemanticUnit]) -> Value {
    json!({
        "instructions": "模式是可重复、可重叠、可缺省的 AI 推断区域，不是聚类或固定阶段。模式 localId 只需在本次输出内唯一。",
        "units": units.iter().map(|unit| json!({
            "unitId": unit.id,
            "speaker": match unit.speaker { Speaker::User => "user", Speaker::Assistant => "assistant" },
            "label": unit.label,
            "acts": unit.acts
        })).collect::<Vec<_>>()
    })
}

/// Provider calls are intentionally single-attempt. Auth, quota, transport,
/// timeout, CLI exit and malformed-output failures may occur after paid work;
/// automatically replaying them could duplicate usage. Deterministic quote
/// repair remains local in `normalize_units` and never sends another request.
async fn call_model_once(
    provider: &AnalysisProvider,
    schema_name: &str,
    schema: Value,
    system: &str,
    input: Value,
    cancelled: &Arc<AtomicBool>,
) -> AtlasResult<StructuredResult> {
    provider
        .structured(schema_name, schema, system, input, cancelled)
        .await
}

fn fallback_unclassified(
    units: &[SemanticUnit],
) -> (
    Vec<Mode>,
    Vec<ModeMembership>,
    Vec<ValidationIssue>,
    bool,
    (i64, i64),
    Vec<Value>,
) {
    let mode_id = Uuid::new_v4().to_string();
    (
        vec![Mode {
            id: mode_id.clone(),
            kind: "未分类".into(),
            label: "待复核".into(),
            color: mode_color("未分类").into(),
            confidence: 0.0,
        }],
        units
            .iter()
            .map(|unit| ModeMembership {
                id: Uuid::new_v4().to_string(),
                mode_id: mode_id.clone(),
                unit_id: unit.id.clone(),
                confidence: 0.0,
            })
            .collect(),
        Vec::new(),
        true,
        (0, 0),
        Vec::new(),
    )
}

fn validate_snapshot(
    messages: &[SourceMessage],
    snapshot: &AnalysisSnapshot,
) -> Vec<ValidationIssue> {
    let message_map: HashMap<_, _> = messages
        .iter()
        .map(|message| (&message.id, message))
        .collect();
    let unit_ids: HashSet<_> = snapshot
        .semantic_units
        .iter()
        .map(|unit| &unit.id)
        .collect();
    let mode_ids: HashSet<_> = snapshot.modes.iter().map(|mode| &mode.id).collect();
    let mut issues = Vec::new();
    for unit in &snapshot.semantic_units {
        for span in &unit.source_spans {
            let valid = message_map
                .get(&span.message_id)
                .is_some_and(|message| validate_span(message, span).is_ok());
            if !valid {
                issues.push(issue(
                    "validating",
                    Some(unit.id.clone()),
                    IssueSeverity::Error,
                    "语义单元的证据无法回指原文".into(),
                ));
            }
        }
    }
    for relation in &snapshot.relations {
        if !unit_ids.contains(&relation.source)
            || !unit_ids.contains(&relation.target)
            || relation.evidence.is_empty()
        {
            issues.push(issue(
                "validating",
                Some(relation.id.clone()),
                IssueSeverity::Error,
                "关系端点或证据无效".into(),
            ));
        }
        for span in &relation.evidence {
            if !message_map
                .get(&span.message_id)
                .is_some_and(|message| validate_span(message, span).is_ok())
            {
                issues.push(issue(
                    "validating",
                    Some(relation.id.clone()),
                    IssueSeverity::Error,
                    "关系证据无法回指原文".into(),
                ));
            }
        }
    }
    for membership in &snapshot.memberships {
        if !unit_ids.contains(&membership.unit_id) || !mode_ids.contains(&membership.mode_id) {
            issues.push(issue(
                "validating",
                Some(membership.id.clone()),
                IssueSeverity::Error,
                "模式归属端点无效".into(),
            ));
        }
    }
    issues
}

async fn transition(
    repository: &Repository,
    app: &AppHandle,
    run: &StoredRun,
    state: AnalysisState,
    progress: f32,
    message: &str,
) -> AtlasResult<()> {
    repository
        .update_run(&run.id, state.clone(), None, None, None)
        .await?;
    emit_progress(app, run, state, progress, message);
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    run: &StoredRun,
    stage: AnalysisState,
    progress: f32,
    message: &str,
) {
    let (completed, total) = progress_counts(&stage);
    let _ = app.emit(
        "analysis_progress",
        AnalysisProgress {
            run_id: run.id.clone(),
            conversation_id: run.conversation_id.clone(),
            stage,
            progress,
            completed,
            total,
            message: message.into(),
        },
    );
}

fn progress_counts(stage: &AnalysisState) -> (usize, usize) {
    let completed = match stage {
        AnalysisState::Parsing | AnalysisState::Queued => 1,
        AnalysisState::PrivacyReview => 2,
        AnalysisState::Segmenting => 3,
        AnalysisState::Linking => 4,
        AnalysisState::Modes => 5,
        AnalysisState::Validating => 6,
        AnalysisState::Ready
        | AnalysisState::Partial
        | AnalysisState::Failed
        | AnalysisState::Cancelled => 7,
    };
    (completed, 7)
}

fn check_cancelled(cancelled: &AtomicBool) -> AtlasResult<()> {
    if cancelled.load(Ordering::Relaxed) {
        Err(AtlasError::Cancelled)
    } else {
        Ok(())
    }
}

fn issue(
    stage: &str,
    item_id: Option<String>,
    severity: IssueSeverity,
    message: String,
) -> ValidationIssue {
    ValidationIssue {
        stage: stage.into(),
        item_id,
        severity,
        message,
    }
}

fn short_label(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let label: String = compact.chars().take(28).collect();
    if compact.chars().count() > 28 {
        format!("{label}…")
    } else if label.is_empty() {
        "空白发言".into()
    } else {
        label
    }
}

fn mode_color(kind: &str) -> &'static str {
    match kind {
        "目标定位" => "#8B7CF6",
        "探索" => "#5BB8E8",
        "方案形成" => "#5FC9A5",
        "证据核验" => "#E8B65B",
        "质疑校正" => "#EE7D85",
        "决定" => "#A58BE8",
        "执行" => "#62BFA3",
        "协调" => "#7FA6D9",
        "元对话" => "#A9A9B5",
        _ => "#A5A7AF",
    }
}

const SEGMENT_SYSTEM: &str = r#"你是 Dialogue Atlas 的可观察对话标注器。只使用输入中明确可见的用户与 assistant 文本，不描述或推断隐藏思维、推理过程、工具状态或人格。输出短标签、多标签对话行为以及逐字证据。长回复仅按能被独立引用或建立逻辑关系的观点、提案、解释、证据、问题拆分；每个实质性用户轮次保持一个结构锚点。assistant commentary 中仅说明即将检索、读取、导出或检查的过程话，标为 operationOnly=true、primary=false、importance 不高于 0.45。只管理对话工件的请求与结果（例如请求导出 JSONL、报告保存路径）也使用相同的次级 operation 标记；借助附件讨论海报等实质内容不属于工件管理。primary 只留给复述主逻辑必需的目标、结论、证据、决定和修正，不要把所有单元设为 primary。"#;

const RELATION_SYSTEM: &str = r#"你是证据约束的对话关系标注器。关系方向是 source 对 target 施加所标关系，例如“修正”表示 source 修正 target，“回应”表示 source 回应 target。只标存在明确文本证据的关系；不得因为相邻或时间先后自动连边。撤回、重新打开和中断后续答可以跨越多个轮次。"#;

const MODE_SYSTEM: &str = r#"你为对话图谱添加柔性的模式叠层。模式不是无监督聚类，也不是必然按顺序推进的阶段；同一模式可以重复出现、形成分离区域，节点可以多重归属或无归属。kind 使用给定大类，label 写本对话中具体、简短的名称。"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::CommitImportRequest,
        import::{preview_codex_jsonl_content, preview_paste_content},
        repository::Repository,
    };

    #[tokio::test]
    async fn chunking_overlaps_one_turn_without_losing_order() {
        let repository = Repository::in_memory().await.unwrap();
        let large = "甲".repeat(7_000);
        let preview =
            preview_paste_content(&format!("用户: {large}\nGPT: {large}\n用户: 最后一个问题"))
                .unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "chunks".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let conversation = repository.load_conversation(&summary.id).await.unwrap();
        let chunks = build_turn_chunks(&conversation);
        assert!(chunks.len() >= 2);
        assert_eq!(chunks[0].last(), chunks[1].first());
    }

    #[test]
    fn repairs_only_unique_quote_offsets() {
        let message = SourceMessage {
            id: "m".into(),
            speaker: Speaker::User,
            phase: None,
            sequence: 0,
            external_message_id: None,
            source_event_index: None,
            text: "甲🧭乙".into(),
            text_sha256: sha256_hex("甲🧭乙"),
            redacted_text: "甲🧭乙".into(),
            redaction_map: Vec::new(),
            turn_ordinal: 1,
            operation_only: false,
            redactions: Vec::new(),
        };
        let span = repair_span(&message, "🧭", false).unwrap();
        assert_eq!((span.start_utf16, span.end_utf16), (1, 3));
    }

    #[tokio::test]
    async fn later_stage_inputs_never_reintroduce_redacted_source_text() {
        let repository = Repository::in_memory().await.unwrap();
        let preview = preview_paste_content("用户: 联系 a@example.com 再继续\nGPT: 明白").unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "privacy".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let conversation = repository.load_conversation(&summary.id).await.unwrap();
        let units: Vec<_> = conversation
            .turns
            .iter()
            .map(|turn| fallback_unit(&conversation, turn))
            .collect();
        let input = relation_input(&conversation, &units, &units);
        let encoded = input.to_string();
        assert!(!encoded.contains("a@example.com"));
        assert!(encoded.contains("[邮箱]"));
    }

    #[tokio::test]
    async fn deterministic_fallbacks_are_visible_review_issues() {
        let repository = Repository::in_memory().await.unwrap();
        let preview = preview_paste_content("用户: 问题\nGPT: 回答").unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "fallback".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let conversation = repository.load_conversation(&summary.id).await.unwrap();
        let (units, issues, used_fallback) = normalize_units(&conversation, Vec::new());

        assert!(used_fallback);
        assert_eq!(units.len(), 2);
        assert!(
            units
                .iter()
                .all(|unit| unit.provenance == Provenance::DeterministicFallback)
        );
        assert_eq!(issues.len(), 2);
        assert!(issues.iter().all(|issue| issue.item_id.is_some()));

        let error = require_model_segmentation(&units, None).unwrap_err();
        assert_eq!(
            error.to_string(),
            "analysis provider error: 语义切片未产生任何可核验语义单元，未生成图谱"
        );

        let upstream = AtlasError::Provider("Codex 请求被限流（HTTP 429）".into());
        let error = require_model_segmentation(&units, Some(upstream)).unwrap_err();
        assert_eq!(
            error.to_string(),
            "analysis provider error: Codex 请求被限流（HTTP 429）"
        );

        let mut partly_model_backed = units;
        partly_model_backed[0].provenance = Provenance::Model;
        assert!(require_model_segmentation(&partly_model_backed, None).is_ok());
    }

    #[tokio::test]
    async fn assistant_commentary_units_are_forced_to_secondary_operations() {
        let repository = Repository::in_memory().await.unwrap();
        let jsonl = r#"{"type":"response_item","payload":{"type":"message","role":"user","id":"u1","content":[{"type":"input_text","text":"请检查时间线"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","id":"a1","phase":"commentary","content":[{"type":"output_text","text":"我先检索日历。"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","id":"a2","phase":"final_answer","content":[{"type":"output_text","text":"活动时间已确认。"}]}}"#;
        let preview = preview_codex_jsonl_content(jsonl, None).unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "commentary-secondary".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let conversation = repository.load_conversation(&summary.id).await.unwrap();
        let user_turn = &conversation.turns[0];
        let assistant_turn = &conversation.turns[1];
        let user = &conversation.messages[0];
        let commentary = &conversation.messages[1];
        let final_answer = &conversation.messages[2];
        let full_span = |message: &SourceMessage| ModelSpan {
            message_id: message.id.clone(),
            start_utf16: 0,
            end_utf16: utf16_len(&message.redacted_text),
            exact_quote: message.redacted_text.clone(),
        };
        let candidates = vec![
            ModelUnit {
                turn_id: user_turn.id.clone(),
                speaker: "user".into(),
                label: "请求检查时间线".into(),
                acts: vec!["请求".into()],
                importance: 0.9,
                primary: true,
                operation_only: false,
                spans: vec![full_span(user)],
            },
            ModelUnit {
                turn_id: assistant_turn.id.clone(),
                speaker: "assistant".into(),
                label: "承诺检索日历".into(),
                acts: vec!["承诺".into()],
                importance: 0.9,
                primary: true,
                operation_only: false,
                spans: vec![full_span(commentary)],
            },
            ModelUnit {
                turn_id: assistant_turn.id.clone(),
                speaker: "assistant".into(),
                label: "确认活动时间".into(),
                acts: vec!["回答".into()],
                importance: 0.9,
                primary: true,
                operation_only: false,
                spans: vec![full_span(final_answer)],
            },
        ];

        let (units, issues, used_fallback) = normalize_units(&conversation, candidates);
        assert!(!used_fallback);
        assert!(issues.is_empty());

        let commentary_unit = units
            .iter()
            .find(|unit| unit.label == "承诺检索日历")
            .unwrap();
        assert!(!commentary_unit.primary);
        assert!(commentary_unit.operation_only);
        assert_eq!(commentary_unit.importance, 0.45);

        let final_unit = units
            .iter()
            .find(|unit| unit.label == "确认活动时间")
            .unwrap();
        assert!(final_unit.primary);
        assert!(!final_unit.operation_only);
    }

    #[tokio::test]
    async fn model_marked_artifact_logistics_stay_secondary_and_out_of_relations() {
        let repository = Repository::in_memory().await.unwrap();
        let preview = preview_paste_content("用户: 请导出 JSONL\nGPT: 已保存导出文件").unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "artifact-logistics".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let conversation = repository.load_conversation(&summary.id).await.unwrap();
        let candidates: Vec<ModelUnit> = conversation
            .turns
            .iter()
            .map(|turn| {
                let message = conversation
                    .messages
                    .iter()
                    .find(|message| turn.message_ids.contains(&message.id))
                    .unwrap();
                ModelUnit {
                    turn_id: turn.id.clone(),
                    speaker: match turn.speaker {
                        Speaker::User => "user".into(),
                        Speaker::Assistant => "assistant".into(),
                    },
                    label: if turn.speaker == Speaker::User {
                        "请求导出JSONL".into()
                    } else {
                        "报告导出结果".into()
                    },
                    acts: vec![if turn.speaker == Speaker::User {
                        "任务".into()
                    } else {
                        "回答".into()
                    }],
                    importance: 0.9,
                    primary: false,
                    operation_only: true,
                    spans: vec![ModelSpan {
                        message_id: message.id.clone(),
                        start_utf16: 0,
                        end_utf16: utf16_len(&message.redacted_text),
                        exact_quote: message.redacted_text.clone(),
                    }],
                }
            })
            .collect();

        let (units, issues, used_fallback) = normalize_units(&conversation, candidates);
        assert!(!used_fallback);
        assert!(issues.is_empty());
        assert!(units.iter().all(|unit| !unit.primary));
        assert!(units.iter().all(|unit| unit.operation_only));
        assert!(units.iter().all(|unit| unit.importance <= 0.45));
        assert!(primary_relational_units(&units).is_empty());
    }
}
