import type { XYPosition } from "@xyflow/react";

export type Speaker = "user" | "assistant" | "system";
export type NodeKind = "anchor" | "card" | "operation" | "unresolved";

export type DialogueAct =
  | "提问"
  | "请求"
  | "任务"
  | "建议"
  | "陈述"
  | "回答"
  | "解释"
  | "论证"
  | "举例"
  | "评价"
  | "同意"
  | "质疑"
  | "纠正"
  | "承诺"
  | "反馈"
  | "话语管理"
  | "约束"
  | "假设检验"
  | "证据"
  | "区分"
  | "归类"
  | "反例"
  | "限定"
  | "撤回"
  | "其他";

export type RelationType =
  | "回应"
  | "支持"
  | "理由"
  | "举例"
  | "条件"
  | "对比"
  | "质疑"
  | "反证"
  | "收窄"
  | "修正"
  | "重新归类"
  | "撤回"
  | "重新打开"
  | "中断后续答"
  | "导致"
  | "未解决";

export type ModeKind =
  | "目标定位"
  | "探索"
  | "方案形成"
  | "证据核验"
  | "质疑校正"
  | "决定"
  | "执行"
  | "协调"
  | "元对话"
  | "未分类";

export interface SourceSpan {
  messageId: string;
  start: number;
  end: number;
  exactQuote: string;
  sha256?: string;
  redacted?: boolean;
}

export interface EvidencePair {
  title?: string;
  user?: SourceSpan;
  assistant?: SourceSpan;
  context?: string;
}

export interface SemanticUnit {
  id: string;
  turnId: string;
  turnOrdinal: number;
  segmentOrdinal?: number;
  speaker: Speaker;
  kind: NodeKind;
  label: string;
  fullText: string;
  acts: DialogueAct[];
  importance: number;
  provenance: "model" | "fallback" | "user" | "fixture";
  sourceSpans: SourceSpan[];
  modeIds: string[];
  secondary?: boolean;
  state?: "active" | "downgraded" | "withdrawn" | "open";
}

export interface AtlasRelation {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label?: string;
  confidence: number;
  evidence: EvidencePair;
  provenance: "model" | "user" | "fixture";
}

export interface ModeDefinition {
  id: string;
  kind: ModeKind;
  label: string;
  color: string;
  confidence: number;
  inferred: boolean;
}

export interface LayoutItem extends XYPosition {
  pinned?: boolean;
}

export interface ConversationMeta {
  id: string;
  title: string;
  turns: number;
  totalUnits: number;
  expandedUnits: number;
  hiddenUnits: number;
  sourceKind: "codex_jsonl" | "paste" | "demo";
  sourcePath?: string;
}

export interface ValidationIssue {
  stage: string;
  itemId?: string;
  severity: "warning" | "error";
  message: string;
}

export interface AtlasSnapshot {
  id: string;
  conversation: ConversationMeta;
  units: SemanticUnit[];
  relations: AtlasRelation[];
  modes: ModeDefinition[];
  layout: Record<string, LayoutItem>;
  viewport?: { x: number; y: number; zoom: number };
  showModeIslands?: boolean;
  modelId: string;
  provider?: AnalysisProvider | "fixture";
  providerVersion?: string;
  credentialMode?: string;
  promptVersion: string;
  schemaVersion: string;
  createdAt: string;
  status?: "ready" | "partial";
  validationIssues?: ValidationIssue[];
  inputTokens?: number;
  outputTokens?: number;
  rawModelOutput?: unknown;
  sourceMessages?: Array<{
    id: string;
    speaker: "user" | "assistant";
    phase?: string;
    text: string;
  }>;
  visibleTurns?: Array<{
    id: string;
    ordinal: number;
    speaker: "user" | "assistant";
    operationOnly: boolean;
    messageIds: string[];
  }>;
}

export interface PreviewMessage {
  id: string;
  speaker: Speaker;
  phase?: "commentary" | "final";
  turnOrdinal: number;
  text: string;
  operationOnly?: boolean;
  redactions?: Array<{ start: number; end: number; replacement: string; kind: string }>;
}

export interface ImportPreview {
  id: string;
  title: string;
  sourceKind: "codex_jsonl" | "paste";
  sourcePath?: string;
  messages: PreviewMessage[];
  characterCount: number;
  warnings: string[];
  sourceFormat?: SourceFormat;
  externalSessionId?: string;
  firstVisibleAt?: string;
  lastActivityAt?: string;
  lastCompletedTurnAt?: string;
  timeCoverage?: TimeCoverage;
  sourceStillWriting?: boolean;
}

export type TimeStatus = "valid" | "missing" | "invalid";
export type TimeCoverage = "complete" | "partial" | "none";
export type SourceFormat = "raw_rollout" | "visible_export" | "paste" | "legacy_unknown";

export type CalendarCompletionState = "completed" | "in_progress_or_unknown" | "undated";
export type CalendarSourceState = "active" | "archived" | "missing" | "import_only";
export type CalendarImportState = "not_imported" | "imported_current" | "source_updated";
export type CalendarAnalysisState = "none" | "ready" | "partial" | "failed";

export interface CalendarEntry {
  id: string;
  externalSessionId?: string;
  title: string;
  lastActivityAt?: string;
  lastCompletedTurnAt?: string;
  completionState: CalendarCompletionState;
  sourceState: CalendarSourceState;
  importState: CalendarImportState;
  analysisState: CalendarAnalysisState;
  importedVersionCount: number;
  snapshotCount: number;
  latestConversationId?: string;
  turnCount?: number;
  activeDayCount?: number;
  timeCoverage?: TimeCoverage;
  sourcePath?: string;
  scanWarning?: string;
}

export interface CalendarConversationVersion {
  conversationId: string;
  title: string;
  lastActivityAt?: string;
  analysisState: CalendarAnalysisState;
  snapshotCount: number;
  isLatest: boolean;
  createdAt: string;
}

export interface CalendarQuery {
  startDate: string;
  endDateExclusive: string;
  timeZone: "Asia/Tokyo";
}

export interface CodexIndexProgress {
  stage: "idle" | "discovering" | "scanning" | "committing" | "ready" | "cancelled" | "failed";
  completed: number;
  total: number;
  message: string;
  visibleSessions?: number;
  skippedSessions?: number;
}

export interface CodexIndexStatus extends CodexIndexProgress {
  running: boolean;
  lastCompletedAt?: string;
}

export interface ImportPreviewProgress {
  previewId: string;
  completedBytes: number;
  totalBytes: number;
  message: string;
}

export interface ImportPreviewReady {
  previewId: string;
  preview?: ImportPreview;
  error?: string;
}

export type AnalysisStage =
  | "idle"
  | "parsing"
  | "privacy_review"
  | "segmenting"
  | "linking"
  | "modes"
  | "validating"
  | "ready"
  | "partial"
  | "failed"
  | "cancelled";

export interface AnalysisProgress {
  runId: string;
  conversationId: string;
  stage: AnalysisStage;
  completed: number;
  total: number;
  message: string;
}

export type AnalysisTaskStatus = "running" | "stopping" | "ready" | "partial" | "failed" | "cancelled";

export interface AnalysisTask {
  runId: string;
  conversationId: string;
  originEntryId?: string;
  title?: string;
  status: AnalysisTaskStatus;
  progress: AnalysisProgress;
  startedAt: string;
  updatedAt: string;
}

export type AnalysisProvider = "codex_cli" | "openai_api";

export type PlatformKind = "macos" | "windows" | "other";

export type CredentialStoreKind =
  | "macos_keychain"
  | "windows_credential_manager"
  | "system_keyring";

export interface PlatformCapabilities {
  platform: PlatformKind;
  availableProviders: AnalysisProvider[];
  credentialStore: CredentialStoreKind;
}

export interface AnalysisSettings {
  provider: AnalysisProvider;
  defaultOpenaiModel: string;
  codexCliModel: string;
  capabilities: PlatformCapabilities;
}

export interface AnalysisProviderStatus {
  provider: AnalysisProvider;
  ok: boolean;
  configured: boolean;
  available: boolean;
  authenticated: boolean;
  model: string;
  version?: string;
  message: string;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  provider: "openai_api",
  defaultOpenaiModel: "gpt-5-mini",
  codexCliModel: "gpt-5.6-luna",
  // Loading starts fail-closed: the desktop backend replaces this with its
  // authoritative platform capability set before exposing any extra provider.
  capabilities: {
    platform: "other",
    availableProviders: ["openai_api"],
    credentialStore: "system_keyring",
  },
};

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

export type CorrectionCommand =
  | { kind: "update_unit"; unitId: string; label: string; acts: DialogueAct[]; modeIds: string[] }
  | { kind: "update_relation"; relationId: string; type: RelationType; label?: string }
  | { kind: "add_relation"; relation: AtlasRelation }
  | { kind: "delete_relation"; relationId: string }
  | { kind: "update_mode"; modeId: string; label: string }
  | { kind: "move_node"; unitId: string; position: XYPosition; pinned: boolean };

export const DIALOGUE_ACTS: DialogueAct[] = [
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

export const RELATION_TYPES: RelationType[] = [
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

export const RELATION_COLORS: Record<RelationType, string> = {
  回应: "#1773eb",
  支持: "#168f78",
  理由: "#0a9a93",
  举例: "#3191b7",
  条件: "#4d932f",
  对比: "#7e52c8",
  质疑: "#7c4fd0",
  反证: "#ef3e3e",
  收窄: "#774dd0",
  修正: "#774dd0",
  重新归类: "#7546d6",
  撤回: "#c9202b",
  重新打开: "#f13f3f",
  中断后续答: "#1773eb",
  导致: "#118986",
  未解决: "#667085",
};

export const MAX_VISIBLE_GRAPH_NODES = 120;
