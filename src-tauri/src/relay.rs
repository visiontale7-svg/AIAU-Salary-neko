use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    corrections::replay,
    domain::{AnalysisSnapshot, LayoutState, SemanticUnit, SourceSpan, Speaker},
    error::{AtlasError, AtlasResult},
    repository::{RelayDraftRecord, RelayIdMapRecord, Repository},
};

pub const RELAY_SCHEMA_VERSION: &str = "relay-v1";
const MAX_PUBLIC_NODES: usize = 120;
const DRAFT_TTL_MINUTES: i64 = 30;
const MAX_TITLE_CHARS: usize = 160;
const MAX_LABEL_CHARS: usize = 240;
const MAX_SHORT_STRING_CHARS: usize = 96;
const MAX_EVIDENCE_CHARS: usize = 480;
const MAX_ABS_LAYOUT_COORDINATE: f64 = 1_000_000.0;

static UUID_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
        .expect("valid UUID privacy pattern")
});
static EMAIL_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b")
        .expect("valid email privacy pattern")
});
static UNIX_PATH_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?:^|[\s"'`(])/(?:[\p{L}\p{N}._~+\-]+/)*[\p{L}\p{N}._~+\-]+"#)
        .expect("valid Unix path privacy pattern")
});
static WINDOWS_PATH_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)\b[A-Z]:\\(?:[^\\\s<>:"|?*]+\\?)+"#)
        .expect("valid Windows path privacy pattern")
});
static WINDOWS_UNC_PATH_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"\\\\[^\\\s<>:"|?*]+\\[^\\\s<>:"|?*]+"#)
        .expect("valid Windows UNC path privacy pattern")
});
static SECRET_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|\bauthorization\s*[:=]\s*[^\r\n,;]{8,}|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*[^\s,;]{8,})",
    )
    .expect("valid secret privacy pattern")
});

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicNodeOrigin {
    Source,
    Team,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicEdgeOrigin {
    Source,
    Team,
    AcceptedProposal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicNodeKind {
    Anchor,
    Claim,
    Evidence,
    Decision,
    Action,
    Note,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicGraphNode {
    pub id: String,
    pub origin: PublicNodeOrigin,
    pub label: String,
    pub kind: PublicNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<Speaker>,
    pub acts: Vec<String>,
    pub mode_ids: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub importance: f32,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicGraphEdge {
    pub id: String,
    pub origin: PublicEdgeOrigin,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    pub label: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicGraphMode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub color: String,
    pub member_node_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PublicEvidence {
    pub excerpt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<Speaker>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelayGraphV1 {
    pub nodes: Vec<PublicGraphNode>,
    pub edges: Vec<PublicGraphEdge>,
    pub modes: Vec<PublicGraphMode>,
    pub layout: BTreeMap<String, PublicPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<PublicViewport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelayPackageV1 {
    pub schema_version: String,
    pub package_id: String,
    pub client_publish_id: String,
    pub title: String,
    pub published_at: DateTime<Utc>,
    pub graph: RelayGraphV1,
    pub evidence: BTreeMap<String, PublicEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareDraftEvidence {
    pub draft_evidence_id: String,
    pub excerpt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<Speaker>,
    pub owner_kind: String,
    pub owner_label: String,
    pub selected_by_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareDraftNode {
    pub draft_item_id: String,
    pub label: String,
    pub kind: PublicNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<Speaker>,
    pub primary: bool,
    pub selected_by_default: bool,
    pub evidence: Vec<ShareDraftEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareDraft {
    pub draft_id: String,
    pub snapshot_id: String,
    pub title: String,
    pub expires_at: DateTime<Utc>,
    pub nodes: Vec<ShareDraftNode>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShareApprovals {
    #[serde(default)]
    pub node_draft_ids: Vec<String>,
    #[serde(default)]
    pub evidence_draft_ids: Vec<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShareReceipt {
    pub publication_id: String,
    pub snapshot_id: String,
    pub package_id: String,
    pub client_publish_id: String,
    pub room_id: String,
    pub atlas_version_id: String,
    pub package_sha256: String,
    pub relay_url: String,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug)]
struct EffectiveSource {
    snapshot: AnalysisSnapshot,
    layout: Option<LayoutState>,
    title: String,
    message_speakers: HashMap<String, Speaker>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum EvidenceOwnerKind {
    Node,
    Edge,
}

#[derive(Debug, Clone)]
struct EvidenceOwner {
    kind: EvidenceOwnerKind,
    source_id: String,
}

#[derive(Debug, Default)]
struct PublicIdMaps {
    nodes: HashMap<String, String>,
    edges: HashMap<String, String>,
    modes: HashMap<String, String>,
    evidence_by_owner: HashMap<(EvidenceOwnerKind, String, usize), String>,
    evidence_by_public_id: HashMap<String, EvidenceOwner>,
}

#[derive(Debug, Clone, Copy)]
struct JavascriptF32(f32);

impl Serialize for JavascriptF32 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.0 == 0.0 {
            serializer.serialize_i64(0)
        } else if self.0.fract() == 0.0 {
            serializer.serialize_i64(self.0 as i64)
        } else {
            serializer.serialize_f32(self.0)
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct JavascriptF64(f64);

impl Serialize for JavascriptF64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.0 == 0.0 {
            serializer.serialize_i64(0)
        } else if self.0.fract() == 0.0 && self.0.abs() <= 9_007_199_254_740_991.0 {
            serializer.serialize_i64(self.0 as i64)
        } else {
            serializer.serialize_f64(self.0)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDigestPoint {
    x: JavascriptF64,
    y: JavascriptF64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDigestViewport {
    x: JavascriptF64,
    y: JavascriptF64,
    zoom: JavascriptF64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDigestNode<'a> {
    id: &'a str,
    origin: PublicNodeOrigin,
    label: &'a str,
    kind: PublicNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    speaker: Option<Speaker>,
    acts: &'a [String],
    mode_ids: &'a [String],
    evidence_ids: &'a [String],
    importance: JavascriptF32,
    primary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDigestGraph<'a> {
    nodes: Vec<BrowserDigestNode<'a>>,
    edges: &'a [PublicGraphEdge],
    modes: &'a [PublicGraphMode],
    layout: BTreeMap<&'a str, BrowserDigestPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    viewport: Option<BrowserDigestViewport>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserDigestPackage<'a> {
    schema_version: &'a str,
    package_id: &'a str,
    client_publish_id: &'a str,
    title: &'a str,
    published_at: &'a DateTime<Utc>,
    graph: BrowserDigestGraph<'a>,
    evidence: &'a BTreeMap<String, PublicEvidence>,
}

pub async fn build_share_preview(
    repository: &Repository,
    snapshot_id: &str,
) -> AtlasResult<ShareDraft> {
    let source = load_effective_source(repository, snapshot_id).await?;
    validate_effective_graph(&source.snapshot)?;

    let draft_id = opaque_id("draft_");
    let package_id = opaque_id("pkg_");
    let client_publish_id = opaque_id("publish_");
    let now = Utc::now();
    let expires_at = now + Duration::minutes(DRAFT_TTL_MINUTES);
    let (maps, records) = create_public_id_maps(&source.snapshot)?;
    let default_nodes = default_selected_nodes(&source.snapshot, &maps);
    let mut draft_nodes = Vec::with_capacity(source.snapshot.semantic_units.len());
    let mut draft_node_indexes = HashMap::new();

    for unit in &source.snapshot.semantic_units {
        let public_id = required_map(&maps.nodes, &unit.id, "node")?.clone();
        let mut evidence = Vec::with_capacity(unit.source_spans.len());
        for (index, span) in unit.source_spans.iter().enumerate() {
            evidence.push(draft_evidence(
                &maps,
                &source,
                EvidenceOwnerKind::Node,
                &unit.id,
                &unit.label,
                index,
                span,
            )?);
        }
        draft_node_indexes.insert(unit.id.clone(), draft_nodes.len());
        draft_nodes.push(ShareDraftNode {
            draft_item_id: public_id.clone(),
            label: unit.label.clone(),
            kind: public_node_kind(unit),
            speaker: Some(unit.speaker),
            primary: unit.primary,
            selected_by_default: default_nodes.contains(&public_id),
            evidence,
        });
    }

    let mut relation_evidence_count = 0usize;
    for relation in &source.snapshot.relations {
        let target_index = *draft_node_indexes
            .get(&relation.target)
            .ok_or_else(|| AtlasError::InvalidInput("关系引用了不存在的目标节点".into()))?;
        let source_label = source
            .snapshot
            .semantic_units
            .iter()
            .find(|unit| unit.id == relation.source)
            .map(|unit| unit.label.as_str())
            .unwrap_or("未知来源");
        let target_label = source
            .snapshot
            .semantic_units
            .iter()
            .find(|unit| unit.id == relation.target)
            .map(|unit| unit.label.as_str())
            .unwrap_or("未知目标");
        let owner_label = format!("{source_label} —{}→ {target_label}", relation.label);
        for (index, span) in relation.evidence.iter().enumerate() {
            draft_nodes[target_index].evidence.push(draft_evidence(
                &maps,
                &source,
                EvidenceOwnerKind::Edge,
                &relation.id,
                &owner_label,
                index,
                span,
            )?);
            relation_evidence_count += 1;
        }
    }

    let mut warnings = Vec::new();
    if source.snapshot.semantic_units.len() > MAX_PUBLIC_NODES {
        warnings.push(format!(
            "快照包含 {} 个节点；每个 Relay 包最多选择 {MAX_PUBLIC_NODES} 个。",
            source.snapshot.semantic_units.len()
        ));
    }
    if relation_evidence_count > 0 {
        warnings.push("关系证据只有在关系两端节点都被选择时才会发布。".into());
    }
    let unsafe_count = count_unsafe_draft_strings(&source.title, &draft_nodes);
    if unsafe_count > 0 {
        warnings.push(format!(
            "发现 {unsafe_count} 个可能包含隐私的信息；请取消选择对应项目或修改公开标题。"
        ));
    }
    warnings.push("证据默认全部不选中，只有逐项批准的摘录才会进入 Relay 包。".into());

    let draft_record = RelayDraftRecord {
        draft_id: draft_id.clone(),
        snapshot_id: source.snapshot.id.clone(),
        package_id,
        client_publish_id,
        snapshot_sha256: snapshot_digest(&source.snapshot)?,
        title_sha256: sha256_hex(source.title.as_bytes()),
        created_at: now,
        expires_at,
        published_at: None,
        finalized_sha256: None,
    };
    repository
        .insert_relay_share_draft(&draft_record, &records)
        .await?;

    Ok(ShareDraft {
        draft_id,
        snapshot_id: source.snapshot.id,
        title: source.title,
        expires_at,
        nodes: draft_nodes,
        warnings,
    })
}

pub async fn finalize_share_package(
    repository: &Repository,
    draft_id: &str,
    approvals: ShareApprovals,
) -> AtlasResult<RelayPackageV1> {
    let draft = repository.load_relay_share_draft(draft_id).await?;
    if draft.expires_at <= Utc::now() {
        return Err(AtlasError::InvalidInput(
            "分享草稿已过期，请重新生成预览".into(),
        ));
    }
    let source = load_effective_source(repository, &draft.snapshot_id).await?;
    validate_effective_graph(&source.snapshot)?;
    if snapshot_digest(&source.snapshot)? != draft.snapshot_sha256
        || sha256_hex(source.title.as_bytes()) != draft.title_sha256
    {
        return Err(AtlasError::InvalidInput(
            "本地快照或标题已更新，请重新生成分享预览".into(),
        ));
    }
    let records = repository.load_relay_id_maps(draft_id).await?;
    let maps = parse_public_id_maps(&records)?;
    validate_map_coverage(&source.snapshot, &maps)?;

    let selected_nodes = unique_approval_ids(&approvals.node_draft_ids, "节点")?;
    if selected_nodes.is_empty() {
        return Err(AtlasError::InvalidInput("至少需要批准一个节点".into()));
    }
    if selected_nodes.len() > MAX_PUBLIC_NODES {
        return Err(AtlasError::InvalidInput(format!(
            "每个 Relay 包最多包含 {MAX_PUBLIC_NODES} 个节点"
        )));
    }
    let known_nodes: HashSet<_> = maps.nodes.values().cloned().collect();
    if selected_nodes.iter().any(|id| !known_nodes.contains(id)) {
        return Err(AtlasError::InvalidInput("批准列表包含未知节点".into()));
    }
    let selected_evidence = unique_approval_ids(&approvals.evidence_draft_ids, "证据")?;
    if selected_evidence
        .iter()
        .any(|id| !maps.evidence_by_public_id.contains_key(id))
    {
        return Err(AtlasError::InvalidInput("批准列表包含未知证据".into()));
    }

    let title = approvals.title.unwrap_or_else(|| source.title.clone());
    let title = title.trim().to_string();
    validate_public_string("title", &title, MAX_TITLE_CHARS, false)?;

    let mut package = assemble_package(
        &source,
        &draft,
        &maps,
        &selected_nodes,
        &selected_evidence,
        title,
        draft.published_at.unwrap_or_else(Utc::now),
    )?;
    validate_relay_package(&package)?;
    let candidate_sha256 = package_digest(&package)?;
    let (published_at, finalized_sha256) = repository
        .claim_relay_share_finalization(draft_id, package.published_at, &candidate_sha256)
        .await?;
    if package.published_at != published_at {
        package.published_at = published_at;
    }
    if package_digest(&package)? != finalized_sha256 {
        return Err(AtlasError::InvalidInput(
            "该分享草稿已经用不同的批准内容完成最终化，请重新生成预览".into(),
        ));
    }
    Ok(package)
}

pub async fn record_share_receipt(
    repository: &Repository,
    receipt: ShareReceipt,
) -> AtlasResult<ShareReceipt> {
    validate_share_receipt(&receipt)?;
    let draft = repository
        .load_relay_share_draft_by_package_id(&receipt.package_id)
        .await?;
    if draft.snapshot_id != receipt.snapshot_id
        || draft.client_publish_id != receipt.client_publish_id
        || draft.published_at.is_none()
        || draft.finalized_sha256.as_deref() != Some(receipt.package_sha256.as_str())
    {
        return Err(AtlasError::InvalidInput(
            "发布回执与本地分享草稿不匹配".into(),
        ));
    }
    repository.record_relay_share_receipt(&receipt).await
}

pub async fn list_share_publications(
    repository: &Repository,
    snapshot_id: &str,
) -> AtlasResult<Vec<ShareReceipt>> {
    if snapshot_id.trim().is_empty() {
        return Err(AtlasError::InvalidInput("snapshotId 不能为空".into()));
    }
    repository.list_relay_share_publications(snapshot_id).await
}

async fn load_effective_source(
    repository: &Repository,
    snapshot_id: &str,
) -> AtlasResult<EffectiveSource> {
    let base = repository.load_snapshot(None, Some(snapshot_id)).await?;
    let corrections = repository.load_corrections(&base.id).await?;
    let snapshot = replay(&base, &corrections)?;
    let layout = repository.load_layout(&base.id).await?;
    let conversation = repository.load_conversation(&base.conversation_id).await?;
    let message_speakers = conversation
        .messages
        .iter()
        .map(|message| (message.id.clone(), message.speaker))
        .collect();
    Ok(EffectiveSource {
        snapshot,
        layout,
        title: conversation.summary.title,
        message_speakers,
    })
}

fn create_public_id_maps(
    snapshot: &AnalysisSnapshot,
) -> AtlasResult<(PublicIdMaps, Vec<RelayIdMapRecord>)> {
    let mut maps = PublicIdMaps::default();
    let mut records = Vec::new();
    for (index, unit) in snapshot.semantic_units.iter().enumerate() {
        insert_entity_map(
            &mut maps.nodes,
            &mut records,
            "node",
            &unit.id,
            public_id('n', index),
        )?;
    }
    for (index, edge) in snapshot.relations.iter().enumerate() {
        insert_entity_map(
            &mut maps.edges,
            &mut records,
            "edge",
            &edge.id,
            public_id('r', index),
        )?;
    }
    for (index, mode) in snapshot.modes.iter().enumerate() {
        insert_entity_map(
            &mut maps.modes,
            &mut records,
            "mode",
            &mode.id,
            public_id('m', index),
        )?;
    }
    let mut evidence_index = 0usize;
    for unit in &snapshot.semantic_units {
        for (source_index, _) in unit.source_spans.iter().enumerate() {
            evidence_index += 1;
            insert_evidence_map(
                &mut maps,
                &mut records,
                EvidenceOwnerKind::Node,
                &unit.id,
                source_index,
                format!("e{evidence_index:03}"),
            )?;
        }
    }
    for edge in &snapshot.relations {
        for (source_index, _) in edge.evidence.iter().enumerate() {
            evidence_index += 1;
            insert_evidence_map(
                &mut maps,
                &mut records,
                EvidenceOwnerKind::Edge,
                &edge.id,
                source_index,
                format!("e{evidence_index:03}"),
            )?;
        }
    }
    Ok((maps, records))
}

fn parse_public_id_maps(records: &[RelayIdMapRecord]) -> AtlasResult<PublicIdMaps> {
    let mut maps = PublicIdMaps::default();
    for record in records {
        match record.entity_kind.as_str() {
            "node" => insert_loaded_map(&mut maps.nodes, record, 'n')?,
            "edge" => insert_loaded_map(&mut maps.edges, record, 'r')?,
            "mode" => insert_loaded_map(&mut maps.modes, record, 'm')?,
            "node_evidence" | "edge_evidence" => {
                let kind = if record.entity_kind == "node_evidence" {
                    EvidenceOwnerKind::Node
                } else {
                    EvidenceOwnerKind::Edge
                };
                let source_index = usize::try_from(record.source_index)
                    .map_err(|_| AtlasError::InvalidInput("分享草稿中的证据映射无效".into()))?;
                if !valid_public_id(&record.public_id, 'e') {
                    return Err(AtlasError::InvalidInput(
                        "分享草稿中的公开证据 ID 无效".into(),
                    ));
                }
                let key = (kind.clone(), record.source_id.clone(), source_index);
                if maps
                    .evidence_by_owner
                    .insert(key, record.public_id.clone())
                    .is_some()
                    || maps
                        .evidence_by_public_id
                        .insert(
                            record.public_id.clone(),
                            EvidenceOwner {
                                kind,
                                source_id: record.source_id.clone(),
                            },
                        )
                        .is_some()
                {
                    return Err(AtlasError::InvalidInput("分享草稿包含重复证据映射".into()));
                }
            }
            _ => {
                return Err(AtlasError::InvalidInput("分享草稿包含未知映射类型".into()));
            }
        }
    }
    Ok(maps)
}

fn assemble_package(
    source: &EffectiveSource,
    draft: &RelayDraftRecord,
    maps: &PublicIdMaps,
    selected_nodes: &HashSet<String>,
    selected_evidence: &HashSet<String>,
    title: String,
    published_at: DateTime<Utc>,
) -> AtlasResult<RelayPackageV1> {
    let mut selected_local_nodes = HashSet::new();
    for unit in &source.snapshot.semantic_units {
        if selected_nodes.contains(required_map(&maps.nodes, &unit.id, "node")?) {
            selected_local_nodes.insert(unit.id.clone());
        }
    }

    let included_edges: HashSet<_> = source
        .snapshot
        .relations
        .iter()
        .filter(|edge| {
            selected_local_nodes.contains(&edge.source)
                && selected_local_nodes.contains(&edge.target)
        })
        .map(|edge| edge.id.clone())
        .collect();

    for evidence_id in selected_evidence {
        let owner = maps
            .evidence_by_public_id
            .get(evidence_id)
            .ok_or_else(|| AtlasError::InvalidInput("批准列表包含未知证据".into()))?;
        let owner_included = match owner.kind {
            EvidenceOwnerKind::Node => selected_local_nodes.contains(&owner.source_id),
            EvidenceOwnerKind::Edge => included_edges.contains(&owner.source_id),
        };
        if !owner_included {
            return Err(AtlasError::InvalidInput(
                "证据所属节点或关系未被批准".into(),
            ));
        }
    }

    let mut mode_members: HashMap<String, Vec<String>> = HashMap::new();
    for membership in &source.snapshot.memberships {
        if selected_local_nodes.contains(&membership.unit_id) {
            let mode_id = required_map(&maps.modes, &membership.mode_id, "mode")?.clone();
            let node_id = required_map(&maps.nodes, &membership.unit_id, "node")?.clone();
            let members = mode_members.entry(mode_id).or_default();
            if !members.contains(&node_id) {
                members.push(node_id);
            }
        }
    }

    let mut evidence = BTreeMap::new();
    let mut nodes = Vec::new();
    for unit in &source.snapshot.semantic_units {
        let public_id = required_map(&maps.nodes, &unit.id, "node")?.clone();
        if !selected_nodes.contains(&public_id) {
            continue;
        }
        let evidence_ids = approved_evidence_ids_for_spans(
            source,
            maps,
            selected_evidence,
            EvidenceOwnerKind::Node,
            &unit.id,
            &unit.source_spans,
            &mut evidence,
        )?;
        let mut mode_ids = Vec::new();
        for membership in source
            .snapshot
            .memberships
            .iter()
            .filter(|membership| membership.unit_id == unit.id)
        {
            let mode_id = required_map(&maps.modes, &membership.mode_id, "mode")?.clone();
            if mode_members.contains_key(&mode_id) && !mode_ids.contains(&mode_id) {
                mode_ids.push(mode_id);
            }
        }
        nodes.push(PublicGraphNode {
            id: public_id,
            origin: PublicNodeOrigin::Source,
            label: unit.label.clone(),
            kind: public_node_kind(unit),
            speaker: Some(unit.speaker),
            acts: unit.acts.clone(),
            mode_ids,
            evidence_ids,
            importance: normalized_importance(unit.importance)?,
            primary: unit.primary,
        });
    }

    let mut edges = Vec::new();
    for edge in &source.snapshot.relations {
        if !included_edges.contains(&edge.id) {
            continue;
        }
        let evidence_ids = approved_evidence_ids_for_spans(
            source,
            maps,
            selected_evidence,
            EvidenceOwnerKind::Edge,
            &edge.id,
            &edge.evidence,
            &mut evidence,
        )?;
        edges.push(PublicGraphEdge {
            id: required_map(&maps.edges, &edge.id, "edge")?.clone(),
            origin: PublicEdgeOrigin::Source,
            source: required_map(&maps.nodes, &edge.source, "node")?.clone(),
            target: required_map(&maps.nodes, &edge.target, "node")?.clone(),
            edge_type: edge.kind.clone(),
            label: edge.label.clone(),
            evidence_ids,
        });
    }

    let mut modes = Vec::new();
    for mode in &source.snapshot.modes {
        let public_id = required_map(&maps.modes, &mode.id, "mode")?.clone();
        let Some(member_node_ids) = mode_members.remove(&public_id) else {
            continue;
        };
        modes.push(PublicGraphMode {
            id: public_id,
            kind: mode.kind.clone(),
            label: mode.label.clone(),
            color: mode.color.clone(),
            member_node_ids,
        });
    }

    let (layout, viewport) = public_layout(
        source.layout.as_ref(),
        &source.snapshot,
        maps,
        selected_nodes,
    )?;
    Ok(RelayPackageV1 {
        schema_version: RELAY_SCHEMA_VERSION.into(),
        package_id: draft.package_id.clone(),
        client_publish_id: draft.client_publish_id.clone(),
        title,
        published_at,
        graph: RelayGraphV1 {
            nodes,
            edges,
            modes,
            layout,
            viewport,
        },
        evidence,
    })
}

fn public_layout(
    layout: Option<&LayoutState>,
    snapshot: &AnalysisSnapshot,
    maps: &PublicIdMaps,
    selected_nodes: &HashSet<String>,
) -> AtlasResult<(BTreeMap<String, PublicPoint>, Option<PublicViewport>)> {
    let mut local_layout = HashMap::new();
    if let Some(layout) = layout {
        for node in &layout.nodes {
            if local_layout.insert(node.unit_id.as_str(), node).is_some() {
                return Err(AtlasError::InvalidInput("本地布局包含重复节点位置".into()));
            }
        }
    }
    let mut public_layout = BTreeMap::new();
    let mut selected_index = 0usize;
    for unit in &snapshot.semantic_units {
        let public_id = required_map(&maps.nodes, &unit.id, "node")?;
        if !selected_nodes.contains(public_id) {
            continue;
        }
        let point = if let Some(node) = local_layout.get(unit.id.as_str()) {
            PublicPoint {
                x: normalized_coordinate(node.x)?,
                y: normalized_coordinate(node.y)?,
            }
        } else {
            let column = selected_index % 4;
            let row = selected_index / 4;
            PublicPoint {
                x: column as f64 * 320.0,
                y: row as f64 * 220.0,
            }
        };
        selected_index += 1;
        public_layout.insert(public_id.clone(), point);
    }
    let viewport = layout
        .map(|layout| -> AtlasResult<PublicViewport> {
            let zoom = normalized_zoom(layout.viewport.zoom)?;
            Ok(PublicViewport {
                x: normalized_coordinate(layout.viewport.x)?,
                y: normalized_coordinate(layout.viewport.y)?,
                zoom,
            })
        })
        .transpose()?;
    Ok((public_layout, viewport))
}

fn approved_evidence_ids_for_spans(
    source: &EffectiveSource,
    maps: &PublicIdMaps,
    selected_evidence: &HashSet<String>,
    kind: EvidenceOwnerKind,
    source_id: &str,
    spans: &[SourceSpan],
    output: &mut BTreeMap<String, PublicEvidence>,
) -> AtlasResult<Vec<String>> {
    let mut ids = Vec::new();
    for (index, span) in spans.iter().enumerate() {
        let evidence_id = maps
            .evidence_by_owner
            .get(&(kind.clone(), source_id.to_string(), index))
            .ok_or_else(|| AtlasError::InvalidInput("分享草稿缺少证据映射".into()))?;
        if !selected_evidence.contains(evidence_id) {
            continue;
        }
        let excerpt = bounded_excerpt(&span.exact_quote);
        let speaker = source.message_speakers.get(&span.message_id).copied();
        output.insert(evidence_id.clone(), PublicEvidence { excerpt, speaker });
        ids.push(evidence_id.clone());
    }
    Ok(ids)
}

fn draft_evidence(
    maps: &PublicIdMaps,
    source: &EffectiveSource,
    kind: EvidenceOwnerKind,
    source_id: &str,
    owner_label: &str,
    index: usize,
    span: &SourceSpan,
) -> AtlasResult<ShareDraftEvidence> {
    let public_id = maps
        .evidence_by_owner
        .get(&(kind.clone(), source_id.to_string(), index))
        .ok_or_else(|| AtlasError::InvalidInput("分享草稿缺少证据映射".into()))?;
    Ok(ShareDraftEvidence {
        draft_evidence_id: public_id.clone(),
        excerpt: bounded_excerpt(&span.exact_quote),
        speaker: source.message_speakers.get(&span.message_id).copied(),
        owner_kind: match kind {
            EvidenceOwnerKind::Node => "node",
            EvidenceOwnerKind::Edge => "edge",
        }
        .into(),
        owner_label: owner_label.into(),
        selected_by_default: false,
    })
}

fn default_selected_nodes(snapshot: &AnalysisSnapshot, maps: &PublicIdMaps) -> HashSet<String> {
    let mut ranked: Vec<_> = snapshot
        .semantic_units
        .iter()
        .enumerate()
        .filter(|(_, unit)| unit.primary)
        .collect();
    ranked.sort_by(|(left_index, left), (right_index, right)| {
        right
            .importance
            .partial_cmp(&left.importance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left_index.cmp(right_index))
    });
    ranked
        .into_iter()
        .take(MAX_PUBLIC_NODES)
        .filter_map(|(_, unit)| maps.nodes.get(&unit.id).cloned())
        .collect()
}

fn public_node_kind(unit: &SemanticUnit) -> PublicNodeKind {
    if unit.operation_only
        || unit
            .acts
            .iter()
            .any(|act| matches!(act.as_str(), "任务" | "请求" | "承诺"))
    {
        PublicNodeKind::Action
    } else if unit
        .acts
        .iter()
        .any(|act| matches!(act.as_str(), "证据" | "举例" | "反例"))
    {
        PublicNodeKind::Evidence
    } else if unit.speaker == Speaker::User && unit.primary {
        PublicNodeKind::Anchor
    } else if unit.acts.iter().any(|act| {
        matches!(
            act.as_str(),
            "回答" | "解释" | "论证" | "建议" | "评价" | "结论"
        )
    }) {
        PublicNodeKind::Claim
    } else {
        PublicNodeKind::Note
    }
}

fn validate_effective_graph(snapshot: &AnalysisSnapshot) -> AtlasResult<()> {
    if snapshot.semantic_units.is_empty() {
        return Err(AtlasError::InvalidInput("快照没有可分享节点".into()));
    }
    let unit_ids = unique_source_ids(
        snapshot.semantic_units.iter().map(|unit| unit.id.as_str()),
        "节点",
    )?;
    let mode_ids = unique_source_ids(snapshot.modes.iter().map(|mode| mode.id.as_str()), "模式")?;
    unique_source_ids(
        snapshot.relations.iter().map(|edge| edge.id.as_str()),
        "关系",
    )?;
    for unit in &snapshot.semantic_units {
        normalized_importance(unit.importance)?;
    }
    for edge in &snapshot.relations {
        if !unit_ids.contains(edge.source.as_str()) || !unit_ids.contains(edge.target.as_str()) {
            return Err(AtlasError::InvalidInput("关系引用了不存在的节点".into()));
        }
    }
    for membership in &snapshot.memberships {
        if !unit_ids.contains(membership.unit_id.as_str())
            || !mode_ids.contains(membership.mode_id.as_str())
        {
            return Err(AtlasError::InvalidInput("模式归属引用没有闭合".into()));
        }
    }
    Ok(())
}

fn validate_map_coverage(snapshot: &AnalysisSnapshot, maps: &PublicIdMaps) -> AtlasResult<()> {
    if maps.nodes.len() != snapshot.semantic_units.len()
        || maps.edges.len() != snapshot.relations.len()
        || maps.modes.len() != snapshot.modes.len()
    {
        return Err(AtlasError::InvalidInput(
            "分享草稿与当前图谱结构不一致".into(),
        ));
    }
    let expected_evidence = snapshot
        .semantic_units
        .iter()
        .map(|unit| unit.source_spans.len())
        .sum::<usize>()
        + snapshot
            .relations
            .iter()
            .map(|edge| edge.evidence.len())
            .sum::<usize>();
    if maps.evidence_by_owner.len() != expected_evidence {
        return Err(AtlasError::InvalidInput(
            "分享草稿与当前证据结构不一致".into(),
        ));
    }
    for unit in &snapshot.semantic_units {
        required_map(&maps.nodes, &unit.id, "node")?;
    }
    for edge in &snapshot.relations {
        required_map(&maps.edges, &edge.id, "edge")?;
    }
    for mode in &snapshot.modes {
        required_map(&maps.modes, &mode.id, "mode")?;
    }
    Ok(())
}

pub fn privacy_findings(value: &str) -> Vec<&'static str> {
    let mut findings = Vec::new();
    if UUID_PATTERN.is_match(value) {
        findings.push("uuid");
    }
    if EMAIL_PATTERN.is_match(value) {
        findings.push("email");
    }
    if UNIX_PATH_PATTERN.is_match(value) {
        findings.push("unix_path");
    }
    if WINDOWS_PATH_PATTERN.is_match(value) || WINDOWS_UNC_PATH_PATTERN.is_match(value) {
        findings.push("windows_path");
    }
    if SECRET_PATTERN.is_match(value) {
        findings.push("secret");
    }
    findings
}

fn validate_relay_package(package: &RelayPackageV1) -> AtlasResult<()> {
    if package.schema_version != RELAY_SCHEMA_VERSION
        || !valid_opaque_id(&package.package_id, "pkg_")
        || !valid_opaque_id(&package.client_publish_id, "publish_")
    {
        return Err(AtlasError::InvalidInput("Relay 包标识无效".into()));
    }
    validate_public_string("title", &package.title, MAX_TITLE_CHARS, false)?;
    if package.graph.nodes.is_empty() || package.graph.nodes.len() > MAX_PUBLIC_NODES {
        return Err(AtlasError::InvalidInput(
            "Relay 包节点数量必须在 1 到 120 之间".into(),
        ));
    }
    let node_ids = unique_public_ids(package.graph.nodes.iter().map(|node| &node.id), 'n')?;
    let edge_ids = unique_public_ids(package.graph.edges.iter().map(|edge| &edge.id), 'r')?;
    let mode_ids = unique_public_ids(package.graph.modes.iter().map(|mode| &mode.id), 'm')?;
    let evidence_ids = unique_public_ids(package.evidence.keys(), 'e')?;
    let _ = edge_ids;

    let mut referenced_evidence = HashSet::new();
    for node in &package.graph.nodes {
        validate_public_string("node.label", &node.label, MAX_LABEL_CHARS, false)?;
        if !node.importance.is_finite() || !(0.0..=1.0).contains(&node.importance) {
            return Err(AtlasError::InvalidInput(
                "节点重要度必须是 0 到 1 的有限数值".into(),
            ));
        }
        for act in &node.acts {
            validate_public_string("node.acts", act, MAX_SHORT_STRING_CHARS, false)?;
        }
        if node.mode_ids.iter().any(|id| !mode_ids.contains(id)) {
            return Err(AtlasError::InvalidInput(
                "节点引用了不存在的公开模式".into(),
            ));
        }
        referenced_evidence.extend(node.evidence_ids.iter().cloned());
    }
    for edge in &package.graph.edges {
        if !node_ids.contains(&edge.source) || !node_ids.contains(&edge.target) {
            return Err(AtlasError::InvalidInput("公开关系引用没有闭合".into()));
        }
        validate_public_string("edge.type", &edge.edge_type, MAX_SHORT_STRING_CHARS, false)?;
        validate_public_string("edge.label", &edge.label, MAX_LABEL_CHARS, false)?;
        referenced_evidence.extend(edge.evidence_ids.iter().cloned());
    }
    for mode in &package.graph.modes {
        if mode.member_node_ids.is_empty()
            || mode.member_node_ids.iter().any(|id| !node_ids.contains(id))
        {
            return Err(AtlasError::InvalidInput("公开模式成员引用没有闭合".into()));
        }
        validate_public_string("mode.kind", &mode.kind, MAX_SHORT_STRING_CHARS, false)?;
        validate_public_string("mode.label", &mode.label, MAX_LABEL_CHARS, false)?;
        validate_public_string("mode.color", &mode.color, MAX_SHORT_STRING_CHARS, false)?;
    }
    if referenced_evidence != evidence_ids {
        return Err(AtlasError::InvalidInput(
            "公开证据必须全部且仅被图谱项目引用".into(),
        ));
    }
    for item in package.evidence.values() {
        validate_public_string("evidence.excerpt", &item.excerpt, MAX_EVIDENCE_CHARS, false)?;
    }
    if package.graph.layout.len() != node_ids.len()
        || package.graph.layout.keys().any(|id| !node_ids.contains(id))
        || package.graph.layout.values().any(|point| {
            !point.x.is_finite()
                || !point.y.is_finite()
                || point.x.abs() > MAX_ABS_LAYOUT_COORDINATE
                || point.y.abs() > MAX_ABS_LAYOUT_COORDINATE
        })
    {
        return Err(AtlasError::InvalidInput(
            "公开布局必须为每个节点提供有限坐标".into(),
        ));
    }
    if let Some(viewport) = &package.graph.viewport
        && (!viewport.x.is_finite()
            || !viewport.y.is_finite()
            || viewport.x.abs() > MAX_ABS_LAYOUT_COORDINATE
            || viewport.y.abs() > MAX_ABS_LAYOUT_COORDINATE
            || !viewport.zoom.is_finite()
            || viewport.zoom <= 0.0
            || viewport.zoom > 100.0)
    {
        return Err(AtlasError::InvalidInput("公开视口无效".into()));
    }
    Ok(())
}

fn validate_share_receipt(receipt: &ShareReceipt) -> AtlasResult<()> {
    for (label, value) in [
        ("publicationId", receipt.publication_id.as_str()),
        ("snapshotId", receipt.snapshot_id.as_str()),
        ("roomId", receipt.room_id.as_str()),
        ("atlasVersionId", receipt.atlas_version_id.as_str()),
    ] {
        validate_metadata_id(label, value)?;
    }
    if !valid_opaque_id(&receipt.package_id, "pkg_")
        || !valid_opaque_id(&receipt.client_publish_id, "publish_")
    {
        return Err(AtlasError::InvalidInput("发布回执的包标识无效".into()));
    }
    if receipt.package_sha256.len() != 64
        || !receipt
            .package_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AtlasError::InvalidInput("发布回执缺少有效 SHA-256".into()));
    }
    let relay_url = url::Url::parse(&receipt.relay_url)
        .map_err(|_| AtlasError::InvalidInput("Relay URL 无效".into()))?;
    let secure_transport = relay_url.scheme() == "https"
        || (cfg!(debug_assertions)
            && relay_url.scheme() == "http"
            && relay_url.host_str().is_some_and(is_loopback_host));
    if !secure_transport
        || !relay_url.username().is_empty()
        || relay_url.password().is_some()
        || relay_url.query().is_some()
        || relay_url.fragment().is_some()
        || receipt.relay_url.chars().count() > 2048
    {
        return Err(AtlasError::InvalidInput("Relay URL 无效".into()));
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn validate_public_string(
    field: &str,
    value: &str,
    max_chars: usize,
    allow_empty: bool,
) -> AtlasResult<()> {
    let character_count = value.chars().count();
    if (!allow_empty && value.trim().is_empty()) || character_count > max_chars {
        return Err(AtlasError::InvalidInput(format!(
            "公开字段 {field} 的长度无效"
        )));
    }
    let findings = privacy_findings(value);
    if !findings.is_empty() {
        return Err(AtlasError::InvalidInput(format!(
            "公开字段 {field} 包含不安全内容：{}",
            findings.join(", ")
        )));
    }
    Ok(())
}

fn validate_metadata_id(label: &str, value: &str) -> AtlasResult<()> {
    if value.trim().is_empty()
        || value.chars().count() > 160
        || value.chars().any(|character| character.is_control())
    {
        return Err(AtlasError::InvalidInput(format!("发布回执的 {label} 无效")));
    }
    Ok(())
}

fn unique_approval_ids(values: &[String], label: &str) -> AtlasResult<HashSet<String>> {
    let unique: HashSet<_> = values.iter().cloned().collect();
    if unique.len() != values.len() {
        return Err(AtlasError::InvalidInput(format!(
            "{label}批准列表包含重复项目"
        )));
    }
    Ok(unique)
}

fn unique_source_ids<'a>(
    values: impl Iterator<Item = &'a str>,
    label: &str,
) -> AtlasResult<HashSet<&'a str>> {
    let mut unique = HashSet::new();
    for value in values {
        if value.is_empty() || !unique.insert(value) {
            return Err(AtlasError::InvalidInput(format!(
                "本地{label} ID 缺失或重复"
            )));
        }
    }
    Ok(unique)
}

fn unique_public_ids<'a>(
    values: impl Iterator<Item = &'a String>,
    prefix: char,
) -> AtlasResult<HashSet<String>> {
    let mut unique = HashSet::new();
    for value in values {
        if !valid_public_id(value, prefix) || !unique.insert(value.clone()) {
            return Err(AtlasError::InvalidInput("公开图谱 ID 无效或重复".into()));
        }
    }
    Ok(unique)
}

fn insert_entity_map(
    destination: &mut HashMap<String, String>,
    records: &mut Vec<RelayIdMapRecord>,
    entity_kind: &str,
    source_id: &str,
    public_id: String,
) -> AtlasResult<()> {
    if destination
        .insert(source_id.to_string(), public_id.clone())
        .is_some()
    {
        return Err(AtlasError::InvalidInput("本地图谱 ID 重复".into()));
    }
    records.push(RelayIdMapRecord {
        entity_kind: entity_kind.into(),
        source_id: source_id.into(),
        source_index: -1,
        public_id,
    });
    Ok(())
}

fn insert_evidence_map(
    maps: &mut PublicIdMaps,
    records: &mut Vec<RelayIdMapRecord>,
    kind: EvidenceOwnerKind,
    source_id: &str,
    source_index: usize,
    public_id: String,
) -> AtlasResult<()> {
    let key = (kind.clone(), source_id.to_string(), source_index);
    if maps
        .evidence_by_owner
        .insert(key, public_id.clone())
        .is_some()
        || maps
            .evidence_by_public_id
            .insert(
                public_id.clone(),
                EvidenceOwner {
                    kind: kind.clone(),
                    source_id: source_id.into(),
                },
            )
            .is_some()
    {
        return Err(AtlasError::InvalidInput("本地证据映射重复".into()));
    }
    records.push(RelayIdMapRecord {
        entity_kind: match kind {
            EvidenceOwnerKind::Node => "node_evidence",
            EvidenceOwnerKind::Edge => "edge_evidence",
        }
        .into(),
        source_id: source_id.into(),
        source_index: i64::try_from(source_index)
            .map_err(|_| AtlasError::InvalidInput("证据序号过大".into()))?,
        public_id,
    });
    Ok(())
}

fn insert_loaded_map(
    destination: &mut HashMap<String, String>,
    record: &RelayIdMapRecord,
    prefix: char,
) -> AtlasResult<()> {
    if record.source_index != -1
        || !valid_public_id(&record.public_id, prefix)
        || destination
            .insert(record.source_id.clone(), record.public_id.clone())
            .is_some()
    {
        return Err(AtlasError::InvalidInput(
            "分享草稿包含无效或重复公开 ID 映射".into(),
        ));
    }
    Ok(())
}

fn required_map<'a>(
    map: &'a HashMap<String, String>,
    source_id: &str,
    kind: &str,
) -> AtlasResult<&'a String> {
    map.get(source_id)
        .ok_or_else(|| AtlasError::InvalidInput(format!("分享草稿缺少 {kind} 映射")))
}

fn public_id(prefix: char, zero_based_index: usize) -> String {
    format!("{prefix}{:03}", zero_based_index + 1)
}

fn valid_public_id(value: &str, prefix: char) -> bool {
    value
        .strip_prefix(prefix)
        .is_some_and(|suffix| suffix.len() >= 3 && suffix.bytes().all(|byte| byte.is_ascii_digit()))
}

fn opaque_id(prefix: &str) -> String {
    format!("{prefix}{}", Uuid::new_v4().simple())
}

fn valid_opaque_id(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(|suffix| {
        suffix.len() >= 8
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    })
}

fn bounded_excerpt(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= MAX_EVIDENCE_CHARS {
        return trimmed.into();
    }
    let mut excerpt: String = trimmed.chars().take(MAX_EVIDENCE_CHARS - 1).collect();
    excerpt.push('…');
    excerpt
}

fn normalized_coordinate(value: f64) -> AtlasResult<f64> {
    if !value.is_finite() || value.abs() > MAX_ABS_LAYOUT_COORDINATE {
        return Err(AtlasError::InvalidInput(
            "公开节点布局必须使用有限且合理的坐标".into(),
        ));
    }
    let normalized = (value * 1_000.0).round() / 1_000.0;
    Ok(if normalized == 0.0 { 0.0 } else { normalized })
}

fn normalized_zoom(value: f64) -> AtlasResult<f64> {
    if !value.is_finite() || value <= 0.0 || value > 100.0 {
        return Err(AtlasError::InvalidInput(
            "公开视口必须使用有限且合理的正缩放值".into(),
        ));
    }
    let normalized = (value * 1_000_000.0).round() / 1_000_000.0;
    if normalized <= 0.0 {
        return Err(AtlasError::InvalidInput("公开视口缩放值过小".into()));
    }
    Ok(normalized)
}

fn normalized_importance(value: f32) -> AtlasResult<f32> {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(AtlasError::InvalidInput(
            "节点重要度必须是 0 到 1 的有限数值".into(),
        ));
    }
    let normalized = ((value as f64 * 1_000_000.0).round() / 1_000_000.0) as f32;
    Ok(if normalized == 0.0 { 0.0 } else { normalized })
}

fn snapshot_digest(snapshot: &AnalysisSnapshot) -> AtlasResult<String> {
    Ok(sha256_hex(&serde_json::to_vec(snapshot)?))
}

fn package_digest(package: &RelayPackageV1) -> AtlasResult<String> {
    Ok(sha256_hex(&browser_package_json(package)?))
}

fn browser_package_json(package: &RelayPackageV1) -> AtlasResult<Vec<u8>> {
    let nodes = package
        .graph
        .nodes
        .iter()
        .map(|node| BrowserDigestNode {
            id: &node.id,
            origin: node.origin,
            label: &node.label,
            kind: node.kind,
            speaker: node.speaker,
            acts: &node.acts,
            mode_ids: &node.mode_ids,
            evidence_ids: &node.evidence_ids,
            importance: JavascriptF32(node.importance),
            primary: node.primary,
        })
        .collect();
    let layout = package
        .graph
        .layout
        .iter()
        .map(|(id, point)| {
            (
                id.as_str(),
                BrowserDigestPoint {
                    x: JavascriptF64(point.x),
                    y: JavascriptF64(point.y),
                },
            )
        })
        .collect();
    let viewport = package
        .graph
        .viewport
        .as_ref()
        .map(|viewport| BrowserDigestViewport {
            x: JavascriptF64(viewport.x),
            y: JavascriptF64(viewport.y),
            zoom: JavascriptF64(viewport.zoom),
        });
    Ok(serde_json::to_vec(&BrowserDigestPackage {
        schema_version: &package.schema_version,
        package_id: &package.package_id,
        client_publish_id: &package.client_publish_id,
        title: &package.title,
        published_at: &package.published_at,
        graph: BrowserDigestGraph {
            nodes,
            edges: &package.graph.edges,
            modes: &package.graph.modes,
            layout,
            viewport,
        },
        evidence: &package.evidence,
    })?)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn count_unsafe_draft_strings(title: &str, nodes: &[ShareDraftNode]) -> usize {
    usize::from(!privacy_findings(title).is_empty())
        + nodes
            .iter()
            .map(|node| {
                usize::from(!privacy_findings(&node.label).is_empty())
                    + node
                        .evidence
                        .iter()
                        .filter(|evidence| !privacy_findings(&evidence.excerpt).is_empty())
                        .count()
            })
            .sum::<usize>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            AnalysisProviderKind, AnalysisState, CommitImportRequest, IssueSeverity, Mode,
            ModeMembership, NodeLayout, Provenance, Relation, ValidationIssue, ViewportState,
        },
        import::preview_paste_content,
    };

    struct Fixture {
        repository: Repository,
        snapshot: AnalysisSnapshot,
        private_message_text: String,
    }

    async fn fixture(node_count: usize, evidence_text: &str) -> Fixture {
        let repository = Repository::in_memory().await.unwrap();
        let private_message_text =
            "Private full transcript tail that must remain in source_messages".to_string();
        let preview = preview_paste_content(&format!(
            "用户: Public question {private_message_text}\nGPT: Public answer"
        ))
        .unwrap();
        let summary = repository
            .commit_import(CommitImportRequest {
                title: "Relay handoff".into(),
                preview,
                analyze_redacted: true,
            })
            .await
            .unwrap();
        let conversation = repository.load_conversation(&summary.id).await.unwrap();
        let message_id = conversation.messages[0].id.clone();
        let span = SourceSpan {
            message_id: message_id.clone(),
            start_utf16: 0,
            end_utf16: evidence_text.encode_utf16().count(),
            exact_quote: evidence_text.into(),
            sha256: sha256_hex(evidence_text.as_bytes()),
            model_saw_redacted: false,
        };
        let mut units = Vec::with_capacity(node_count);
        for index in 0..node_count {
            units.push(SemanticUnit {
                id: if index == 0 {
                    "80000000-0000-4000-8000-000000000001".into()
                } else {
                    format!("local-unit-{index}")
                },
                turn_id: format!("local-turn-{index}"),
                speaker: if index % 2 == 0 {
                    Speaker::User
                } else {
                    Speaker::Assistant
                },
                label: format!("Public node {}", index + 1),
                acts: vec!["陈述".into()],
                importance: 0.9,
                provenance: Provenance::Model,
                source_spans: vec![span.clone()],
                primary: true,
                operation_only: false,
            });
        }
        let relations = if node_count >= 2 {
            vec![Relation {
                id: "local-relation-1".into(),
                source: units[0].id.clone(),
                target: units[1].id.clone(),
                kind: "支持".into(),
                label: "supports".into(),
                confidence: 0.95,
                evidence: vec![span.clone()],
                user_created: false,
            }]
        } else {
            Vec::new()
        };
        let modes = vec![Mode {
            id: "local-mode-1".into(),
            kind: "goal".into(),
            label: "Goal".into(),
            color: "#dbeafe".into(),
            confidence: 0.8,
        }];
        let memberships = units
            .iter()
            .enumerate()
            .map(|(index, unit)| ModeMembership {
                id: format!("local-membership-{index}"),
                mode_id: modes[0].id.clone(),
                unit_id: unit.id.clone(),
                confidence: 0.8,
            })
            .collect();
        let run = repository
            .create_run(
                &summary.id,
                AnalysisProviderKind::OpenaiApi,
                Some("private-provider-version"),
                "private-credential-mode",
                "private-model-id",
            )
            .await
            .unwrap();
        let snapshot = AnalysisSnapshot {
            id: "local-snapshot-id".into(),
            run_id: run.id,
            conversation_id: summary.id,
            provider: AnalysisProviderKind::OpenaiApi,
            provider_version: Some("private-provider-version".into()),
            credential_mode: Some("private-credential-mode".into()),
            model_id: "private-model-id".into(),
            prompt_version: "private-prompt-version".into(),
            schema_version: "private-schema-version".into(),
            status: AnalysisState::Ready,
            semantic_units: units,
            relations,
            modes,
            memberships,
            validation_issues: vec![ValidationIssue {
                stage: "private-validation-stage".into(),
                item_id: Some("local-item-id".into()),
                severity: IssueSeverity::Warning,
                message: "private validation message".into(),
            }],
            raw_model_output: serde_json::json!({
                "sourcePath": "/Users/private/local-rollout.jsonl",
                "fullText": private_message_text,
                "provider": "private-provider",
                "prompt": "private prompt",
            }),
            input_tokens: Some(42),
            output_tokens: Some(21),
            created_at: Utc::now(),
        };
        repository.save_snapshot(&snapshot).await.unwrap();
        repository
            .save_layout(
                &snapshot.id,
                &LayoutState {
                    nodes: snapshot
                        .semantic_units
                        .iter()
                        .take(2)
                        .enumerate()
                        .map(|(index, unit)| NodeLayout {
                            unit_id: unit.id.clone(),
                            x: index as f64 * 200.0,
                            y: index as f64 * 100.0,
                            pinned: false,
                            collapsed: false,
                        })
                        .collect(),
                    viewport: ViewportState {
                        x: 10.0,
                        y: 20.0,
                        zoom: 0.8,
                    },
                    show_mode_islands: true,
                    updated_at: None,
                },
            )
            .await
            .unwrap();
        Fixture {
            repository,
            snapshot,
            private_message_text,
        }
    }

    fn all_approvals(draft: &ShareDraft) -> ShareApprovals {
        ShareApprovals {
            node_draft_ids: draft
                .nodes
                .iter()
                .map(|node| node.draft_item_id.clone())
                .collect(),
            evidence_draft_ids: draft
                .nodes
                .iter()
                .flat_map(|node| node.evidence.iter())
                .map(|evidence| evidence.draft_evidence_id.clone())
                .collect(),
            title: None,
        }
    }

    #[tokio::test]
    async fn builds_allowlisted_package_with_public_closed_ids() {
        let fixture = fixture(2, "A deliberately public excerpt").await;
        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        assert!(
            draft
                .nodes
                .iter()
                .all(|node| valid_public_id(&node.draft_item_id, 'n'))
        );
        assert!(
            draft
                .nodes
                .iter()
                .flat_map(|node| &node.evidence)
                .all(|evidence| !evidence.selected_by_default
                    && valid_public_id(&evidence.draft_evidence_id, 'e'))
        );

        let package =
            finalize_share_package(&fixture.repository, &draft.draft_id, all_approvals(&draft))
                .await
                .unwrap();
        validate_relay_package(&package).unwrap();
        assert_eq!(package.schema_version, "relay-v1");
        assert!(package.package_id.starts_with("pkg_"));
        assert!(package.client_publish_id.starts_with("publish_"));
        assert_eq!(package.graph.nodes.len(), 2);
        assert_eq!(package.graph.edges.len(), 1);
        assert_eq!(package.graph.modes.len(), 1);
        assert_eq!(package.graph.layout.len(), 2);
        assert!(
            package
                .graph
                .layout
                .values()
                .all(|point| point.x.is_finite() && point.y.is_finite())
        );

        let serialized = serde_json::to_string(&package).unwrap();
        for private_value in [
            fixture.snapshot.id.as_str(),
            fixture.snapshot.semantic_units[0].id.as_str(),
            fixture.snapshot.semantic_units[0].turn_id.as_str(),
            fixture.snapshot.model_id.as_str(),
            fixture.snapshot.prompt_version.as_str(),
            "/Users/private/local-rollout.jsonl",
            fixture.private_message_text.as_str(),
            "rawModelOutput",
            "validationIssues",
            "sourceMessages",
            "messageId",
            "provider",
        ] {
            assert!(
                !serialized.contains(private_value),
                "leaked {private_value}"
            );
        }
        let json: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert!(json.get("schemaVersion").is_some());
        assert!(json.get("clientPublishId").is_some());
        assert!(json["graph"]["edges"][0].get("type").is_some());
        assert!(json.get("schema_version").is_none());
    }

    #[tokio::test]
    async fn defaults_to_primary_nodes_without_preselecting_secondary_nodes() {
        let fixture = fixture(2, "Safe evidence").await;
        let mut secondary = fixture.snapshot.semantic_units[1].clone();
        secondary.primary = false;
        fixture
            .repository
            .append_correction(
                &fixture.snapshot.id,
                "update_unit",
                &secondary.id,
                Some(serde_json::to_value(&fixture.snapshot.semantic_units[1]).unwrap()),
                serde_json::to_value(&secondary).unwrap(),
            )
            .await
            .unwrap();

        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        let primary = draft
            .nodes
            .iter()
            .find(|node| node.label == "Public node 1")
            .unwrap();
        let secondary = draft
            .nodes
            .iter()
            .find(|node| node.label == "Public node 2")
            .unwrap();

        assert!(primary.primary && primary.selected_by_default);
        assert!(!secondary.primary && !secondary.selected_by_default);
    }

    #[tokio::test]
    async fn privacy_canaries_fail_without_mutating_local_graph_state() {
        let fixture = fixture(2, "Safe evidence").await;
        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        let base_before = fixture
            .repository
            .load_snapshot(None, Some(&fixture.snapshot.id))
            .await
            .unwrap();
        let corrections_before = fixture
            .repository
            .load_corrections(&fixture.snapshot.id)
            .await
            .unwrap();
        let layout_before = fixture
            .repository
            .load_layout(&fixture.snapshot.id)
            .await
            .unwrap();
        for canary in [
            "person@example.com",
            "/Users/private/secret.jsonl",
            r"C:\Users\private\secret.jsonl",
            "80000000-0000-4000-8000-000000000001",
            "DEVIN_API_KEY=cog_supersecretvalue",
            "Authorization: Basic Zml4dHVyZTpzZWNyZXQ=",
        ] {
            let mut approvals = all_approvals(&draft);
            approvals.title = Some(canary.into());
            assert!(
                finalize_share_package(&fixture.repository, &draft.draft_id, approvals)
                    .await
                    .is_err(),
                "accepted privacy canary {canary}"
            );
        }
        assert_eq!(
            fixture
                .repository
                .load_snapshot(None, Some(&fixture.snapshot.id))
                .await
                .unwrap(),
            base_before
        );
        assert_eq!(
            fixture
                .repository
                .load_corrections(&fixture.snapshot.id)
                .await
                .unwrap(),
            corrections_before
        );
        assert_eq!(
            fixture
                .repository
                .load_layout(&fixture.snapshot.id)
                .await
                .unwrap(),
            layout_before
        );
        let published_at: Option<String> =
            sqlx::query_scalar("SELECT published_at FROM relay_share_drafts WHERE draft_id = ?")
                .bind(&draft.draft_id)
                .fetch_one(fixture.repository.pool())
                .await
                .unwrap();
        assert_eq!(published_at, None);
    }

    #[tokio::test]
    async fn unsafe_evidence_is_excluded_by_default_and_rejected_when_approved() {
        let fixture = fixture(1, "person@example.com").await;
        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        assert!(
            draft
                .warnings
                .iter()
                .any(|warning| warning.contains("隐私"))
        );
        let node_ids = vec![draft.nodes[0].draft_item_id.clone()];
        let unsafe_evidence_id = draft.nodes[0].evidence[0].draft_evidence_id.clone();
        let error = finalize_share_package(
            &fixture.repository,
            &draft.draft_id,
            ShareApprovals {
                node_draft_ids: node_ids.clone(),
                evidence_draft_ids: vec![unsafe_evidence_id],
                title: None,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(error, AtlasError::InvalidInput(_)));

        let package = finalize_share_package(
            &fixture.repository,
            &draft.draft_id,
            ShareApprovals {
                node_draft_ids: node_ids,
                evidence_draft_ids: Vec::new(),
                title: None,
            },
        )
        .await
        .unwrap();
        assert!(package.evidence.is_empty());
        assert!(package.graph.nodes[0].evidence_ids.is_empty());
    }

    #[tokio::test]
    async fn enforces_120_node_limit_and_builds_finite_fallback_layout() {
        let fixture = fixture(121, "Safe evidence").await;
        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        assert_eq!(draft.nodes.len(), 121);
        assert_eq!(
            draft
                .nodes
                .iter()
                .filter(|node| node.selected_by_default)
                .count(),
            MAX_PUBLIC_NODES
        );
        assert!(
            finalize_share_package(
                &fixture.repository,
                &draft.draft_id,
                ShareApprovals {
                    node_draft_ids: draft
                        .nodes
                        .iter()
                        .map(|node| node.draft_item_id.clone())
                        .collect(),
                    evidence_draft_ids: Vec::new(),
                    title: None,
                },
            )
            .await
            .is_err()
        );

        let selected: Vec<_> = draft
            .nodes
            .iter()
            .filter(|node| node.selected_by_default)
            .map(|node| node.draft_item_id.clone())
            .collect();
        let package = finalize_share_package(
            &fixture.repository,
            &draft.draft_id,
            ShareApprovals {
                node_draft_ids: selected,
                evidence_draft_ids: Vec::new(),
                title: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(package.graph.nodes.len(), MAX_PUBLIC_NODES);
        assert_eq!(package.graph.layout.len(), MAX_PUBLIC_NODES);
        assert!(
            package
                .graph
                .layout
                .values()
                .all(|point| point.x.is_finite() && point.y.is_finite())
        );
        validate_relay_package(&package).unwrap();
    }

    #[tokio::test]
    async fn stale_draft_reloads_and_rejects_new_effective_corrections() {
        let fixture = fixture(1, "Safe evidence").await;
        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        let mut changed = fixture.snapshot.semantic_units[0].clone();
        changed.label = "Updated after preview".into();
        let changed_id = changed.id.clone();
        fixture
            .repository
            .append_correction(
                &fixture.snapshot.id,
                "update_unit",
                &changed_id,
                Some(serde_json::to_value(&fixture.snapshot.semantic_units[0]).unwrap()),
                serde_json::to_value(changed).unwrap(),
            )
            .await
            .unwrap();
        let before_count = fixture
            .repository
            .load_corrections(&fixture.snapshot.id)
            .await
            .unwrap()
            .len();
        let error = finalize_share_package(
            &fixture.repository,
            &draft.draft_id,
            ShareApprovals {
                node_draft_ids: vec![draft.nodes[0].draft_item_id.clone()],
                evidence_draft_ids: Vec::new(),
                title: None,
            },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("重新生成分享预览"));
        assert_eq!(
            fixture
                .repository
                .load_corrections(&fixture.snapshot.id)
                .await
                .unwrap()
                .len(),
            before_count
        );
    }

    #[tokio::test]
    async fn records_idempotent_receipts_and_persists_no_package_payload() {
        let fixture = fixture(1, "Safe evidence").await;
        let draft = build_share_preview(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        let package = finalize_share_package(
            &fixture.repository,
            &draft.draft_id,
            ShareApprovals {
                node_draft_ids: vec![draft.nodes[0].draft_item_id.clone()],
                evidence_draft_ids: Vec::new(),
                title: None,
            },
        )
        .await
        .unwrap();
        let receipt = ShareReceipt {
            publication_id: "publication-demo-1".into(),
            snapshot_id: fixture.snapshot.id.clone(),
            package_id: package.package_id.clone(),
            client_publish_id: package.client_publish_id.clone(),
            room_id: "room-demo-1".into(),
            atlas_version_id: "version-demo-1".into(),
            package_sha256: package_digest(&package).unwrap(),
            relay_url: "https://relay.example/room-demo-1".into(),
            published_at: package.published_at,
        };
        let mut wrong_digest = receipt.clone();
        wrong_digest.package_sha256 = "0".repeat(64);
        assert!(
            record_share_receipt(&fixture.repository, wrong_digest)
                .await
                .is_err()
        );
        let mut insecure_remote = receipt.clone();
        insecure_remote.relay_url = "http://relay.example/room-demo-1".into();
        assert!(
            record_share_receipt(&fixture.repository, insecure_remote)
                .await
                .is_err()
        );
        let mut bearer_fragment = receipt.clone();
        bearer_fragment.relay_url =
            "https://relay.example/room-demo-1#invite=private-bearer".into();
        assert!(
            record_share_receipt(&fixture.repository, bearer_fragment)
                .await
                .is_err()
        );
        let mut query_secret = receipt.clone();
        query_secret.relay_url = "https://relay.example/room-demo-1?invite=private-bearer".into();
        assert!(
            record_share_receipt(&fixture.repository, query_secret)
                .await
                .is_err()
        );
        let mut loopback = receipt.clone();
        loopback.relay_url = "http://127.0.0.1:54321/room-demo-1".into();
        assert_eq!(
            validate_share_receipt(&loopback).is_ok(),
            cfg!(debug_assertions)
        );
        assert_eq!(
            record_share_receipt(&fixture.repository, receipt.clone())
                .await
                .unwrap(),
            receipt
        );
        assert_eq!(
            record_share_receipt(&fixture.repository, receipt.clone())
                .await
                .unwrap(),
            receipt
        );
        let publications = list_share_publications(&fixture.repository, &fixture.snapshot.id)
            .await
            .unwrap();
        assert_eq!(publications, vec![receipt.clone()]);
        assert!(
            list_share_publications(&fixture.repository, "another-snapshot")
                .await
                .unwrap()
                .is_empty()
        );

        let changed_finalize = finalize_share_package(
            &fixture.repository,
            &draft.draft_id,
            ShareApprovals {
                node_draft_ids: vec![draft.nodes[0].draft_item_id.clone()],
                evidence_draft_ids: Vec::new(),
                title: Some("A different public title".into()),
            },
        )
        .await;
        assert!(changed_finalize.is_err());

        let mut conflicting = receipt;
        conflicting.room_id = "different-room".into();
        assert!(
            record_share_receipt(&fixture.repository, conflicting)
                .await
                .is_err()
        );

        let draft_columns = sqlx::query("PRAGMA table_info(relay_share_drafts)")
            .fetch_all(fixture.repository.pool())
            .await
            .unwrap();
        let column_names: Vec<String> = draft_columns
            .into_iter()
            .map(|row| sqlx::Row::try_get(&row, "name").unwrap())
            .collect();
        assert!(column_names.iter().all(|column| {
            !matches!(
                column.as_str(),
                "payload_json" | "package_json" | "title" | "excerpt" | "source_messages"
            )
        }));
    }

    #[test]
    fn dto_serialization_is_camel_case_and_scanner_matches_contract_canaries() {
        let approvals = ShareApprovals {
            node_draft_ids: vec!["n001".into()],
            evidence_draft_ids: vec!["e001".into()],
            title: Some("Public title".into()),
        };
        let json = serde_json::to_value(approvals).unwrap();
        assert_eq!(json["nodeDraftIds"][0], "n001");
        assert_eq!(json["evidenceDraftIds"][0], "e001");
        assert!(json.get("node_draft_ids").is_none());
        for canary in [
            "person@example.com",
            "/home/user/private.txt",
            "/srv/team/private.txt",
            r"D:\private\secret.txt",
            r"\\server\share\secret.txt",
            "80000000-0000-4000-8000-000000000001",
            "token=abcdefghijklmnop",
            "ghp_abcdefghijklmnopqrstuvwxyz1234",
            "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signaturefixture",
            "Authorization: Basic Zml4dHVyZTpzZWNyZXQ=",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.signaturefixture",
            "-----BEGIN PRIVATE KEY-----",
        ] {
            assert!(!privacy_findings(canary).is_empty(), "missed {canary}");
        }
    }

    #[test]
    fn package_digest_matches_browser_json_stringify_number_shape() {
        let package = RelayPackageV1 {
            schema_version: "relay-v1".into(),
            package_id: "pkg_demo_01".into(),
            client_publish_id: "publish_demo_01".into(),
            title: "Demo".into(),
            published_at: DateTime::parse_from_rfc3339("2026-08-15T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            graph: RelayGraphV1 {
                nodes: vec![PublicGraphNode {
                    id: "n001".into(),
                    origin: PublicNodeOrigin::Source,
                    label: "Node".into(),
                    kind: PublicNodeKind::Anchor,
                    speaker: Some(Speaker::User),
                    acts: vec!["陈述".into()],
                    mode_ids: vec!["m001".into()],
                    evidence_ids: vec!["e001".into()],
                    importance: 0.9,
                    primary: true,
                }],
                edges: Vec::new(),
                modes: vec![PublicGraphMode {
                    id: "m001".into(),
                    kind: "goal".into(),
                    label: "Goal".into(),
                    color: "#dbeafe".into(),
                    member_node_ids: vec!["n001".into()],
                }],
                layout: BTreeMap::from([("n001".into(), PublicPoint { x: 120.0, y: -0.0 })]),
                viewport: Some(PublicViewport {
                    x: 0.0,
                    y: 20.5,
                    zoom: 1.0,
                }),
            },
            evidence: BTreeMap::from([(
                "e001".into(),
                PublicEvidence {
                    excerpt: "Evidence".into(),
                    speaker: Some(Speaker::Assistant),
                },
            )]),
        };
        let browser_json = String::from_utf8(browser_package_json(&package).unwrap()).unwrap();
        assert_eq!(
            browser_json,
            r##"{"schemaVersion":"relay-v1","packageId":"pkg_demo_01","clientPublishId":"publish_demo_01","title":"Demo","publishedAt":"2026-08-15T00:00:00Z","graph":{"nodes":[{"id":"n001","origin":"source","label":"Node","kind":"anchor","speaker":"user","acts":["陈述"],"modeIds":["m001"],"evidenceIds":["e001"],"importance":0.9,"primary":true}],"edges":[],"modes":[{"id":"m001","kind":"goal","label":"Goal","color":"#dbeafe","memberNodeIds":["n001"]}],"layout":{"n001":{"x":120,"y":0}},"viewport":{"x":0,"y":20.5,"zoom":1}},"evidence":{"e001":{"excerpt":"Evidence","speaker":"assistant"}}}"##
        );
    }
}
