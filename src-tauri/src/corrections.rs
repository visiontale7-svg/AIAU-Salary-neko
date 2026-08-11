use serde_json::Value;

use crate::{
    domain::{
        AnalysisSnapshot, CorrectionCommand, CorrectionEvent, Mode, ModeMembership, Relation,
        SemanticUnit,
    },
    error::{AtlasError, AtlasResult},
};

pub fn replay(
    base: &AnalysisSnapshot,
    corrections: &[CorrectionEvent],
) -> AtlasResult<AnalysisSnapshot> {
    let mut snapshot = base.clone();
    for event in corrections {
        apply_value(&mut snapshot, &event.kind, &event.target_id, &event.after)?;
    }
    Ok(snapshot)
}

pub fn prepare_correction(
    snapshot: &AnalysisSnapshot,
    command: &CorrectionCommand,
) -> AtlasResult<Option<Value>> {
    validate_kind(&command.kind)?;
    let before = current_value(snapshot, &command.kind, &command.target_id);
    if matches!(
        command.kind.as_str(),
        "delete_relation" | "delete_membership"
    ) && before.is_none()
    {
        return Err(AtlasError::NotFound(command.target_id.clone()));
    }
    let mut candidate = snapshot.clone();
    apply_value(
        &mut candidate,
        &command.kind,
        &command.target_id,
        &command.after,
    )?;
    validate_graph(&candidate)?;

    if command.kind == "update_unit" {
        let prior: SemanticUnit = serde_json::from_value(
            before
                .clone()
                .ok_or_else(|| AtlasError::NotFound(format!("unit {}", command.target_id)))?,
        )?;
        let after: SemanticUnit = serde_json::from_value(command.after.clone())?;
        if prior.id != after.id
            || prior.id != command.target_id
            || prior.turn_id != after.turn_id
            || prior.speaker != after.speaker
            || prior.source_spans != after.source_spans
            || prior.operation_only != after.operation_only
        {
            return Err(AtlasError::InvalidInput(
                "人工纠正不能改写单元 ID、轮次、说话者或原文证据".into(),
            ));
        }
    }
    Ok(before)
}

pub fn current_value(snapshot: &AnalysisSnapshot, kind: &str, target_id: &str) -> Option<Value> {
    match kind {
        "update_unit" => snapshot
            .semantic_units
            .iter()
            .find(|item| item.id == target_id)
            .and_then(|item| serde_json::to_value(item).ok()),
        "upsert_relation" | "delete_relation" => snapshot
            .relations
            .iter()
            .find(|item| item.id == target_id)
            .and_then(|item| serde_json::to_value(item).ok()),
        "update_mode" => snapshot
            .modes
            .iter()
            .find(|item| item.id == target_id)
            .and_then(|item| serde_json::to_value(item).ok()),
        "set_membership" | "delete_membership" => snapshot
            .memberships
            .iter()
            .find(|item| item.id == target_id)
            .and_then(|item| serde_json::to_value(item).ok()),
        _ => None,
    }
}

pub fn reset_command(
    base: &AnalysisSnapshot,
    effective: &AnalysisSnapshot,
    target_kind: &str,
    target_id: &str,
) -> AtlasResult<CorrectionCommand> {
    let (update_kind, delete_kind) = match target_kind {
        "unit" => ("update_unit", None),
        "relation" => ("upsert_relation", Some("delete_relation")),
        "mode" => ("update_mode", None),
        "membership" => ("set_membership", Some("delete_membership")),
        _ => {
            return Err(AtlasError::InvalidInput(format!(
                "unknown reset target kind: {target_kind}"
            )));
        }
    };
    let base_value = current_value(base, update_kind, target_id);
    let effective_value = current_value(effective, update_kind, target_id);
    if base_value == effective_value {
        return Err(AtlasError::InvalidInput("该项目已经与模型快照一致".into()));
    }
    match (base_value, delete_kind) {
        (Some(after), _) => Ok(CorrectionCommand {
            kind: update_kind.into(),
            target_id: target_id.into(),
            after,
        }),
        (None, Some(delete_kind)) => Ok(CorrectionCommand {
            kind: delete_kind.into(),
            target_id: target_id.into(),
            after: Value::Null,
        }),
        (None, None) => Err(AtlasError::NotFound(format!(
            "base {target_kind} {target_id}"
        ))),
    }
}

fn validate_kind(kind: &str) -> AtlasResult<()> {
    if matches!(
        kind,
        "update_unit"
            | "upsert_relation"
            | "delete_relation"
            | "update_mode"
            | "set_membership"
            | "delete_membership"
    ) {
        Ok(())
    } else {
        Err(AtlasError::InvalidInput(format!(
            "unknown correction kind: {kind}"
        )))
    }
}

fn apply_value(
    snapshot: &mut AnalysisSnapshot,
    kind: &str,
    target_id: &str,
    after: &Value,
) -> AtlasResult<()> {
    validate_kind(kind)?;
    match kind {
        "update_unit" => {
            let item: SemanticUnit = serde_json::from_value(after.clone())?;
            replace_existing(&mut snapshot.semantic_units, target_id, item, |item| {
                &item.id
            })?;
        }
        "upsert_relation" => {
            let item: Relation = serde_json::from_value(after.clone())?;
            if item.id != target_id {
                return Err(AtlasError::InvalidInput(
                    "relation targetId mismatch".into(),
                ));
            }
            upsert(&mut snapshot.relations, target_id, item, |item| &item.id);
        }
        "delete_relation" => snapshot.relations.retain(|item| item.id != target_id),
        "update_mode" => {
            let item: Mode = serde_json::from_value(after.clone())?;
            replace_existing(&mut snapshot.modes, target_id, item, |item| &item.id)?;
        }
        "set_membership" => {
            let item: ModeMembership = serde_json::from_value(after.clone())?;
            if item.id != target_id {
                return Err(AtlasError::InvalidInput(
                    "membership targetId mismatch".into(),
                ));
            }
            upsert(&mut snapshot.memberships, target_id, item, |item| &item.id);
        }
        "delete_membership" => snapshot.memberships.retain(|item| item.id != target_id),
        _ => unreachable!(),
    }
    Ok(())
}

fn replace_existing<T, F>(items: &mut [T], id: &str, replacement: T, get_id: F) -> AtlasResult<()>
where
    F: Fn(&T) -> &String,
{
    let item = items
        .iter_mut()
        .find(|item| get_id(item) == id)
        .ok_or_else(|| AtlasError::NotFound(id.into()))?;
    if get_id(&replacement) != id {
        return Err(AtlasError::InvalidInput("targetId mismatch".into()));
    }
    *item = replacement;
    Ok(())
}

fn upsert<T, F>(items: &mut Vec<T>, id: &str, replacement: T, get_id: F)
where
    F: Fn(&T) -> &String,
{
    if let Some(index) = items.iter().position(|item| get_id(item) == id) {
        items[index] = replacement;
    } else {
        items.push(replacement);
    }
}

fn validate_graph(snapshot: &AnalysisSnapshot) -> AtlasResult<()> {
    let unit_ids: std::collections::HashSet<_> = snapshot
        .semantic_units
        .iter()
        .map(|unit| &unit.id)
        .collect();
    let mode_ids: std::collections::HashSet<_> =
        snapshot.modes.iter().map(|mode| &mode.id).collect();
    for relation in &snapshot.relations {
        if !unit_ids.contains(&relation.source) || !unit_ids.contains(&relation.target) {
            return Err(AtlasError::InvalidInput(format!(
                "relation {} has an unknown endpoint",
                relation.id
            )));
        }
        if relation.evidence.is_empty() {
            return Err(AtlasError::InvalidInput(format!(
                "relation {} must retain evidence",
                relation.id
            )));
        }
    }
    for membership in &snapshot.memberships {
        if !unit_ids.contains(&membership.unit_id) || !mode_ids.contains(&membership.mode_id) {
            return Err(AtlasError::InvalidInput(format!(
                "membership {} has an unknown endpoint",
                membership.id
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::domain::{
        AnalysisState, PROMPT_VERSION, Provenance, SCHEMA_VERSION, SourceSpan, Speaker,
    };

    fn snapshot() -> AnalysisSnapshot {
        let span = SourceSpan {
            message_id: "m1".into(),
            start_utf16: 0,
            end_utf16: 1,
            exact_quote: "问".into(),
            sha256: "hash".into(),
            model_saw_redacted: false,
        };
        let unit = |id: &str, speaker| SemanticUnit {
            id: id.into(),
            turn_id: format!("turn-{id}"),
            speaker,
            label: id.into(),
            acts: vec!["陈述".into()],
            importance: 0.7,
            provenance: Provenance::Model,
            source_spans: vec![span.clone()],
            primary: true,
            operation_only: false,
        };
        AnalysisSnapshot {
            id: "snapshot".into(),
            run_id: "run".into(),
            conversation_id: "conversation".into(),
            provider: Default::default(),
            provider_version: None,
            credential_mode: None,
            model_id: "gpt-5-mini".into(),
            prompt_version: PROMPT_VERSION.into(),
            schema_version: SCHEMA_VERSION.into(),
            status: AnalysisState::Ready,
            semantic_units: vec![unit("u1", Speaker::User), unit("u2", Speaker::Assistant)],
            relations: vec![Relation {
                id: "r1".into(),
                source: "u2".into(),
                target: "u1".into(),
                kind: "回应".into(),
                label: "回应".into(),
                confidence: 0.9,
                evidence: vec![span],
                user_created: false,
            }],
            modes: Vec::new(),
            memberships: Vec::new(),
            validation_issues: Vec::new(),
            raw_model_output: serde_json::json!({}),
            input_tokens: None,
            output_tokens: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn corrections_cannot_rewrite_source_evidence() {
        let snapshot = snapshot();
        let mut changed = snapshot.semantic_units[0].clone();
        changed.source_spans[0].exact_quote = "伪造".into();
        let command = CorrectionCommand {
            kind: "update_unit".into(),
            target_id: "u1".into(),
            after: serde_json::to_value(changed).unwrap(),
        };
        assert!(prepare_correction(&snapshot, &command).is_err());
    }

    #[test]
    fn resetting_model_relation_preserves_model_provenance() {
        let base = snapshot();
        let mut edited = base.clone();
        edited.relations[0].label = "人工改名".into();
        let command = reset_command(&base, &edited, "relation", "r1").unwrap();
        let event = CorrectionEvent {
            id: "c".into(),
            snapshot_id: base.id.clone(),
            kind: command.kind,
            target_id: command.target_id,
            before: None,
            after: command.after,
            created_at: Utc::now(),
        };
        let reset = replay(&edited, &[event]).unwrap();
        assert_eq!(reset.relations[0].label, "回应");
        assert!(!reset.relations[0].user_created);
    }
}
