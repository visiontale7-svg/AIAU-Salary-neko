use regex::Regex;
use sha2::{Digest, Sha256};

use crate::{
    domain::{PrivacyFinding, RedactionRange, SourceMessage, SourceSpan},
    error::{AtlasError, AtlasResult},
};

pub fn sha256_hex(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(value.as_ref()))
}

pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub fn utf16_to_byte_index(text: &str, offset: usize) -> Option<usize> {
    if offset == 0 {
        return Some(0);
    }
    let mut current = 0;
    for (byte_index, ch) in text.char_indices() {
        if current == offset {
            return Some(byte_index);
        }
        current += ch.len_utf16();
        if current > offset {
            return None;
        }
    }
    (current == offset).then_some(text.len())
}

pub fn slice_utf16(text: &str, start: usize, end: usize) -> Option<&str> {
    if start > end {
        return None;
    }
    let start_byte = utf16_to_byte_index(text, start)?;
    let end_byte = utf16_to_byte_index(text, end)?;
    text.get(start_byte..end_byte)
}

pub fn validate_span(message: &SourceMessage, span: &SourceSpan) -> AtlasResult<()> {
    if span.message_id != message.id {
        return Err(AtlasError::InvalidInput(format!(
            "span references {}, expected {}",
            span.message_id, message.id
        )));
    }
    let actual = slice_utf16(&message.text, span.start_utf16, span.end_utf16)
        .ok_or_else(|| AtlasError::InvalidInput("span is not on UTF-16 boundaries".into()))?;
    if actual != span.exact_quote {
        return Err(AtlasError::InvalidInput(format!(
            "span quote mismatch for {}",
            message.id
        )));
    }
    if sha256_hex(actual) != span.sha256 {
        return Err(AtlasError::InvalidInput(format!(
            "span hash mismatch for {}",
            message.id
        )));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct RawFinding {
    kind: &'static str,
    start: usize,
    end: usize,
    replacement: &'static str,
}

/// Creates a conservative privacy preview. Findings are local hints, never an
/// assertion that the matched value is actually sensitive.
pub fn redact_text(
    message_id: &str,
    text: &str,
) -> (String, Vec<RedactionRange>, Vec<PrivacyFinding>) {
    let patterns = [
        (
            "api_key",
            r"(?i)\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b",
            "[密钥]",
        ),
        (
            "sensitive_field",
            r"(?i)\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+",
            "[敏感字段]",
        ),
        (
            "email",
            r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
            "[邮箱]",
        ),
        (
            "local_path",
            r#"/(?:Users|home)/[^\s\]\[(){}<>"']+"#,
            "[本地路径]",
        ),
    ];

    let mut findings = Vec::new();
    for (kind, pattern, replacement) in patterns {
        let regex = Regex::new(pattern).expect("static privacy regex");
        findings.extend(regex.find_iter(text).map(|m| RawFinding {
            kind,
            start: m.start(),
            end: m.end(),
            replacement,
        }));
    }
    findings.sort_by_key(|f| (f.start, std::cmp::Reverse(f.end)));

    let mut deduped = Vec::new();
    let mut covered_until = 0;
    for finding in findings {
        if finding.start < covered_until {
            continue;
        }
        covered_until = finding.end;
        deduped.push(finding);
    }

    let mut redacted = String::with_capacity(text.len());
    let mut ranges = Vec::new();
    let mut public = Vec::new();
    let mut cursor = 0;
    for finding in deduped {
        redacted.push_str(&text[cursor..finding.start]);
        let original_start_utf16 = utf16_len(&text[..finding.start]);
        let original_end_utf16 = utf16_len(&text[..finding.end]);
        let redacted_start_utf16 = utf16_len(&redacted);
        redacted.push_str(finding.replacement);
        let redacted_end_utf16 = utf16_len(&redacted);
        let range = RedactionRange {
            kind: finding.kind.to_string(),
            original_start_utf16,
            original_end_utf16,
            redacted_start_utf16,
            redacted_end_utf16,
            replacement: finding.replacement.to_string(),
        };
        public.push(PrivacyFinding {
            message_id: message_id.to_string(),
            kind: finding.kind.to_string(),
            start_utf16: original_start_utf16,
            end_utf16: original_end_utf16,
            preview: mask_preview(&text[finding.start..finding.end]),
            replacement: finding.replacement.to_string(),
        });
        ranges.push(range);
        cursor = finding.end;
    }
    redacted.push_str(&text[cursor..]);
    (redacted, ranges, public)
}

fn mask_preview(value: &str) -> String {
    let chars: Vec<_> = value.chars().collect();
    match chars.len() {
        0..=4 => "••••".into(),
        n => format!("{}•••{}", chars[0], chars[n - 1]),
    }
}

pub fn model_span_to_source(
    message: &SourceMessage,
    start_utf16: usize,
    end_utf16: usize,
    exact_quote: &str,
    used_redacted: bool,
) -> AtlasResult<SourceSpan> {
    let model_text = if used_redacted {
        &message.redacted_text
    } else {
        &message.text
    };
    let actual = slice_utf16(model_text, start_utf16, end_utf16)
        .ok_or_else(|| AtlasError::InvalidInput("model span is not on UTF-16 boundaries".into()))?;
    if actual != exact_quote {
        return Err(AtlasError::InvalidInput(
            "model quote does not match its span".into(),
        ));
    }

    let (source_start, source_end) = if used_redacted {
        map_redacted_range_to_original(message, start_utf16, end_utf16)
    } else {
        (start_utf16, end_utf16)
    };
    let source_quote = slice_utf16(&message.text, source_start, source_end)
        .ok_or_else(|| AtlasError::InvalidInput("mapped source span is invalid".into()))?;
    Ok(SourceSpan {
        message_id: message.id.clone(),
        start_utf16: source_start,
        end_utf16: source_end,
        exact_quote: source_quote.to_string(),
        sha256: sha256_hex(source_quote),
        model_saw_redacted: used_redacted && message.text != message.redacted_text,
    })
}

pub fn source_span_to_model_quote(
    message: &SourceMessage,
    span: &SourceSpan,
    used_redacted: bool,
) -> AtlasResult<String> {
    validate_span(message, span)?;
    if !used_redacted {
        return Ok(span.exact_quote.clone());
    }
    let start = map_original_offset(message, span.start_utf16, false);
    let end = map_original_offset(message, span.end_utf16, true);
    slice_utf16(&message.redacted_text, start, end)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AtlasError::InvalidInput("source span cannot map to redacted text".into()))
}

fn map_redacted_range_to_original(
    message: &SourceMessage,
    start: usize,
    end: usize,
) -> (usize, usize) {
    (
        map_redacted_offset(message, start, false),
        map_redacted_offset(message, end, true),
    )
}

fn map_redacted_offset(message: &SourceMessage, offset: usize, is_end: bool) -> usize {
    let mut delta: isize = 0;
    for range in &message.redaction_map {
        if offset < range.redacted_start_utf16 {
            break;
        }
        if offset == range.redacted_start_utf16 {
            return range.original_start_utf16;
        }
        if offset < range.redacted_end_utf16 {
            return if is_end {
                range.original_end_utf16
            } else {
                range.original_start_utf16
            };
        }
        if offset == range.redacted_end_utf16 {
            return range.original_end_utf16;
        }
        let original_len = range.original_end_utf16 - range.original_start_utf16;
        let redacted_len = range.redacted_end_utf16 - range.redacted_start_utf16;
        delta += original_len as isize - redacted_len as isize;
    }
    (offset as isize + delta).max(0) as usize
}

fn map_original_offset(message: &SourceMessage, offset: usize, is_end: bool) -> usize {
    let mut delta: isize = 0;
    for range in &message.redaction_map {
        if offset < range.original_start_utf16 {
            break;
        }
        if offset == range.original_start_utf16 {
            return range.redacted_start_utf16;
        }
        if offset < range.original_end_utf16 {
            return if is_end {
                range.redacted_end_utf16
            } else {
                range.redacted_start_utf16
            };
        }
        if offset == range.original_end_utf16 {
            return range.redacted_end_utf16;
        }
        let original_len = range.original_end_utf16 - range.original_start_utf16;
        let redacted_len = range.redacted_end_utf16 - range.redacted_start_utf16;
        delta += redacted_len as isize - original_len as isize;
    }
    (offset as isize + delta).max(0) as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Speaker;

    #[test]
    fn utf16_offsets_reject_half_surrogate() {
        assert_eq!(slice_utf16("甲🧭乙", 1, 3), Some("🧭"));
        assert_eq!(slice_utf16("甲🧭乙", 1, 2), None);
    }

    #[test]
    fn redaction_mapping_returns_original_evidence() {
        let (redacted, map, _) = redact_text("m1", "联系 a@example.com 再继续");
        let message = SourceMessage {
            id: "m1".into(),
            speaker: Speaker::User,
            phase: None,
            sequence: 0,
            external_message_id: None,
            source_event_index: None,
            text: "联系 a@example.com 再继续".into(),
            text_sha256: sha256_hex("联系 a@example.com 再继续"),
            redacted_text: redacted.clone(),
            redaction_map: map,
            turn_ordinal: 1,
            operation_only: false,
            redactions: Vec::new(),
        };
        let start = utf16_len("联系 ");
        let end = start + utf16_len("[邮箱]");
        let span = model_span_to_source(&message, start, end, "[邮箱]", true).unwrap();
        assert_eq!(span.exact_quote, "a@example.com");
        validate_span(&message, &span).unwrap();
        assert_eq!(
            source_span_to_model_quote(&message, &span, true).unwrap(),
            "[邮箱]"
        );
    }
}
