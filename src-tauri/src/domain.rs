use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_VISIBLE_TURNS: usize = 100;
pub const MAX_TRANSCRIPT_CHARS: usize = 120_000;
pub const MAX_SEMANTIC_UNITS: usize = 300;
pub const DEFAULT_MODEL: &str = "gpt-5-mini";
pub const CODEX_CLI_MODEL: &str = "gpt-5.6-luna";
pub const PROMPT_VERSION: &str = "dialogue-atlas-v2";
pub const SCHEMA_VERSION: &str = "1.0.0";
pub const DIALOGUE_ACTS: &[&str] = &[
    "提问",
    "请求",
    "任务",
    "建议",
    "陈述",
    "回答",
    "解释",
    "论证",
    "举例",
    "评价",
    "同意",
    "质疑",
    "纠正",
    "承诺",
    "反馈",
    "话语管理",
    "约束",
    "假设检验",
    "证据",
    "区分",
    "归类",
    "反例",
    "限定",
    "撤回",
    "其他",
];
pub const RELATION_KINDS: &[&str] = &[
    "回应",
    "支持",
    "理由",
    "举例",
    "条件",
    "对比",
    "质疑",
    "反证",
    "收窄",
    "修正",
    "重新归类",
    "撤回",
    "重新打开",
    "中断后续答",
    "导致",
    "未解决",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Speaker {
    User,
    Assistant,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimeStatus {
    Valid,
    #[default]
    Missing,
    Invalid,
}

impl TimeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Valid => "valid",
            Self::Missing => "missing",
            Self::Invalid => "invalid",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimeCoverage {
    Complete,
    Partial,
    #[default]
    None,
}

impl TimeCoverage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Partial => "partial",
            Self::None => "none",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceFormat {
    RawRollout,
    VisibleExport,
    Paste,
    #[default]
    LegacyUnknown,
}

impl SourceFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RawRollout => "raw_rollout",
            Self::VisibleExport => "visible_export",
            Self::Paste => "paste",
            Self::LegacyUnknown => "legacy_unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactionRange {
    pub kind: String,
    pub original_start_utf16: usize,
    pub original_end_utf16: usize,
    pub redacted_start_utf16: usize,
    pub redacted_end_utf16: usize,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceMessage {
    pub id: String,
    pub speaker: Speaker,
    pub phase: Option<String>,
    pub sequence: usize,
    pub external_message_id: Option<String>,
    #[serde(default)]
    pub external_turn_id: Option<String>,
    pub source_event_index: Option<usize>,
    #[serde(default)]
    pub occurred_at_utc: Option<DateTime<Utc>>,
    #[serde(default)]
    pub occurred_at_raw: Option<String>,
    #[serde(default)]
    pub time_status: TimeStatus,
    pub text: String,
    pub text_sha256: String,
    pub redacted_text: String,
    #[serde(default)]
    pub redaction_map: Vec<RedactionRange>,
    /// Preview-only display metadata; reconstructed from visible turns after load.
    #[serde(default)]
    pub turn_ordinal: usize,
    #[serde(default)]
    pub operation_only: bool,
    #[serde(default)]
    pub redactions: Vec<PreviewRedaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRedaction {
    pub start: usize,
    pub end: usize,
    pub replacement: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisibleTurn {
    pub id: String,
    pub ordinal: usize,
    pub speaker: Speaker,
    pub operation_only: bool,
    pub message_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyFinding {
    pub message_id: String,
    pub kind: String,
    pub start_utf16: usize,
    pub end_utf16: usize,
    pub preview: String,
    pub replacement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub id: String,
    pub title: String,
    pub source_kind: String,
    #[serde(default)]
    pub source_format: SourceFormat,
    pub source_path: Option<String>,
    pub source_sha256: String,
    #[serde(default)]
    pub external_session_id: Option<String>,
    #[serde(default)]
    pub first_visible_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_activity_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_completed_turn_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_message_id: Option<String>,
    #[serde(default)]
    pub time_coverage: TimeCoverage,
    #[serde(default)]
    pub source_file_size: Option<u64>,
    #[serde(default)]
    pub source_file_mtime_ns: Option<i64>,
    #[serde(default)]
    pub supersedes_conversation_id: Option<String>,
    #[serde(default)]
    pub source_still_writing: bool,
    pub messages: Vec<SourceMessage>,
    pub turns: Vec<VisibleTurn>,
    pub character_count: usize,
    pub privacy_findings: Vec<PrivacyFinding>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportRequest {
    pub title: String,
    pub preview: ImportPreview,
    /// When true, analysis uses `redacted_text`; the immutable local source still
    /// keeps the exact visible text for evidence inspection.
    #[serde(default = "default_true")]
    pub analyze_redacted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMessageConfirmation {
    pub id: String,
    pub speaker: Speaker,
    pub phase: Option<String>,
    pub turn_ordinal: usize,
    pub text: String,
    #[serde(default)]
    pub operation_only: bool,
    #[serde(default)]
    pub redactions: Vec<PreviewRedaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportOptions {
    pub preview_id: String,
    pub title: String,
    pub messages: Vec<PreviewMessageConfirmation>,
    pub redaction_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitImportResponse {
    pub conversation_id: String,
    #[serde(default)]
    pub already_imported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartAnalysisOptions {
    pub conversation_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisProviderKind {
    CodexCli,
    #[default]
    OpenaiApi,
}

impl AnalysisProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CodexCli => "codex_cli",
            Self::OpenaiApi => "openai_api",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlatformKind {
    Macos,
    Windows,
    Other,
}

impl PlatformKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Macos => "macOS",
            Self::Windows => "Windows",
            Self::Other => "系统",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStoreKind {
    MacosKeychain,
    WindowsCredentialManager,
    SystemKeyring,
}

impl CredentialStoreKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::MacosKeychain => "macOS Keychain",
            Self::WindowsCredentialManager => "Windows 凭据管理器",
            Self::SystemKeyring => "系统凭据库",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub platform: PlatformKind,
    pub available_providers: Vec<AnalysisProviderKind>,
    pub credential_store: CredentialStoreKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSettings {
    pub provider: AnalysisProviderKind,
    pub default_openai_model: String,
    pub codex_cli_model: String,
    pub capabilities: PlatformCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProviderStatus {
    pub provider: AnalysisProviderKind,
    pub ok: bool,
    pub configured: bool,
    pub available: bool,
    pub authenticated: bool,
    pub model: String,
    pub version: Option<String>,
    pub message: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub source_kind: String,
    #[serde(default)]
    pub source_format: SourceFormat,
    #[serde(default)]
    pub external_session_id: Option<String>,
    pub turn_count: usize,
    pub character_count: usize,
    pub analyze_redacted: bool,
    #[serde(default)]
    pub first_visible_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_activity_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_completed_turn_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_message_id: Option<String>,
    #[serde(default)]
    pub time_coverage: TimeCoverage,
    #[serde(default)]
    pub source_file_size: Option<u64>,
    #[serde(default)]
    pub source_file_mtime_ns: Option<i64>,
    #[serde(default)]
    pub supersedes_conversation_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompletionState {
    Completed,
    InProgressOrUnknown,
    Undated,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarSourceState {
    Active,
    Archived,
    Missing,
    ImportOnly,
}

impl CalendarSourceState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
            Self::Missing => "missing",
            Self::ImportOnly => "import_only",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarImportState {
    NotImported,
    ImportedCurrent,
    SourceUpdated,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarAnalysisState {
    #[default]
    None,
    Ready,
    Partial,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEntry {
    pub id: String,
    pub external_session_id: Option<String>,
    pub title: String,
    pub last_activity_at: Option<DateTime<Utc>>,
    pub last_completed_turn_at: Option<DateTime<Utc>>,
    pub completion_state: CompletionState,
    pub source_state: CalendarSourceState,
    pub import_state: CalendarImportState,
    pub analysis_state: CalendarAnalysisState,
    pub imported_version_count: usize,
    pub snapshot_count: usize,
    pub latest_conversation_id: Option<String>,
    #[serde(default)]
    pub turn_count: Option<usize>,
    #[serde(default)]
    pub active_day_count: Option<usize>,
    #[serde(default)]
    pub time_coverage: Option<TimeCoverage>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub scan_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarConversationVersion {
    pub conversation_id: String,
    pub title: String,
    pub last_activity_at: Option<DateTime<Utc>>,
    pub analysis_state: CalendarAnalysisState,
    pub snapshot_count: usize,
    pub is_latest: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarQuery {
    pub start_date: String,
    pub end_date_exclusive: String,
    pub time_zone: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarIndexScanStatus {
    Ready,
    Partial,
    Failed,
}

impl CalendarIndexScanStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Partial => "partial",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexSessionKind {
    Primary,
    Internal,
    #[default]
    Unknown,
}

impl CodexSessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Internal => "internal",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionIndexRecord {
    pub session_id: String,
    pub canonical_path: String,
    pub title: String,
    pub last_activity_at: Option<DateTime<Utc>>,
    pub last_completed_turn_at: Option<DateTime<Utc>>,
    pub last_message_id: Option<String>,
    pub source_state: CalendarSourceState,
    pub source_file_size: u64,
    pub source_file_mtime_ns: i64,
    pub scan_status: CalendarIndexScanStatus,
    pub session_id_inferred: bool,
    #[serde(default)]
    pub session_kind: CodexSessionKind,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpan {
    pub message_id: String,
    pub start_utf16: usize,
    pub end_utf16: usize,
    pub exact_quote: String,
    pub sha256: String,
    #[serde(default)]
    pub model_saw_redacted: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Model,
    DeterministicFallback,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticUnit {
    pub id: String,
    pub turn_id: String,
    pub speaker: Speaker,
    pub label: String,
    pub acts: Vec<String>,
    pub importance: f32,
    pub provenance: Provenance,
    pub source_spans: Vec<SourceSpan>,
    pub primary: bool,
    pub operation_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub label: String,
    pub confidence: f32,
    pub evidence: Vec<SourceSpan>,
    #[serde(default)]
    pub user_created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub color: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModeMembership {
    pub id: String,
    pub mode_id: String,
    pub unit_id: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueSeverity {
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub stage: String,
    pub item_id: Option<String>,
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSnapshot {
    pub id: String,
    pub run_id: String,
    pub conversation_id: String,
    #[serde(default)]
    pub provider: AnalysisProviderKind,
    #[serde(default)]
    pub provider_version: Option<String>,
    #[serde(default)]
    pub credential_mode: Option<String>,
    pub model_id: String,
    pub prompt_version: String,
    pub schema_version: String,
    pub status: AnalysisState,
    pub semantic_units: Vec<SemanticUnit>,
    pub relations: Vec<Relation>,
    pub modes: Vec<Mode>,
    pub memberships: Vec<ModeMembership>,
    pub validation_issues: Vec<ValidationIssue>,
    /// Exact strict-JSON values returned by each model stage, before local filtering.
    #[serde(default)]
    pub raw_model_output: Value,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisState {
    Parsing,
    PrivacyReview,
    Queued,
    Segmenting,
    Linking,
    Modes,
    Validating,
    Ready,
    Partial,
    Failed,
    Cancelled,
}

impl AnalysisState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Parsing => "parsing",
            Self::PrivacyReview => "privacy_review",
            Self::Queued => "queued",
            Self::Segmenting => "segmenting",
            Self::Linking => "linking",
            Self::Modes => "modes",
            Self::Validating => "validating",
            Self::Ready => "ready",
            Self::Partial => "partial",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub run_id: String,
    pub conversation_id: String,
    pub stage: AnalysisState,
    pub progress: f32,
    pub completed: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionCommand {
    pub kind: String,
    pub target_id: String,
    pub after: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CorrectionEvent {
    pub id: String,
    pub snapshot_id: String,
    pub kind: String,
    pub target_id: String,
    pub before: Option<Value>,
    pub after: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeLayout {
    pub unit_id: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportState {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutState {
    pub nodes: Vec<NodeLayout>,
    pub viewport: ViewportState,
    #[serde(default = "default_true")]
    pub show_mode_islands: bool,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotBundle {
    pub conversation: ConversationSummary,
    pub base: AnalysisSnapshot,
    pub effective: AnalysisSnapshot,
    pub corrections: Vec<CorrectionEvent>,
    pub layout: Option<LayoutState>,
    pub messages: Vec<SourceMessage>,
    pub turns: Vec<VisibleTurn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStart {
    pub run_id: String,
    pub conversation_id: String,
    pub state: AnalysisState,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyStatus {
    pub ok: bool,
    pub configured: bool,
    pub valid: Option<bool>,
    pub model: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutItemInput {
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub pinned: bool,
}
