import type { B5Fixture } from "../helpers/fixtures";
import type { BackendSnapshotBundle } from "../../src/ipc";
import type { AnalysisProvider, AnalysisSettings, PlatformCapabilities } from "../../src/domain";
import { DEFAULT_ANALYSIS_SETTINGS } from "../../src/domain";

type InvokeArgs = Record<string, unknown> | undefined;

export interface TauriMockState {
  snapshot: B5Fixture;
  calls: Array<{ command: string; args: InvokeArgs }>;
  layoutSaves: Array<InvokeArgs>;
  correctionSaves: Array<InvokeArgs>;
  analysisSettings: AnalysisSettings;
}

export type MockSnapshotBundle = BackendSnapshotBundle;

export function createBackendSnapshotBundle(fixture: B5Fixture): MockSnapshotBundle {
  const turnById = new Map(fixture.turns.map((turn) => [turn.id, turn]));
  const unitById = new Map(fixture.semantic_units.map((unit) => [unit.id, unit]));
  const toSpan = (unitId: string) => {
    const unit = unitById.get(unitId);
    const sourceSpan = unit?.source_spans[0];
    const turn = unit ? turnById.get(unit.turn_id) : undefined;
    if (!unit || !sourceSpan || !turn) return undefined;
    const startUtf16 = turn.source_text.indexOf(sourceSpan.exact_quote);
    return {
      messageId: sourceSpan.message_id,
      startUtf16,
      endUtf16: startUtf16 + sourceSpan.exact_quote.length,
      exactQuote: sourceSpan.exact_quote,
      modelSawRedacted: false,
    };
  };
  const semanticUnits = fixture.semantic_units.map((unit) => ({
    id: unit.id,
    turnId: unit.turn_id,
    speaker: unit.speaker,
    label: unit.short_label,
    acts: unit.acts,
    importance: unit.importance,
    provenance: "model" as const,
    sourceSpans: [toSpan(unit.id)!],
    primary: unit.level === "primary",
    operationOnly: unit.node_role === "operation",
  }));
  const effective = {
    id: fixture.fixture_id,
    runId: fixture.analysis_run.model_id,
    conversationId: fixture.conversation.id,
    provider: fixture.analysis_run.provider,
    providerVersion: fixture.analysis_run.provider_version,
    credentialMode: fixture.analysis_run.credential_mode,
    modelId: fixture.analysis_run.model_id,
    promptVersion: "b5-fixture-v1",
    schemaVersion: fixture.schema_version,
    status: fixture.analysis_run.status,
    semanticUnits,
    relations: fixture.relations.map((relation) => {
      const evidence = relation.evidence_unit_ids.map(toSpan).filter((span) => span !== undefined);
      return {
        id: relation.id,
        source: relation.source,
        target: relation.target,
        kind: relation.type,
        label: relation.type,
        confidence: relation.confidence,
        evidence,
        userCreated: false,
      };
    }),
    modes: fixture.modes.map((mode) => ({
      id: mode.id,
      kind:
        ({
          goal_framing: "目标定位",
          evidence_checking: "证据核验",
          proposal_forming: "方案形成",
          exploration: "探索",
          challenge_correction: "质疑校正",
        } as Record<string, string>)[mode.kind] ?? "未分类",
      label: mode.display_label,
      color: mode.color,
      confidence: 0.9,
    })),
    memberships: fixture.mode_memberships.map((membership, index) => ({
      id: `membership-${index + 1}`,
      modeId: membership.mode_id,
      unitId: membership.unit_id,
      confidence: membership.confidence,
    })),
    createdAt: "2026-08-06T12:00:00.000Z",
  };

  return {
    conversation: {
      id: fixture.conversation.id,
      title: fixture.conversation.title,
      sourceKind: "codex_jsonl",
      turnCount: fixture.conversation.turn_count,
      characterCount: fixture.turns.reduce((sum, turn) => sum + turn.source_text.length, 0),
      analyzeRedacted: true,
      createdAt: "2026-08-06T12:00:00.000Z",
    },
    base: structuredClone(effective),
    effective,
    corrections: [],
    layout: {
      nodes: Object.entries(fixture.layout.positions).map(([unitId, position]) => ({
        unitId,
        x: position.x,
        y: position.y,
        pinned: position.pinned,
        collapsed: false,
      })),
      viewport: { x: 0, y: 0, zoom: 0.78 },
      showModeIslands: true,
      updatedAt: "2026-08-06T12:00:00.000Z",
    },
    messages: fixture.turns.map((turn) => ({
      id: turn.message_id,
      speaker: turn.speaker,
      text: turn.source_text,
      redactedText: turn.source_text,
    })),
    turns: fixture.turns.map((turn) => ({
      id: turn.id,
      ordinal: turn.ordinal - 1,
      speaker: turn.speaker,
      operationOnly: turn.kind === "operation",
      messageIds: [turn.message_id],
    })),
  };
}

export function createTauriInvokeMock(
  initialSnapshot: B5Fixture,
  capabilities: PlatformCapabilities = DEFAULT_ANALYSIS_SETTINGS.capabilities,
) {
  const state: TauriMockState = {
    snapshot: structuredClone(initialSnapshot),
    calls: [],
    layoutSaves: [],
    correctionSaves: [],
    analysisSettings: {
      ...DEFAULT_ANALYSIS_SETTINGS,
      capabilities: structuredClone(capabilities),
    },
  };

  const invoke = async <T>(command: string, args?: InvokeArgs): Promise<T> => {
    state.calls.push({ command, args });

    switch (command) {
      case "get_analysis_settings":
        return structuredClone(state.analysisSettings) as T;
      case "set_analysis_provider": {
        const provider = args?.provider;
        if (provider !== "codex_cli" && provider !== "openai_api") {
          throw new Error("set_analysis_provider requires { provider }");
        }
        if (!state.analysisSettings.capabilities.availableProviders.includes(provider)) {
          throw new Error(`analysis provider ${provider} is unavailable on ${state.analysisSettings.capabilities.platform}`);
        }
        state.analysisSettings = {
          ...state.analysisSettings,
          provider: provider as AnalysisProvider,
        };
        return structuredClone(state.analysisSettings) as T;
      }
      case "test_analysis_provider": {
        const isCodex = state.analysisSettings.provider === "codex_cli";
        return {
          provider: state.analysisSettings.provider,
          ok: isCodex,
          configured: isCodex,
          available: isCodex,
          authenticated: isCodex,
          model: isCodex
            ? state.analysisSettings.codexCliModel
            : state.analysisSettings.defaultOpenaiModel,
          version: isCodex ? "fixture-0.0.0" : undefined,
          message: isCodex
            ? "Fixture Codex CLI is ready; no process was started."
            : "Fixture OpenAI credentials are unavailable; no request was sent.",
        } as T;
      }
      case "get_snapshot":
        return createBackendSnapshotBundle(state.snapshot) as T;
      case "save_layout":
        if (typeof args?.snapshotId !== "string" || !args.layout || typeof args.layout !== "object") {
          throw new Error("save_layout requires { snapshotId, layout }");
        }
        state.layoutSaves.push(structuredClone(args));
        return undefined as T;
      case "apply_correction":
        if (typeof args?.snapshotId !== "string" || !args.command || typeof args.command !== "object") {
          throw new Error("apply_correction requires { snapshotId, command }");
        }
        state.correctionSaves.push(structuredClone(args));
        return { ok: true, correction_id: `fixture-correction-${state.correctionSaves.length}` } as T;
      case "reset_item_to_model":
        return { ok: true } as T;
      case "start_analysis": {
        const options = args?.options as Record<string, unknown> | undefined;
        if (
          typeof options?.conversationId !== "string"
          || typeof options.modelId !== "string"
          || "provider" in options
        ) {
          throw new Error("start_analysis requires { options: { conversationId, modelId } }");
        }
        return { runId: "fixture-run-no-network" } as T;
      }
      case "cancel_analysis":
        return { ok: true } as T;
      case "set_api_key":
      case "test_api_key":
        throw new Error("Network and credential commands are intentionally disabled in fixtures");
      default:
        throw new Error(`Unexpected Tauri command in test: ${command}`);
    }
  };

  return { invoke, state };
}
