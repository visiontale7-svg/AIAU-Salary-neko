use serde_json::{Value, json};

use crate::domain::{DIALOGUE_ACTS, RELATION_KINDS};

fn span_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["messageId", "startUtf16", "endUtf16", "exactQuote"],
        "properties": {
            "messageId": {"type": "string"},
            "startUtf16": {"type": "integer", "minimum": 0},
            "endUtf16": {"type": "integer", "minimum": 0},
            "exactQuote": {"type": "string", "minLength": 1}
        }
    })
}

pub fn segmentation_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["units"],
        "properties": {
            "units": {
                "type": "array",
                "maxItems": 300,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["turnId", "speaker", "label", "acts", "importance", "primary", "operationOnly", "spans"],
                    "properties": {
                        "turnId": {"type": "string"},
                        "speaker": {"type": "string", "enum": ["user", "assistant"]},
                        "label": {"type": "string", "minLength": 1, "maxLength": 80},
                        "acts": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"type": "string", "enum": DIALOGUE_ACTS}
                        },
                        "importance": {"type": "number", "minimum": 0, "maximum": 1},
                        "primary": {"type": "boolean"},
                        "operationOnly": {"type": "boolean"},
                        "spans": {"type": "array", "minItems": 1, "items": span_schema()}
                    }
                }
            }
        }
    })
}

pub fn relations_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["relations"],
        "properties": {
            "relations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["source", "target", "kind", "label", "confidence", "evidenceUnitIds"],
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "kind": {"type": "string", "enum": RELATION_KINDS},
                        "label": {"type": "string", "minLength": 1, "maxLength": 40},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "evidenceUnitIds": {
                            "type": "array",
                            "minItems": 1,
                            "items": {"type": "string"}
                        }
                    }
                }
            }
        }
    })
}

pub fn modes_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["modes", "memberships"],
        "properties": {
            "modes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["localId", "kind", "label", "confidence"],
                    "properties": {
                        "localId": {"type": "string"},
                        "kind": {"type": "string", "enum": [
                            "目标定位", "探索", "方案形成", "证据核验", "质疑校正", "决定",
                            "执行", "协调", "元对话", "未分类"
                        ]},
                        "label": {"type": "string", "minLength": 1, "maxLength": 50},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                    }
                }
            },
            "memberships": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["modeLocalId", "unitId", "confidence"],
                    "properties": {
                        "modeLocalId": {"type": "string"},
                        "unitId": {"type": "string"},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                    }
                }
            }
        }
    })
}
