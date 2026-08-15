import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AnalysisProgress,
  AnalysisProvider,
  AnalysisProviderStatus,
  AnalysisSettings,
  AtlasSnapshot,
  CalendarEntry,
  CalendarConversationVersion,
  CalendarQuery,
  CodexIndexProgress,
  CodexIndexStatus,
  CredentialStoreKind,
  CorrectionCommand,
  DialogueAct,
  ImportPreview,
  ImportPreviewProgress,
  ImportPreviewReady,
  LayoutItem,
  ModeKind,
  PreviewMessage,
  PlatformCapabilities,
  PlatformKind,
  RelationType,
  SourceSpan,
} from "./domain";
import { DEFAULT_ANALYSIS_SETTINGS, DIALOGUE_ACTS, RELATION_TYPES } from "./domain";
import { B5_SNAPSHOT } from "./fixtures/b5";
import type {
  RelayPackageV1,
  ShareApprovals,
  ShareDraft,
  ShareReceipt,
} from "@dialogue-atlas/relay-contract";
import {
  DEMO_CALENDAR_ENTRIES,
  DEMO_UNDATED_CALENDAR_ENTRIES,
  demoImportPreview,
  queryDemoCalendar,
} from "./calendar/demoCalendar";

type CommandName =
  | "preview_codex_jsonl"
  | "preview_paste"
  | "list_conversations"
  | "commit_import"
  | "set_api_key"
  | "get_analysis_settings"
  | "set_analysis_provider"
  | "test_analysis_provider"
  | "start_analysis"
  | "cancel_analysis"
  | "retry_failed_stage"
  | "get_snapshot"
  | "apply_correction"
  | "reset_item_to_model"
  | "save_layout"
  | "start_codex_session_index"
  | "cancel_codex_session_index"
  | "get_codex_session_index_status"
  | "query_calendar_entries"
  | "list_undated_calendar_entries"
  | "get_calendar_entry"
  | "list_calendar_entry_versions"
  | "start_import_preview"
  | "cancel_import_preview"
  | "build_share_preview"
  | "finalize_share_package"
  | "record_share_receipt"
  | "list_share_publications";

export interface CommitImportOptions {
  previewId: string;
  title: string;
  messages: PreviewMessage[];
  redactionEnabled: boolean;
}

export interface CommitImportResponse {
  conversationId: string;
  alreadyImported: boolean;
}

export interface StartAnalysisOptions {
  conversationId: string;
  modelId: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  sourceKind: "codex_jsonl" | "paste";
  turnCount: number;
  characterCount: number;
  analyzeRedacted: boolean;
  createdAt: string;
  sourceFormat?: "raw_rollout" | "visible_export" | "paste" | "legacy_unknown";
  externalSessionId?: string;
  firstVisibleAt?: string;
  lastActivityAt?: string;
  lastCompletedTurnAt?: string;
  timeCoverage?: "complete" | "partial" | "none";
}

export interface BackendSourceSpan {
  messageId: string;
  startUtf16: number;
  endUtf16: number;
  exactQuote: string;
  sha256?: string;
  modelSawRedacted?: boolean;
}

export interface BackendSourceMessage {
  id: string;
  speaker: "user" | "assistant";
  phase?: string;
  text: string;
  redactedText?: string;
}

export interface BackendVisibleTurn {
  id: string;
  ordinal: number;
  speaker: "user" | "assistant";
  operationOnly: boolean;
  messageIds: string[];
}

export interface BackendAnalysisSnapshot {
  id: string;
  runId: string;
  conversationId: string;
  provider?: AnalysisProvider | "fixture";
  providerVersion?: string;
  credentialMode?: string;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  status: string;
  semanticUnits: Array<{
    id: string;
    turnId: string;
    speaker: "user" | "assistant";
    label: string;
    acts: string[];
    importance: number;
    provenance: "model" | "deterministic_fallback" | "user";
    sourceSpans: BackendSourceSpan[];
    primary: boolean;
    operationOnly: boolean;
  }>;
  relations: Array<{
    id: string;
    source: string;
    target: string;
    kind: string;
    label: string;
    confidence: number;
    evidence: BackendSourceSpan[];
    userCreated?: boolean;
  }>;
  modes: Array<{
    id: string;
    kind: string;
    label: string;
    color: string;
    confidence: number;
  }>;
  memberships: Array<{
    id: string;
    modeId: string;
    unitId: string;
    confidence: number;
  }>;
  validationIssues?: Array<{
    stage: string;
    itemId?: string;
    severity: "warning" | "error";
    message: string;
  }>;
  inputTokens?: number;
  outputTokens?: number;
  rawModelOutput?: unknown;
  createdAt: string;
}

export interface BackendSnapshotBundle {
  conversation: {
    id: string;
    title: string;
    sourceKind: "codex_jsonl" | "paste";
    turnCount: number;
    characterCount: number;
    analyzeRedacted: boolean;
    createdAt: string;
  };
  base: BackendAnalysisSnapshot;
  effective: BackendAnalysisSnapshot;
  corrections: unknown[];
  layout?: {
    nodes: Array<{ unitId: string; x: number; y: number; pinned?: boolean; collapsed?: boolean }>;
    viewport: { x: number; y: number; zoom: number };
    showModeIslands: boolean;
    updatedAt?: string;
  } | null;
  messages: BackendSourceMessage[];
  turns: BackendVisibleTurn[];
}

const relationAliases: Record<string, RelationType> = {
  response: "回应",
  supports: "支持",
  support: "支持",
  reason: "理由",
  example: "举例",
  condition: "条件",
  contrast: "对比",
  challenge: "质疑",
  counterevidence: "反证",
  narrow: "收窄",
  correction: "修正",
  reclassify: "重新归类",
  withdraw: "撤回",
  reopen: "重新打开",
  interrupted_continuation: "中断后续答",
  leads_to: "导致",
  unresolved: "未解决",
};

const modeKinds = new Set<ModeKind>([
  "目标定位",
  "探索",
  "方案形成",
  "证据核验",
  "质疑校正",
  "决定",
  "执行",
  "协调",
  "元对话",
  "未分类",
]);

const toSourceSpan = (value: BackendSourceSpan): SourceSpan => ({
  messageId: value.messageId,
  start: value.startUtf16,
  end: value.endUtf16,
  exactQuote: value.exactQuote,
  sha256: value.sha256,
  redacted: value.modelSawRedacted,
});

/**
 * Keeps backend persistence DTOs out of the rendering model. This is deliberately
 * explicit: Rust stores memberships separately and uses UTF-16 field names, while
 * the graph wants mode IDs on each unit and compact evidence pairs.
 */
export function snapshotBundleToAtlasSnapshot(bundle: BackendSnapshotBundle): AtlasSnapshot {
  const effective = bundle.effective;
  const turnById = new Map(bundle.turns.map((turn) => [turn.id, turn]));
  const messageById = new Map(bundle.messages.map((message) => [message.id, message]));
  const modeIdsByUnit = new Map<string, string[]>();
  for (const membership of effective.memberships) {
    const existing = modeIdsByUnit.get(membership.unitId) ?? [];
    existing.push(membership.modeId);
    modeIdsByUnit.set(membership.unitId, existing);
  }

  const units = effective.semanticUnits.map((unit) => {
    const turn = turnById.get(unit.turnId);
    const spans = unit.sourceSpans.map(toSourceSpan);
    const fullText = spans.map((item) => item.exactQuote).filter(Boolean).join(" … ") ||
      turn?.messageIds.map((id) => messageById.get(id)?.text ?? "").filter(Boolean).join("\n") ||
      unit.label;
    const acts = unit.acts.filter((act): act is DialogueAct =>
      DIALOGUE_ACTS.includes(act as DialogueAct),
    );
    return {
      id: unit.id,
      turnId: unit.turnId,
      turnOrdinal: turn ? turn.ordinal + 1 : 0,
      speaker: unit.speaker,
      kind: unit.operationOnly ? "operation" as const : unit.speaker === "user" ? "anchor" as const : "card" as const,
      label: unit.label,
      fullText,
      acts: acts.length ? acts : ["其他" as const],
      importance: unit.importance,
      provenance: unit.provenance === "user"
        ? "user" as const
        : unit.provenance === "deterministic_fallback"
          ? "fallback" as const
          : "model" as const,
      sourceSpans: spans,
      modeIds: modeIdsByUnit.get(unit.id) ?? [],
      secondary: !unit.primary,
    };
  });

  const relations = effective.relations.map((relation) => {
    const normalizedKind = RELATION_TYPES.includes(relation.kind as RelationType)
      ? relation.kind as RelationType
      : relationAliases[relation.kind.toLocaleLowerCase()] ?? "回应";
    const evidence = relation.evidence.map(toSourceSpan);
    const userEvidence = evidence.find((item) => messageById.get(item.messageId)?.speaker === "user");
    const assistantEvidence = evidence.find((item) => messageById.get(item.messageId)?.speaker === "assistant");
    return {
      id: relation.id,
      source: relation.source,
      target: relation.target,
      type: normalizedKind,
      label: relation.label || normalizedKind,
      confidence: relation.confidence,
      evidence: {
        title: `${relation.source} ↔ ${relation.target}`,
        user: userEvidence,
        assistant: assistantEvidence,
        context: evidence.map((item) => item.exactQuote).join("\n"),
      },
      provenance: relation.userCreated ? "user" as const : "model" as const,
    };
  });

  const primaryCount = units.filter((unit) => !unit.secondary).length;
  const layout = Object.fromEntries(
    (bundle.layout?.nodes ?? []).map((node) => [
      node.unitId,
      { x: node.x, y: node.y, pinned: node.pinned ?? false },
    ]),
  );

  return {
    id: effective.id,
    conversation: {
      id: effective.conversationId,
      title: bundle.conversation.title,
      turns: bundle.conversation.turnCount,
      totalUnits: units.length,
      expandedUnits: primaryCount,
      hiddenUnits: units.length - primaryCount,
      sourceKind: bundle.conversation.sourceKind,
    },
    units,
    relations,
    modes: effective.modes.map((mode) => ({
      id: mode.id,
      kind: modeKinds.has(mode.kind as ModeKind) ? mode.kind as ModeKind : "未分类",
      label: mode.label,
      color: mode.color,
      confidence: mode.confidence,
      inferred: true,
    })),
    layout,
    viewport: bundle.layout?.viewport,
    showModeIslands: bundle.layout?.showModeIslands ?? true,
    modelId: effective.modelId,
    provider: effective.provider,
    providerVersion: effective.providerVersion,
    credentialMode: effective.credentialMode,
    promptVersion: effective.promptVersion,
    schemaVersion: effective.schemaVersion,
    createdAt: effective.createdAt,
    status: effective.status === "partial" ? "partial" : "ready",
    validationIssues: effective.validationIssues ?? [],
    inputTokens: effective.inputTokens,
    outputTokens: effective.outputTokens,
    rawModelOutput: effective.rawModelOutput,
    sourceMessages: bundle.messages.map((message) => ({
      id: message.id,
      speaker: message.speaker,
      phase: message.phase,
      text: message.text,
    })),
    visibleTurns: bundle.turns.map((turn) => ({ ...turn, ordinal: turn.ordinal + 1 })),
  };
}

export interface DialogueAtlasIpc {
  readonly mode: "tauri" | "browser-demo";
  chooseJsonl(): Promise<string | null>;
  previewCodexJsonl(path: string): Promise<ImportPreview>;
  previewPaste(text: string): Promise<ImportPreview>;
  listConversations(): Promise<ConversationSummary[]>;
  commitImport(options: CommitImportOptions): Promise<CommitImportResponse>;
  getAnalysisSettings(): Promise<AnalysisSettings>;
  setAnalysisProvider(provider: AnalysisProvider): Promise<AnalysisSettings>;
  setApiKey(apiKey: string): Promise<void>;
  testAnalysisProvider(): Promise<AnalysisProviderStatus>;
  startAnalysis(options: StartAnalysisOptions): Promise<{ runId: string }>;
  cancelAnalysis(runId: string): Promise<boolean>;
  retryFailedStage(runId: string): Promise<{ runId: string }>;
  getSnapshot(conversationId: string): Promise<AtlasSnapshot>;
  applyCorrection(snapshotId: string, command: CorrectionCommand): Promise<void>;
  resetItemToModel(snapshotId: string, itemId: string): Promise<void>;
  saveLayout(
    snapshotId: string,
    layout: Record<string, LayoutItem>,
    viewport?: { x: number; y: number; zoom: number },
    showModeIslands?: boolean,
  ): Promise<void>;
  onAnalysisProgress(handler: (progress: AnalysisProgress) => void): Promise<UnlistenFn>;
  startCodexSessionIndex(): Promise<CodexIndexStatus>;
  cancelCodexSessionIndex(): Promise<boolean>;
  getCodexSessionIndexStatus(): Promise<CodexIndexStatus>;
  queryCalendarEntries(query: CalendarQuery): Promise<CalendarEntry[]>;
  listUndatedCalendarEntries(): Promise<CalendarEntry[]>;
  getCalendarEntry(entryId: string): Promise<CalendarEntry>;
  listCalendarEntryVersions(entryId: string): Promise<CalendarConversationVersion[]>;
  startImportPreview(entryId: string): Promise<{ previewId: string; preview?: ImportPreview }>;
  cancelImportPreview(previewId: string): Promise<boolean>;
  onCodexIndexProgress(handler: (progress: CodexIndexProgress) => void): Promise<UnlistenFn>;
  onImportPreviewProgress(handler: (progress: ImportPreviewProgress) => void): Promise<UnlistenFn>;
  onImportPreviewReady(handler: (ready: ImportPreviewReady) => void): Promise<UnlistenFn>;
  buildSharePreview(snapshotId: string): Promise<ShareDraft>;
  finalizeSharePackage(draftId: string, approvals: ShareApprovals): Promise<RelayPackageV1>;
  recordShareReceipt(receipt: ShareReceipt): Promise<ShareReceipt>;
  listSharePublications(snapshotId: string): Promise<ShareReceipt[]>;
}

const hasTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: CommandName, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export function ipcErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function normalizePreview(value: ImportPreview): ImportPreview {
  return {
    ...value,
    messages: value.messages.map((message, index) => ({
      ...message,
      turnOrdinal: message.turnOrdinal ?? index + 1,
    })),
    warnings: value.warnings ?? [],
    characterCount:
      value.characterCount ?? value.messages.reduce((sum, message) => sum + message.text.length, 0),
  };
}

const providerKinds = new Set<AnalysisProvider>(["codex_cli", "openai_api"]);
const platformKinds = new Set<PlatformKind>(["macos", "windows", "other"]);
const credentialStoreKinds = new Set<CredentialStoreKind>([
  "macos_keychain",
  "windows_credential_manager",
  "system_keyring",
]);

function safeCapabilities(): PlatformCapabilities {
  return structuredClone(DEFAULT_ANALYSIS_SETTINGS.capabilities);
}

export function normalizeAnalysisSettings(value: AnalysisSettings): AnalysisSettings {
  const raw = value?.capabilities;
  if (
    !raw
    || !platformKinds.has(raw.platform)
    || !credentialStoreKinds.has(raw.credentialStore)
    || !Array.isArray(raw.availableProviders)
  ) {
    return {
      ...DEFAULT_ANALYSIS_SETTINGS,
      ...value,
      provider: "openai_api",
      capabilities: safeCapabilities(),
    };
  }
  const availableProviders = [...new Set(
    raw.availableProviders.filter((provider): provider is AnalysisProvider => (
      providerKinds.has(provider)
      && (raw.platform === "macos" || provider === "openai_api")
    )),
  )];
  const provider = availableProviders.includes(value.provider)
    ? value.provider
    : availableProviders[0] ?? "openai_api";
  return {
    ...value,
    provider,
    capabilities: { ...raw, availableProviders },
  };
}

export function portableBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function browserPlatform(): PlatformKind {
  if (typeof navigator === "undefined") return "other";
  const identity = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLocaleLowerCase();
  if (identity.includes("win")) return "windows";
  if (identity.includes("mac")) return "macos";
  return "other";
}

function browserDemoSettings(): AnalysisSettings {
  const platform = browserPlatform();
  return {
    ...DEFAULT_ANALYSIS_SETTINGS,
    capabilities: {
      platform,
      availableProviders: platform === "macos" ? ["codex_cli", "openai_api"] : ["openai_api"],
      credentialStore: platform === "macos"
        ? "macos_keychain"
        : platform === "windows"
          ? "windows_credential_manager"
          : "system_keyring",
    },
  };
}

function splitPaste(text: string): PreviewMessage[] {
  const marker = /^(用户|User|GPT|Assistant|Codex)\s*[:：]\s*/gimu;
  const matches = [...text.matchAll(marker)];
  if (!matches.length) {
    return [
      {
        id: "paste-1",
        speaker: "user",
        turnOrdinal: 1,
        text: text.trim(),
      },
    ];
  }
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const role = match[1].toLowerCase();
    return {
      id: `paste-${index + 1}`,
      speaker: role === "用户" || role === "user" ? "user" : "assistant",
      turnOrdinal: index + 1,
      text: text.slice(start, end).trim(),
    };
  });
}

type LayoutSave = (
  snapshotId: string,
  layout: Record<string, LayoutItem>,
  viewport?: { x: number; y: number; zoom: number },
  showModeIslands?: boolean,
) => Promise<void>;

export function createSerializedLayoutSaver(save: LayoutSave): LayoutSave {
  const tails = new Map<string, Promise<void>>();
  return (snapshotId, layout, viewport, showModeIslands) => {
    const previous = tails.get(snapshotId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => save(snapshotId, layout, viewport, showModeIslands));
    tails.set(snapshotId, current);
    const clear = () => {
      if (tails.get(snapshotId) === current) tails.delete(snapshotId);
    };
    void current.then(clear, clear);
    return current;
  };
}

class TauriAdapter implements DialogueAtlasIpc {
  readonly mode = "tauri" as const;
  private readonly saveLayoutInOrder = createSerializedLayoutSaver(
    async (snapshotId, layout, viewport, showModeIslands) => {
      await call("save_layout", { snapshotId, layout, viewport, showModeIslands });
    },
  );

  async chooseJsonl() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Codex rollout", extensions: ["jsonl"] }],
    });
    return typeof selected === "string" ? selected : null;
  }

  async previewCodexJsonl(path: string) {
    return normalizePreview(await call<ImportPreview>("preview_codex_jsonl", { path }));
  }

  async previewPaste(text: string) {
    return normalizePreview(await call<ImportPreview>("preview_paste", { text }));
  }

  listConversations() {
    return call<ConversationSummary[]>("list_conversations");
  }

  commitImport(options: CommitImportOptions) {
    return call<CommitImportResponse>("commit_import", { options });
  }

  getAnalysisSettings() {
    return call<AnalysisSettings>("get_analysis_settings").then(normalizeAnalysisSettings);
  }

  setAnalysisProvider(provider: AnalysisProvider) {
    return call<AnalysisSettings>("set_analysis_provider", { provider }).then(normalizeAnalysisSettings);
  }

  async setApiKey(apiKey: string) {
    await call("set_api_key", { apiKey });
  }

  testAnalysisProvider() {
    return call<AnalysisProviderStatus>("test_analysis_provider");
  }

  startAnalysis(options: StartAnalysisOptions) {
    return call<{ runId: string }>("start_analysis", { options });
  }

  cancelAnalysis(runId: string) {
    return call<boolean>("cancel_analysis", { runId });
  }

  retryFailedStage(runId: string) {
    return call<{ runId: string }>("retry_failed_stage", { runId });
  }

  getSnapshot(conversationId: string) {
    return call<BackendSnapshotBundle>("get_snapshot", { conversationId }).then(
      snapshotBundleToAtlasSnapshot,
    );
  }

  async applyCorrection(snapshotId: string, command: CorrectionCommand) {
    await call("apply_correction", { snapshotId, command });
  }

  async resetItemToModel(snapshotId: string, itemId: string) {
    await call("reset_item_to_model", { snapshotId, itemId });
  }

  async saveLayout(
    snapshotId: string,
    layout: Record<string, LayoutItem>,
    viewport?: { x: number; y: number; zoom: number },
    showModeIslands?: boolean,
  ) {
    await this.saveLayoutInOrder(snapshotId, layout, viewport, showModeIslands);
  }

  onAnalysisProgress(handler: (progress: AnalysisProgress) => void) {
    return listen<AnalysisProgress>("analysis_progress", (event) => handler(event.payload));
  }

  startCodexSessionIndex() {
    return call<CodexIndexStatus>("start_codex_session_index");
  }

  cancelCodexSessionIndex() {
    return call<boolean>("cancel_codex_session_index");
  }

  getCodexSessionIndexStatus() {
    return call<CodexIndexStatus>("get_codex_session_index_status");
  }

  queryCalendarEntries(query: CalendarQuery) {
    return call<CalendarEntry[]>("query_calendar_entries", { query });
  }

  listUndatedCalendarEntries() {
    return call<CalendarEntry[]>("list_undated_calendar_entries");
  }

  getCalendarEntry(entryId: string) {
    return call<CalendarEntry>("get_calendar_entry", { entryId });
  }

  listCalendarEntryVersions(entryId: string) {
    return call<CalendarConversationVersion[]>("list_calendar_entry_versions", { entryId });
  }

  startImportPreview(entryId: string) {
    return call<{ previewId: string; preview?: ImportPreview }>("start_import_preview", { entryId });
  }

  cancelImportPreview(previewId: string) {
    return call<boolean>("cancel_import_preview", { previewId });
  }

  onCodexIndexProgress(handler: (progress: CodexIndexProgress) => void) {
    return listen<CodexIndexProgress>("codex_index_progress", (event) => handler(event.payload));
  }

  onImportPreviewProgress(handler: (progress: ImportPreviewProgress) => void) {
    return listen<ImportPreviewProgress>("import_preview_progress", (event) => handler(event.payload));
  }

  onImportPreviewReady(handler: (ready: ImportPreviewReady) => void) {
    return listen<ImportPreviewReady>("import_preview_ready", (event) => handler(event.payload));
  }

  buildSharePreview(snapshotId: string) {
    return call<ShareDraft>("build_share_preview", { snapshotId });
  }

  finalizeSharePackage(draftId: string, approvals: ShareApprovals) {
    return call<RelayPackageV1>("finalize_share_package", { draftId, approvals });
  }

  recordShareReceipt(receipt: ShareReceipt) {
    return call<ShareReceipt>("record_share_receipt", { receipt });
  }

  listSharePublications(snapshotId: string) {
    return call<ShareReceipt[]>("list_share_publications", { snapshotId });
  }
}

class BrowserDemoAdapter implements DialogueAtlasIpc {
  readonly mode = "browser-demo" as const;
  private progressHandlers = new Set<(progress: AnalysisProgress) => void>();
  private analysisSettings = browserDemoSettings();

  async chooseJsonl() {
    return null;
  }

  async previewCodexJsonl(path: string) {
    return {
      id: `preview-${Date.now()}`,
      title: portableBasename(path).replace(/\.jsonl$/i, "") || "Codex 对话",
      sourceKind: "codex_jsonl" as const,
      sourcePath: path,
      messages: [],
      characterCount: 0,
      warnings: ["浏览器演示不能直接读取本地路径；请使用粘贴导入，或在 Tauri 桌面应用中打开。"],
    };
  }

  async previewPaste(text: string) {
    const messages = splitPaste(text);
    return {
      id: `preview-${Date.now()}`,
      title: "粘贴的对话",
      sourceKind: "paste" as const,
      messages,
      characterCount: messages.reduce((sum, message) => sum + message.text.length, 0),
      warnings: messages.length === 1 ? ["只识别到一段文本；提交前请确认说话者。"] : [],
    };
  }

  async listConversations() {
    return [];
  }

  async commitImport(_options: CommitImportOptions): Promise<CommitImportResponse> {
    throw new Error("浏览器页面只用于查看固定 B5 示例；请在桌面应用中分析导入内容。");
  }

  async getAnalysisSettings() {
    return structuredClone(this.analysisSettings);
  }

  async setAnalysisProvider(provider: AnalysisProvider) {
    if (!this.analysisSettings.capabilities.availableProviders.includes(provider)) {
      throw new Error("当前平台不支持所选分析来源");
    }
    this.analysisSettings = { ...this.analysisSettings, provider };
    return structuredClone(this.analysisSettings);
  }

  async setApiKey() {
    throw new Error("浏览器演示不会读取或保存 API key；请使用桌面应用的系统凭据库。");
  }

  async testAnalysisProvider(): Promise<AnalysisProviderStatus> {
    const model = this.analysisSettings.provider === "codex_cli"
      ? this.analysisSettings.codexCliModel
      : this.analysisSettings.defaultOpenaiModel;
    return {
      provider: this.analysisSettings.provider,
      ok: false,
      configured: false,
      available: false,
      authenticated: false,
      model,
      message: "浏览器演示不会调用 Codex CLI 或 OpenAI API；请使用桌面应用检测分析来源。",
    };
  }

  async startAnalysis(_options: StartAnalysisOptions): Promise<{ runId: string }> {
    throw new Error("浏览器演示不会启动模型分析；请使用桌面应用。");
  }

  async cancelAnalysis() { return false; }
  async retryFailedStage(): Promise<{ runId: string }> {
    throw new Error("浏览器演示不会重试模型分析；请使用桌面应用。");
  }

  async getSnapshot() {
    return structuredClone(B5_SNAPSHOT);
  }

  async applyCorrection() {}
  async resetItemToModel() {}
  async saveLayout() {}

  async onAnalysisProgress(handler: (progress: AnalysisProgress) => void) {
    this.progressHandlers.add(handler);
    return () => this.progressHandlers.delete(handler);
  }

  async startCodexSessionIndex(): Promise<CodexIndexStatus> {
    return {
      running: false,
      stage: "ready",
      completed: DEMO_CALENDAR_ENTRIES.length,
      total: DEMO_CALENDAR_ENTRIES.length,
      visibleSessions: DEMO_CALENDAR_ENTRIES.length,
      skippedSessions: 0,
      message: "演示索引已就绪；未读取本机文件",
      lastCompletedAt: "2026-08-12T06:50:00.000Z",
    };
  }

  async cancelCodexSessionIndex() { return false; }

  async getCodexSessionIndexStatus(): Promise<CodexIndexStatus> {
    return this.startCodexSessionIndex();
  }

  async queryCalendarEntries(query: CalendarQuery) {
    return queryDemoCalendar(query);
  }

  async listUndatedCalendarEntries() {
    return structuredClone(DEMO_UNDATED_CALENDAR_ENTRIES);
  }

  async getCalendarEntry(entryId: string) {
    const entry = [...DEMO_CALENDAR_ENTRIES, ...DEMO_UNDATED_CALENDAR_ENTRIES]
      .find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error("找不到演示会话");
    return structuredClone(entry);
  }

  async listCalendarEntryVersions(entryId: string): Promise<CalendarConversationVersion[]> {
    const entry = await this.getCalendarEntry(entryId);
    if (!entry.latestConversationId || entry.importedVersionCount === 0) return [];
    return Array.from({ length: entry.importedVersionCount }, (_, index) => ({
      conversationId: index === 0 ? entry.latestConversationId! : `${entry.latestConversationId}-history-${index}`,
      title: entry.title,
      lastActivityAt: entry.lastActivityAt,
      analysisState: index === 0 ? entry.analysisState : "ready",
      snapshotCount: index === 0 ? entry.snapshotCount : 1,
      isLatest: index === 0,
      createdAt: entry.lastActivityAt ?? "2026-08-12T00:00:00.000Z",
    }));
  }

  async startImportPreview(entryId: string) {
    const preview = demoImportPreview(entryId);
    return { previewId: preview.id, preview };
  }

  async cancelImportPreview() { return false; }

  async onCodexIndexProgress() { return () => undefined; }
  async onImportPreviewProgress() { return () => undefined; }
  async onImportPreviewReady() { return () => undefined; }

  async buildSharePreview(): Promise<ShareDraft> {
    throw new Error("固定浏览器示例不能发布；请从 macOS 桌面应用打开已分析的真实对话。");
  }

  async finalizeSharePackage(): Promise<RelayPackageV1> {
    throw new Error("固定浏览器示例不能生成公开协作包。");
  }

  async recordShareReceipt(): Promise<ShareReceipt> {
    throw new Error("固定浏览器示例不能记录发布回执。");
  }

  async listSharePublications(): Promise<ShareReceipt[]> { return []; }
}

export const atlasIpc: DialogueAtlasIpc = hasTauri()
  ? new TauriAdapter()
  : new BrowserDemoAdapter();
