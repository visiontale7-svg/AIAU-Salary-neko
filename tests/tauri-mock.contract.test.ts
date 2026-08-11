import { describe, expect, it } from "vitest";
import { normalizeAnalysisSettings, portableBasename, snapshotBundleToAtlasSnapshot } from "../src/ipc";
import { loadB5Fixture } from "./helpers/fixtures";
import {
  createBackendSnapshotBundle,
  createTauriInvokeMock,
  type MockSnapshotBundle,
} from "./mocks/tauri";

describe("mocked Tauri IPC", () => {
  it("serves a local snapshot and records reversible writes without a network call", async () => {
    const { invoke, state } = createTauriInvokeMock(loadB5Fixture());

    const snapshot = await invoke<MockSnapshotBundle>("get_snapshot", {
      conversationId: "conv-b5",
    });
    expect(snapshot.effective.id).toBe("b5-real-dialogue-v1");
    expect(snapshot.effective.semanticUnits).toHaveLength(41);
    expect(snapshot.layout?.nodes).toHaveLength(30);
    expect(snapshot.turns).toHaveLength(15);

    await invoke("save_layout", {
      snapshotId: snapshot.effective.id,
      layout: { U08: { x: 900, y: 1400, pinned: true } },
    });
    await invoke("apply_correction", {
      snapshotId: snapshot.effective.id,
      command: {
        kind: "update_unit",
        unitId: "U08",
        label: "每项判断都要先主动证伪",
        acts: ["任务"],
        modeIds: ["M01"],
      },
    });

    expect(state.layoutSaves).toHaveLength(1);
    expect(state.correctionSaves).toHaveLength(1);
    expect(state.calls.map((call) => call.command)).toEqual([
      "get_snapshot",
      "save_layout",
      "apply_correction",
    ]);
  });

  it("fails loudly if a test attempts credentials or a real model request", async () => {
    const { invoke } = createTauriInvokeMock(loadB5Fixture());
    await expect(invoke("test_api_key")).rejects.toThrow("intentionally disabled");
  });

  it("persists a provider, tests the saved provider, and starts with only its returned model", async () => {
    const { invoke, state } = createTauriInvokeMock(loadB5Fixture(), {
      platform: "macos",
      availableProviders: ["codex_cli", "openai_api"],
      credentialStore: "macos_keychain",
    });

    await expect(invoke("get_analysis_settings")).resolves.toEqual({
      provider: "openai_api",
      defaultOpenaiModel: "gpt-5-mini",
      codexCliModel: "gpt-5.6-luna",
      capabilities: {
        platform: "macos",
        availableProviders: ["codex_cli", "openai_api"],
        credentialStore: "macos_keychain",
      },
    });
    await expect(invoke("set_analysis_provider", { provider: "codex_cli" })).resolves.toMatchObject({
      provider: "codex_cli",
    });
    const status = await invoke<{
      provider: string;
      ok: boolean;
      model: string;
      authenticated: boolean;
    }>("test_analysis_provider");
    expect(status).toMatchObject({
      provider: "codex_cli",
      ok: true,
      authenticated: true,
      model: "gpt-5.6-luna",
    });
    await expect(invoke("start_analysis", {
      options: { conversationId: "conv-b5", modelId: status.model },
    })).resolves.toEqual({ runId: "fixture-run-no-network" });

    expect(state.calls.map((call) => call.command)).toEqual([
      "get_analysis_settings",
      "set_analysis_provider",
      "test_analysis_provider",
      "start_analysis",
    ]);
    expect(state.calls.at(-1)?.args).toEqual({
      options: { conversationId: "conv-b5", modelId: "gpt-5.6-luna" },
    });
  });

  it("rejects a raw Codex provider write when Windows capabilities expose only OpenAI", async () => {
    const { invoke, state } = createTauriInvokeMock(loadB5Fixture(), {
      platform: "windows",
      availableProviders: ["openai_api"],
      credentialStore: "windows_credential_manager",
    });

    await expect(invoke("set_analysis_provider", { provider: "codex_cli" })).rejects.toThrow(
      "unavailable on windows",
    );
    expect(state.analysisSettings.provider).toBe("openai_api");
  });

  it("fails safe for a legacy capability-less response and handles Windows basenames", () => {
    const normalized = normalizeAnalysisSettings({
      provider: "codex_cli",
      defaultOpenaiModel: "gpt-5-mini",
      codexCliModel: "gpt-5.6-luna",
    } as never);

    expect(normalized).toMatchObject({
      provider: "openai_api",
      capabilities: {
        platform: "other",
        availableProviders: ["openai_api"],
        credentialStore: "system_keyring",
      },
    });
    expect(portableBasename("C:\\Users\\Ada\\conversation.jsonl")).toBe("conversation.jsonl");
    expect(portableBasename("/Users/ada/conversation.jsonl")).toBe("conversation.jsonl");
  });

  it("strips an impossible Codex capability from a Windows backend response", () => {
    const normalized = normalizeAnalysisSettings({
      provider: "codex_cli",
      defaultOpenaiModel: "gpt-5-mini",
      codexCliModel: "gpt-5.6-luna",
      capabilities: {
        platform: "windows",
        availableProviders: ["codex_cli", "openai_api"],
        credentialStore: "windows_credential_manager",
      },
    });

    expect(normalized.provider).toBe("openai_api");
    expect(normalized.capabilities.availableProviders).toEqual(["openai_api"]);
  });

  it("maps the Rust SnapshotBundle DTO into the graph model without losing evidence", () => {
    const bundle = createBackendSnapshotBundle(loadB5Fixture());
    const mapped = snapshotBundleToAtlasSnapshot(bundle);

    expect(mapped.conversation).toMatchObject({
      title: "TRACE 研究目标：主动证伪与连续收窄",
      sourceKind: "codex_jsonl",
      turns: 15,
      totalUnits: 41,
      expandedUnits: 29,
      hiddenUnits: 12,
    });
    expect(mapped.units.find((unit) => unit.id === "U06")).toMatchObject({
      kind: "operation",
      modeIds: [],
      turnOrdinal: 10,
    });
    expect(mapped.units.find((unit) => unit.id === "G01")?.modeIds).toEqual(
      expect.arrayContaining(["M01", "M02"]),
    );
    expect(mapped.relations.find((relation) => relation.id === "R23")?.evidence).toMatchObject({
      user: expect.objectContaining({ exactQuote: "每句话都要先主动证伪" }),
      assistant: expect.objectContaining({
        exactQuote: "独立人工 gold＋team-held-out 仍待验证",
      }),
    });
    expect(mapped.layout.U08).toMatchObject({ x: 760, y: 1390, pinned: true });
    expect(mapped.viewport).toEqual({ x: 0, y: 0, zoom: 0.78 });
    expect(mapped.showModeIslands).toBe(true);
    expect(mapped).toMatchObject({
      provider: "fixture",
      providerVersion: "fixture-no-model-call",
      credentialMode: "none",
    });
    expect(mapped.sourceMessages).toHaveLength(15);
  });
});
