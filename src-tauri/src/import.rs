use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use uuid::Uuid;

use crate::{
    domain::{
        ImportPreview, MAX_TRANSCRIPT_CHARS, MAX_VISIBLE_TURNS, SourceMessage, Speaker, VisibleTurn,
    },
    error::{AtlasError, AtlasResult},
    spans::{redact_text, sha256_hex},
};

const VISIBLE_CONVERSATION_EXPORT_SCOPE: &str =
    "user-visible user and assistant messages; tool calls and hidden reasoning excluded";
const CODEX_FILES_MENTIONED_HEADER: &str = "# Files mentioned by the user:";
const CODEX_REQUEST_HEADER: &str = "## My request for Codex:";

static INJECTED_BLOCKS: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        "app-context",
        "recommended_plugins",
        "environment_context",
        "skills_instructions",
        "permissions instructions",
        "collaboration_mode",
        "codex_internal_context",
    ]
    .into_iter()
    .map(|tag| {
        Regex::new(&format!(
            r"(?is)<{tag}\b[^>]*>.*?</{tag}\s*>",
            tag = regex::escape(tag)
        ))
        .expect("static injected block regex")
    })
    .collect()
});

static PASTE_SPEAKER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*(用户|user|我|assistant|gpt|codex|助手)\s*[:：]\s*(.*)$")
        .expect("static paste speaker regex")
});

pub fn preview_codex_jsonl_content(
    content: &str,
    source_path: Option<String>,
) -> AtlasResult<ImportPreview> {
    let mut messages = Vec::new();
    let mut warnings = Vec::new();
    let mut seen_external_ids = HashSet::new();
    let mut invalid_lines = 0usize;
    let visible_export_header = detect_visible_conversation_export_header(content);
    let mut visible_export_messages = 0usize;

    for (event_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let record: Value = match serde_json::from_str(trimmed) {
            Ok(record) => record,
            Err(_) => {
                invalid_lines += 1;
                continue;
            }
        };
        let parsed = if visible_export_header.is_some() {
            extract_flat_visible_message(&record)
        } else {
            extract_rollout_visible_message(&record)
        };
        let Some(parsed) = parsed else {
            continue;
        };
        if parsed.from_visible_export {
            visible_export_messages += 1;
        }
        let external_id = parsed.external_id;
        if let Some(id) = &external_id
            && !seen_external_ids.insert(id.clone())
        {
            warnings.push(format!("已跳过重复消息 ID：{id}"));
            continue;
        }
        let visible_text = normalize_visible_message_text(&parsed.raw_text, parsed.speaker);
        if visible_text.is_empty() {
            continue;
        }
        messages.push(make_message(
            messages.len(),
            parsed.speaker,
            parsed.phase,
            external_id,
            Some(event_index),
            visible_text,
        ));
    }

    if invalid_lines > 0 {
        warnings.push(format!("有 {invalid_lines} 行不是有效 JSON，已跳过"));
    }
    if visible_export_messages > 0 {
        warnings.push(
            "已按可见对话导出格式读取；仅保留 user/assistant 文本，工具与隐藏推理不导入".into(),
        );
    }
    if messages.is_empty() {
        return Err(AtlasError::InvalidInput(
            "没有找到支持的可见对话消息；请选择 Codex rollout JSONL，或带可见对话头的 conversation export JSONL"
                .into(),
        ));
    }
    let path_title = source_path
        .as_deref()
        .and_then(|path| std::path::Path::new(path).file_stem())
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Codex 对话")
        .to_string();
    let title = visible_export_header
        .and_then(|header| header.title)
        .unwrap_or(path_title);
    make_preview(
        "codex_jsonl",
        title,
        source_path,
        sha256_hex(content),
        messages,
        warnings,
    )
}

#[derive(Debug)]
struct VisibleConversationExportHeader {
    title: Option<String>,
}

#[derive(Debug)]
struct ParsedVisibleMessage {
    speaker: Speaker,
    phase: Option<String>,
    external_id: Option<String>,
    raw_text: String,
    from_visible_export: bool,
}

fn detect_visible_conversation_export_header(
    content: &str,
) -> Option<VisibleConversationExportHeader> {
    let first_record = content.lines().find(|line| !line.trim().is_empty())?.trim();
    let first_record = first_record
        .strip_prefix('\u{feff}')
        .unwrap_or(first_record);
    let record: Value = serde_json::from_str(first_record).ok()?;
    if record.get("record_type").and_then(Value::as_str) != Some("conversation")
        || record.get("scope").and_then(Value::as_str) != Some(VISIBLE_CONVERSATION_EXPORT_SCOPE)
    {
        return None;
    }
    record.get("thread_id").and_then(Value::as_str)?;
    let title = record
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(ToOwned::to_owned);
    Some(VisibleConversationExportHeader { title })
}

fn extract_rollout_visible_message(record: &Value) -> Option<ParsedVisibleMessage> {
    if record.get("type").and_then(Value::as_str) != Some("response_item") {
        return None;
    }
    let payload = record.get("payload")?;
    if payload.get("type").and_then(Value::as_str) != Some("message") {
        return None;
    }
    Some(ParsedVisibleMessage {
        speaker: parse_visible_speaker(payload.get("role"))?,
        phase: parse_visible_phase(payload.get("phase")),
        external_id: payload
            .get("id")
            .or_else(|| payload.get("message_id"))
            .or_else(|| record.get("id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        raw_text: extract_message_text(payload.get("content"))?,
        from_visible_export: false,
    })
}

fn extract_flat_visible_message(record: &Value) -> Option<ParsedVisibleMessage> {
    if !matches!(
        record.get("record_type").and_then(Value::as_str),
        None | Some("message")
    ) {
        return None;
    }
    record.get("turn_id").and_then(Value::as_str)?;
    let message_id = record.get("message_id").and_then(Value::as_str)?;
    Some(ParsedVisibleMessage {
        speaker: parse_visible_speaker(record.get("role"))?,
        phase: parse_visible_phase(record.get("phase")),
        external_id: Some(message_id.to_owned()),
        raw_text: record.get("text").and_then(Value::as_str)?.to_owned(),
        from_visible_export: true,
    })
}

fn parse_visible_speaker(value: Option<&Value>) -> Option<Speaker> {
    match value.and_then(Value::as_str) {
        Some("user") => Some(Speaker::User),
        Some("assistant") => Some(Speaker::Assistant),
        _ => None,
    }
}

fn parse_visible_phase(value: Option<&Value>) -> Option<String> {
    match value.and_then(Value::as_str) {
        Some("commentary") => Some("commentary".into()),
        Some("final" | "final_answer") => Some("final".into()),
        _ => None,
    }
}

pub fn preview_paste_content(content: &str) -> AtlasResult<ImportPreview> {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if normalized.trim().is_empty() {
        return Err(AtlasError::InvalidInput("粘贴文本为空".into()));
    }
    let mut sections: Vec<(Speaker, String)> = Vec::new();
    let mut current: Option<(Speaker, String)> = None;
    let mut saw_marker = false;

    for line in normalized.lines() {
        if let Some(captures) = PASTE_SPEAKER.captures(line) {
            saw_marker = true;
            if let Some((speaker, text)) = current.take()
                && !text.trim().is_empty()
            {
                sections.push((speaker, text.trim().to_string()));
            }
            let marker = captures.get(1).expect("speaker capture").as_str();
            let speaker = match marker.to_ascii_lowercase().as_str() {
                "assistant" | "gpt" | "codex" | "助手" => Speaker::Assistant,
                _ => Speaker::User,
            };
            current = Some((
                speaker,
                captures
                    .get(2)
                    .map(|m| m.as_str())
                    .unwrap_or_default()
                    .to_string(),
            ));
        } else if let Some((_, text)) = current.as_mut() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(line);
        } else if !line.trim().is_empty() {
            current = Some((Speaker::User, line.to_string()));
        }
    }
    if let Some((speaker, text)) = current
        && !text.trim().is_empty()
    {
        sections.push((speaker, text.trim().to_string()));
    }

    let mut warnings = Vec::new();
    if !saw_marker {
        warnings.push("未识别到说话者标记，已暂按一条用户消息处理；请在提交前校正".into());
        sections = vec![(Speaker::User, normalized.trim().to_string())];
    }
    let messages = sections
        .into_iter()
        .enumerate()
        .map(|(index, (speaker, text))| make_message(index, speaker, None, None, None, text))
        .collect();
    make_preview(
        "paste",
        "粘贴的对话".into(),
        None,
        sha256_hex(&normalized),
        messages,
        warnings,
    )
}

fn extract_message_text(content: Option<&Value>) -> Option<String> {
    match content? {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => {
            let texts: Vec<&str> = parts
                .iter()
                .filter_map(|part| {
                    let kind = part.get("type").and_then(Value::as_str)?;
                    if !matches!(kind, "input_text" | "output_text" | "text") {
                        return None;
                    }
                    part.get("text").and_then(Value::as_str)
                })
                .collect();
            (!texts.is_empty()).then(|| texts.join("\n"))
        }
        _ => None,
    }
}

fn strip_injected_blocks(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let stripped = INJECTED_BLOCKS.iter().fold(normalized, |text, regex| {
        regex.replace_all(&text, "").into_owned()
    });
    stripped.trim().to_string()
}

fn normalize_visible_message_text(raw: &str, speaker: Speaker) -> String {
    let without_leading_line_breaks = raw.trim_start_matches(['\r', '\n']);
    let has_exact_wrapper_start = speaker == Speaker::User
        && without_leading_line_breaks.starts_with(CODEX_FILES_MENTIONED_HEADER);
    let stripped = strip_injected_blocks(raw);
    if !has_exact_wrapper_start {
        return stripped;
    }
    extract_codex_attachment_request(&stripped).unwrap_or(stripped)
}

fn extract_codex_attachment_request(text: &str) -> Option<String> {
    let after_files_header = text.strip_prefix(CODEX_FILES_MENTIONED_HEADER)?;
    let (_, request_body) = after_files_header.split_once(CODEX_REQUEST_HEADER)?;
    Some(strip_trailing_image_display_blocks(request_body))
}

fn strip_trailing_image_display_blocks(mut text: &str) -> String {
    loop {
        let trimmed = text.trim_end();
        let Some(without_closing_tag) = trimmed.strip_suffix("</image>") else {
            break;
        };
        let Some(opening_start) = without_closing_tag.rfind("<image") else {
            break;
        };
        let opening_suffix = &without_closing_tag[opening_start + "<image".len()..];
        let Some(opening_boundary) = opening_suffix.chars().next() else {
            break;
        };
        if opening_boundary != '>' && !opening_boundary.is_whitespace() {
            break;
        }
        if !opening_suffix.contains('>') {
            break;
        }
        text = &without_closing_tag[..opening_start];
    }
    text.trim().to_string()
}

fn make_message(
    sequence: usize,
    speaker: Speaker,
    phase: Option<String>,
    external_message_id: Option<String>,
    source_event_index: Option<usize>,
    text: String,
) -> SourceMessage {
    let id = Uuid::new_v4().to_string();
    let (redacted_text, redaction_map, _) = redact_text(&id, &text);
    SourceMessage {
        id,
        speaker,
        phase,
        sequence,
        external_message_id,
        source_event_index,
        text_sha256: sha256_hex(&text),
        text,
        redacted_text,
        redaction_map,
        turn_ordinal: 0,
        operation_only: false,
        redactions: Vec::new(),
    }
}

fn make_preview(
    source_kind: &str,
    title: String,
    source_path: Option<String>,
    source_sha256: String,
    mut messages: Vec<SourceMessage>,
    warnings: Vec<String>,
) -> AtlasResult<ImportPreview> {
    let turns = build_turns(&messages);
    let character_count = messages.iter().map(|m| m.text.chars().count()).sum();
    let privacy_findings = messages
        .iter()
        .flat_map(|message| redact_text(&message.id, &message.text).2)
        .collect();
    for message in &mut messages {
        if let Some(turn) = turns
            .iter()
            .find(|turn| turn.message_ids.contains(&message.id))
        {
            message.turn_ordinal = turn.ordinal + 1;
            message.operation_only = turn.operation_only;
        }
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
    let preview = ImportPreview {
        id: Uuid::new_v4().to_string(),
        title,
        source_kind: source_kind.into(),
        source_path,
        source_sha256,
        messages,
        turns,
        character_count,
        privacy_findings,
        warnings,
    };
    validate_preview(&preview)?;
    Ok(preview)
}

pub fn build_turns(messages: &[SourceMessage]) -> Vec<VisibleTurn> {
    let mut turns: Vec<VisibleTurn> = Vec::new();
    for message in messages {
        let append_to_assistant = message.speaker == Speaker::Assistant
            && turns
                .last()
                .is_some_and(|turn| turn.speaker == Speaker::Assistant);
        if append_to_assistant {
            turns
                .last_mut()
                .expect("turn exists")
                .message_ids
                .push(message.id.clone());
        } else {
            let ordinal = turns.len();
            turns.push(VisibleTurn {
                id: Uuid::new_v4().to_string(),
                ordinal,
                speaker: message.speaker,
                operation_only: false,
                message_ids: vec![message.id.clone()],
            });
        }
    }
    let by_id: std::collections::HashMap<_, _> =
        messages.iter().map(|m| (m.id.as_str(), m)).collect();
    for turn in &mut turns {
        let text = turn
            .message_ids
            .iter()
            .filter_map(|id| by_id.get(id.as_str()))
            .map(|m| m.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        turn.operation_only = turn.speaker == Speaker::User && is_operation_only(&text);
    }
    turns
}

fn is_operation_only(text: &str) -> bool {
    let normalized = text.trim().to_ascii_lowercase().replace('，', ",");
    matches!(
        normalized.as_str(),
        "继续"
            | "请继续"
            | "网络波动,请继续"
            | "网络波动请继续"
            | "重试"
            | "稍等"
            | "等一下"
            | "continue"
            | "please continue"
    )
}

pub fn validate_preview(preview: &ImportPreview) -> AtlasResult<()> {
    if !matches!(preview.source_kind.as_str(), "codex_jsonl" | "paste") {
        return Err(AtlasError::InvalidInput("未知的导入来源类型".into()));
    }
    if preview.turns.len() > MAX_VISIBLE_TURNS {
        return Err(AtlasError::InvalidInput(format!(
            "可见轮次为 {}，上限为 {MAX_VISIBLE_TURNS}；请拆分后再导入",
            preview.turns.len()
        )));
    }
    let chars: usize = preview
        .messages
        .iter()
        .map(|m| m.text.chars().count())
        .sum();
    if chars > MAX_TRANSCRIPT_CHARS {
        return Err(AtlasError::InvalidInput(format!(
            "对话含 {chars} 个字符，上限为 {MAX_TRANSCRIPT_CHARS}；不会静默截断"
        )));
    }
    if chars != preview.character_count {
        return Err(AtlasError::InvalidInput("字符计数与预览内容不一致".into()));
    }
    let mut ids = HashSet::new();
    for (index, message) in preview.messages.iter().enumerate() {
        if !ids.insert(message.id.as_str()) {
            return Err(AtlasError::InvalidInput("消息 ID 重复".into()));
        }
        if message.sequence != index {
            return Err(AtlasError::InvalidInput("消息 sequence 不连续".into()));
        }
        if sha256_hex(&message.text) != message.text_sha256 {
            return Err(AtlasError::InvalidInput(format!(
                "消息 {} 的内容 hash 不匹配",
                message.id
            )));
        }
        let (expected_redacted, expected_map, _) = redact_text(&message.id, &message.text);
        if message.redacted_text != expected_redacted || message.redaction_map != expected_map {
            return Err(AtlasError::InvalidInput(format!(
                "消息 {} 的隐私遮盖映射已失效，请重新生成预览",
                message.id
            )));
        }
    }
    let mut turn_ids = HashSet::new();
    let mut assigned_messages = HashSet::new();
    for (ordinal, turn) in preview.turns.iter().enumerate() {
        if turn.ordinal != ordinal || !turn_ids.insert(turn.id.as_str()) {
            return Err(AtlasError::InvalidInput("轮次 ordinal 或 ID 无效".into()));
        }
        if turn.message_ids.is_empty() {
            return Err(AtlasError::InvalidInput("轮次不能没有消息".into()));
        }
        for message_id in &turn.message_ids {
            if !assigned_messages.insert(message_id.as_str()) {
                return Err(AtlasError::InvalidInput("同一消息不能属于多个轮次".into()));
            }
            let message = preview
                .messages
                .iter()
                .find(|message| &message.id == message_id)
                .ok_or_else(|| AtlasError::InvalidInput("轮次引用了不存在的消息".into()))?;
            if message.speaker != turn.speaker {
                return Err(AtlasError::InvalidInput("轮次与消息的说话者不一致".into()));
            }
        }
    }
    if assigned_messages.len() != preview.messages.len() {
        return Err(AtlasError::InvalidInput("存在未归入可见轮次的消息".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rollout_keeps_visible_messages_and_strips_injections() {
        let jsonl = r#"{"type":"event_msg","payload":{"type":"agent_message","message":"duplicate"}}
{"type":"response_item","payload":{"type":"reasoning","summary":[]}}
{"type":"response_item","payload":{"type":"function_call","name":"shell"}}
{"type":"response_item","payload":{"type":"message","role":"user","id":"u1","content":[{"type":"input_text","text":"真实问题\n<environment_context>secret</environment_context>"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","id":"a1","phase":"commentary","content":[{"type":"output_text","text":"先检查"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","id":"a2","phase":"final","content":[{"type":"output_text","text":"结论"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","id":"a2","phase":"final","content":[{"type":"output_text","text":"duplicate"}]}}"#;
        let preview = preview_codex_jsonl_content(jsonl, None).unwrap();
        assert_eq!(preview.messages.len(), 3);
        assert_eq!(preview.turns.len(), 2);
        assert_eq!(preview.messages[0].text, "真实问题");
        assert_eq!(preview.turns[1].message_ids.len(), 2);
    }

    #[test]
    fn rollout_extracts_request_from_exact_attachment_wrapper() {
        let wrapped = "\n# Files mentioned by the user:\n\n## reference-one.png: /synthetic/reference-one.png\n\n## notes.pdf: /synthetic/notes.pdf\n\n## My request for Codex:\n\n请比较附件里的两版图，并联系 demo@example.com。\n\n<image name=\"reference-one.png\">Image displayed</image>\n<image name=\"reference-two.png\">Image displayed</image>";
        let jsonl = serde_json::to_string(&json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "id": "wrapped-user",
                "content": [{"type": "input_text", "text": wrapped}],
            }
        }))
        .unwrap();

        let preview = preview_codex_jsonl_content(&jsonl, None).unwrap();
        let message = &preview.messages[0];
        assert_eq!(
            message.text,
            "请比较附件里的两版图，并联系 demo@example.com。"
        );
        assert_eq!(message.text_sha256, sha256_hex(&message.text));
        let (expected_redacted, expected_map, _) = redact_text(&message.id, &message.text);
        assert_eq!(message.redacted_text, expected_redacted);
        assert_eq!(message.redaction_map, expected_map);
        assert_eq!(message.redaction_map.len(), 1);
        assert_eq!(message.redaction_map[0].kind, "email");
    }

    #[test]
    fn attachment_wrapper_near_matches_and_ordinary_markdown_are_unchanged() {
        let cases = [
            "# Files mentioned by the user :\n\n- attachment.png\n\n## My request for Codex:\n\n保留近似标题\n<image name=\"attachment.png\">Image displayed</image>",
            "# Files mentioned by the user:\n\n- attachment.png\n\n## My request for Codex\n\n保留缺少冒号的标题\n<image name=\"attachment.png\">Image displayed</image>",
            "普通 Markdown 前言\n\n# Files mentioned by the user:\n\n- attachment.png\n\n## My request for Codex:\n\n这些标题只是正文示例\n<image name=\"attachment.png\">literal HTML</image>",
        ];

        for (index, text) in cases.into_iter().enumerate() {
            let jsonl = serde_json::to_string(&json!({
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "id": format!("near-match-{index}"),
                    "content": [{"type": "input_text", "text": text}],
                }
            }))
            .unwrap();
            let preview = preview_codex_jsonl_content(&jsonl, None).unwrap();
            assert_eq!(preview.messages[0].text, text);
        }
    }

    #[test]
    fn assistant_text_that_looks_like_an_attachment_wrapper_is_unchanged() {
        let text = "# Files mentioned by the user:\n\n- attachment.png\n\n## My request for Codex:\n\n这是助手引用的 Markdown\n<image name=\"attachment.png\">literal HTML</image>";
        let jsonl = serde_json::to_string(&json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "id": "assistant-markdown",
                "content": [{"type": "output_text", "text": text}],
            }
        }))
        .unwrap();

        let preview = preview_codex_jsonl_content(&jsonl, None).unwrap();
        assert_eq!(preview.messages[0].text, text);
    }

    #[test]
    fn visible_conversation_export_is_header_gated_and_privacy_filtered() {
        let jsonl = r#"{"record_type":"conversation","thread_id":"thread-1","title":"导出的真实对话","scope":"user-visible user and assistant messages; tool calls and hidden reasoning excluded"}
{"turn_id":"turn-1","message_id":"message-u1","role":"user","text":"真实问题\n<environment_context>secret</environment_context>","attachments":["/private/source/private.pdf"]}
{"record_type":"reasoning","turn_id":"turn-1","message_id":"reasoning-1","role":"assistant","text":"hidden reasoning"}
{"turn_id":"turn-2","message_id":"message-a1","role":"assistant","phase":"commentary","text":"先检查"}
{"turn_id":"turn-2","message_id":"message-a2","role":"assistant","phase":"final_answer","text":"最终结论"}
{"type":"response_item","payload":{"type":"message","role":"assistant","id":"raw-a3","content":[{"type":"output_text","text":"hybrid rollout message"}]}}
{"turn_id":"turn-3","message_id":"message-d1","role":"developer","text":"developer instruction"}"#;

        let preview =
            preview_codex_jsonl_content(jsonl, Some("/tmp/conversation_export.jsonl".into()))
                .unwrap();

        assert_eq!(preview.title, "导出的真实对话");
        assert_eq!(preview.messages.len(), 3);
        assert_eq!(preview.turns.len(), 2);
        assert_eq!(preview.messages[0].text, "真实问题");
        assert_eq!(preview.messages[1].phase.as_deref(), Some("commentary"));
        assert_eq!(preview.messages[2].phase.as_deref(), Some("final"));
        assert_eq!(
            preview.messages[2].external_message_id.as_deref(),
            Some("message-a2")
        );
        assert!(
            preview
                .warnings
                .iter()
                .any(|warning| warning.contains("可见对话导出"))
        );
        let visible = preview
            .messages
            .iter()
            .map(|message| message.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!visible.contains("secret"));
        assert!(!visible.contains("hidden reasoning"));
        assert!(!visible.contains("developer instruction"));
        assert!(!visible.contains("hybrid rollout message"));
        assert!(!visible.contains("/private/source/private.pdf"));
    }

    #[test]
    fn shared_flat_export_fixture_is_portable_and_privacy_filtered() {
        let jsonl = include_str!("../../fixtures/conversation-export-flat-minimal.jsonl");
        let preview = preview_codex_jsonl_content(
            jsonl,
            Some("C:\\work\\测试🧭\\conversation-export-flat-minimal.jsonl".into()),
        )
        .unwrap();

        assert_eq!(preview.title, "可见对话导出示例");
        assert_eq!(preview.messages.len(), 5);
        assert_eq!(preview.turns.len(), 4);
        assert_eq!(
            preview.messages[0].text,
            "请检查 demo@example.com 的安排 🤔"
        );
        assert!(preview.messages[0].redacted_text.contains("[邮箱]"));
        assert!(!preview.messages[0].text.contains("示例附件.pdf"));
        assert_eq!(preview.messages[1].phase.as_deref(), Some("commentary"));
        assert_eq!(preview.messages[2].phase.as_deref(), Some("final"));
        assert_eq!(preview.turns[1].message_ids.len(), 2);
    }

    #[test]
    fn headerless_flat_role_text_jsonl_is_not_treated_as_a_conversation_export() {
        let jsonl = r#"{"turn_id":"turn-1","message_id":"message-u1","role":"user","text":"普通数据集中的文本"}"#;
        let error = preview_codex_jsonl_content(jsonl, None).unwrap_err();
        assert!(error.to_string().contains("带可见对话头"));
    }

    #[test]
    fn visible_export_header_does_not_admit_tool_or_reasoning_rows() {
        let jsonl = r#"{"record_type":"conversation","thread_id":"thread-1","scope":"user-visible user and assistant messages; tool calls and hidden reasoning excluded"}
{"record_type":"reasoning","turn_id":"turn-1","message_id":"reasoning-1","role":"assistant","text":"hidden reasoning"}
{"record_type":"tool_call","turn_id":"turn-1","message_id":"tool-1","role":"assistant","text":"tool output"}"#;
        let error = preview_codex_jsonl_content(jsonl, None).unwrap_err();
        assert!(error.to_string().contains("没有找到支持的可见对话消息"));
    }

    #[test]
    fn late_or_near_match_headers_do_not_unlock_flat_rows() {
        let late_header = format!(
            "{{\"turn_id\":\"turn-1\",\"message_id\":\"message-u1\",\"role\":\"user\",\"text\":\"普通数据\"}}\n{{\"record_type\":\"conversation\",\"thread_id\":\"thread-1\",\"scope\":{scope:?}}}",
            scope = VISIBLE_CONVERSATION_EXPORT_SCOPE
        );
        assert!(preview_codex_jsonl_content(&late_header, None).is_err());

        let near_match = r#"{"record_type":"conversation","thread_id":"thread-1","scope":"user-visible messages"}
{"turn_id":"turn-1","message_id":"message-u1","role":"user","text":"普通数据"}"#;
        assert!(preview_codex_jsonl_content(near_match, None).is_err());
    }

    #[test]
    fn a_user_interrupt_splits_assistant_groups() {
        let paste = "User: 问题\nGPT: 分析中\n用户: 网络波动，请继续\nGPT: 最终答案";
        let preview = preview_paste_content(paste).unwrap();
        assert_eq!(preview.turns.len(), 4);
        assert!(preview.turns[2].operation_only);
    }

    #[test]
    fn too_many_turns_are_rejected_without_truncation() {
        let paste = (0..101)
            .map(|i| format!("用户: {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let error = preview_paste_content(&paste).unwrap_err();
        assert!(error.to_string().contains("上限"));
    }

    #[test]
    fn shared_rollout_fixture_is_filtered_as_a_black_box() {
        let jsonl = include_str!("../../fixtures/codex-rollout-minimal.jsonl");
        let preview = preview_codex_jsonl_content(jsonl, Some("fixture.jsonl".into())).unwrap();
        assert_eq!(preview.messages.len(), 6);
        assert_eq!(preview.turns.len(), 4);
        assert_eq!(preview.turns[1].message_ids.len(), 2);
        assert_eq!(preview.turns[3].message_ids.len(), 2);
        assert!(preview.turns[2].operation_only);
        let visible = preview
            .messages
            .iter()
            .map(|message| message.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(visible.contains("请先判断这个研究方向"));
        assert!(!visible.contains("sk-fixture-secret"));
        assert!(!visible.contains("hidden reasoning"));
        assert!(!visible.contains("Tool evidence"));
        assert!(!visible.contains("Example Plugin"));

        let message_indexes: std::collections::HashMap<_, _> = preview
            .messages
            .iter()
            .enumerate()
            .map(|(index, message)| (message.id.as_str(), index))
            .collect();
        let actual = json!({
            "message_count": preview.messages.len(),
            "turn_count": preview.turns.len(),
            "messages": preview.messages.iter().map(|message| json!({
                "speaker": match message.speaker {
                    Speaker::User => "user",
                    Speaker::Assistant => "assistant",
                },
                "phase": message.phase,
                "external_message_id": message.external_message_id,
                "text": message.text,
            })).collect::<Vec<_>>(),
            "turns": preview.turns.iter().map(|turn| json!({
                "speaker": match turn.speaker {
                    Speaker::User => "user",
                    Speaker::Assistant => "assistant",
                },
                "message_indexes": turn.message_ids.iter().map(|id| message_indexes[id.as_str()]).collect::<Vec<_>>(),
                "operation_only": turn.operation_only,
            })).collect::<Vec<_>>(),
            "excluded_text": [
                "Example Plugin",
                "/Users/example/project",
                "sk-fixture-secret",
                "Ignore this injected skill catalogue.",
                "This developer message must never become transcript text.",
                "This hidden reasoning must be excluded.",
                "Tool evidence that must not become transcript text."
            ],
        });
        let expected: Value = serde_json::from_str(include_str!(
            "../../fixtures/codex-rollout-minimal.expected.json"
        ))
        .unwrap();
        assert_eq!(actual, expected);
    }
}
