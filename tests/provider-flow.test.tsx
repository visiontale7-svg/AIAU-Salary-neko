import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisProgress,
  AnalysisProvider,
  AnalysisProviderStatus,
  AnalysisSettings,
  PlatformCapabilities,
} from "../src/domain";

const ipcMock = vi.hoisted(() => ({
  mode: "tauri" as const,
  chooseJsonl: vi.fn(),
  previewCodexJsonl: vi.fn(),
  previewPaste: vi.fn(),
  listConversations: vi.fn(),
  commitImport: vi.fn(),
  getAnalysisSettings: vi.fn(),
  setAnalysisProvider: vi.fn(),
  setApiKey: vi.fn(),
  testAnalysisProvider: vi.fn(),
  startAnalysis: vi.fn(),
  cancelAnalysis: vi.fn(),
  retryFailedStage: vi.fn(),
  getSnapshot: vi.fn(),
  applyCorrection: vi.fn(),
  resetItemToModel: vi.fn(),
  saveLayout: vi.fn(),
  onAnalysisProgress: vi.fn(),
  listCalendarEntryVersions: vi.fn(),
  onImportPreviewProgress: vi.fn(),
  onImportPreviewReady: vi.fn(),
}));

vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return { ...actual, atlasIpc: ipcMock };
});

import { ImportDialog, SettingsDialog } from "../src/components/Modals";
import { CalendarImportPreviewDialog } from "../src/calendar/CalendarImportPreviewDialog";
import { CalendarView } from "../src/calendar/CalendarView";
import { useAtlasStore } from "../src/store";

const macCapabilities: PlatformCapabilities = {
  platform: "macos",
  availableProviders: ["codex_cli", "openai_api"],
  credentialStore: "macos_keychain",
};

const windowsCapabilities: PlatformCapabilities = {
  platform: "windows",
  availableProviders: ["openai_api"],
  credentialStore: "windows_credential_manager",
};

const settingsFor = (
  provider: AnalysisProvider,
  capabilities: PlatformCapabilities = macCapabilities,
): AnalysisSettings => ({
  provider,
  defaultOpenaiModel: "gpt-5-mini",
  codexCliModel: "gpt-5.6-luna",
  capabilities: structuredClone(capabilities),
});

const statusFor = (provider: AnalysisProvider, ok = true): AnalysisProviderStatus => ({
  provider,
  ok,
  configured: ok,
  available: ok,
  authenticated: ok,
  model: provider === "codex_cli" ? "gpt-5.6-luna" : "gpt-5-mini",
  version: provider === "codex_cli" ? "0.145.0-fixture" : undefined,
  message: ok ? `${provider} fixture ready` : `${provider} fixture unavailable`,
});

const preview = {
  id: "preview-provider-test",
  title: "Provider flow",
  sourceKind: "paste" as const,
  messages: [
    { id: "m1", speaker: "user" as const, turnOrdinal: 1, text: "问题" },
    { id: "m2", speaker: "assistant" as const, turnOrdinal: 2, text: "回答" },
  ],
  characterCount: 4,
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useAtlasStore.setState({
    analysisSettings: settingsFor("openai_api"),
    showImport: true,
    showSettings: true,
    progress: null,
    toast: null,
  });
  ipcMock.previewPaste.mockResolvedValue(preview);
  ipcMock.commitImport.mockResolvedValue({
    conversationId: "conversation-provider-test",
    alreadyImported: false,
  });
  ipcMock.onAnalysisProgress.mockResolvedValue(() => undefined);
  ipcMock.listCalendarEntryVersions.mockResolvedValue([]);
  ipcMock.onImportPreviewProgress.mockResolvedValue(() => undefined);
  ipcMock.onImportPreviewReady.mockResolvedValue(() => undefined);
  ipcMock.startAnalysis.mockResolvedValue({ runId: "run-provider-test" });
  ipcMock.setApiKey.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("analysis provider settings", () => {
  it("keeps the existing macOS Codex and OpenAI choices with Keychain-specific disclosure", async () => {
    const order: string[] = [];
    ipcMock.setAnalysisProvider.mockImplementation(async (provider: AnalysisProvider) => {
      order.push(`set:${provider}`);
      return settingsFor(provider);
    });
    ipcMock.testAnalysisProvider.mockImplementation(async () => {
      order.push("test");
      return statusFor("codex_cli");
    });

    render(<SettingsDialog />);

    expect(screen.getByRole("radio", { name: /OpenAI API/ })).toBeChecked();
    expect(screen.getByLabelText("OpenAI API key")).toBeVisible();
    expect(screen.getByText(/API key 保存在macOS Keychain/)).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /Codex via ChatGPT/ }));

    expect(screen.queryByLabelText("OpenAI API key")).not.toBeInTheDocument();
    expect(screen.getByText(/先消耗套餐内 Codex 用量/)).toBeVisible();
    expect(screen.getAllByText(/auto top-up/).length).toBeGreaterThan(0);
    expect(screen.getByText(/本次费用/)).toBeVisible();
    expect(screen.getByText(/远程 Codex 请求/)).toBeVisible();
    expect(screen.getByText(/不会读取、复制或保存登录令牌/)).toBeVisible();
    expect(screen.getByText(/codex login/)).toBeVisible();
    expect(screen.getByText(/只确认 CLI 兼容且当前为 ChatGPT 登录/)).toHaveTextContent("不发送模型请求、不产生用量");

    fireEvent.click(screen.getByRole("button", { name: "保存并检测登录" }));
    await screen.findByText("codex_cli fixture ready");

    expect(order).toEqual(["set:codex_cli", "test"]);
    expect(ipcMock.setApiKey).not.toHaveBeenCalled();
    expect(useAtlasStore.getState().analysisSettings.provider).toBe("codex_cli");
  });

  it("shows only OpenAI and Windows Credential Manager when Windows rejects a stale Codex choice", () => {
    useAtlasStore.setState({ analysisSettings: settingsFor("codex_cli", windowsCapabilities) });

    render(<SettingsDialog />);

    expect(screen.queryByRole("radio", { name: /Codex via ChatGPT/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /OpenAI API/ })).toBeChecked();
    expect(screen.getByText(/API key 保存在Windows 凭据管理器/)).toBeVisible();
    expect(screen.getByText("Windows 版当前通过 OpenAI API 进行分析。")).toBeVisible();
  });

  it("stores a supplied API key before saving and testing the OpenAI provider", async () => {
    useAtlasStore.setState({ analysisSettings: settingsFor("codex_cli") });
    const order: string[] = [];
    ipcMock.setApiKey.mockImplementation(async () => { order.push("key"); });
    ipcMock.setAnalysisProvider.mockImplementation(async (provider: AnalysisProvider) => {
      order.push(`set:${provider}`);
      return settingsFor(provider);
    });
    ipcMock.testAnalysisProvider.mockImplementation(async () => {
      order.push("test");
      return statusFor("openai_api");
    });

    render(<SettingsDialog />);
    fireEvent.click(screen.getByRole("radio", { name: /OpenAI API/ }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value: "sk-fixture-only" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));

    await screen.findByText("openai_api fixture ready");
    expect(order).toEqual(["key", "set:openai_api", "test"]);
    expect(ipcMock.setApiKey).toHaveBeenCalledWith("sk-fixture-only");
  });
});

describe("import provider preflight", () => {
  it("refreshes the calendar as soon as a source version is committed and again on analysis failure", async () => {
    ipcMock.testAnalysisProvider.mockResolvedValue(statusFor("openai_api"));
    let progressHandler: ((progress: AnalysisProgress) => void) | undefined;
    ipcMock.onAnalysisProgress.mockImplementation(async (
      handler: (progress: AnalysisProgress) => void,
    ) => {
      progressHandler = handler;
      return () => undefined;
    });
    const refreshCalendar = vi.fn();
    render(
      <CalendarImportPreviewDialog
        entry={{
          id: "session-1",
          externalSessionId: "session-1",
          title: "日历导入",
          completionState: "undated",
          sourceState: "active",
          importState: "not_imported",
          analysisState: "none",
          importedVersionCount: 0,
          snapshotCount: 0,
        }}
        initialPreview={{ ...preview, sourceFormat: "raw_rollout", timeCoverage: "none" }}
        close={() => undefined}
        refreshCalendar={refreshCalendar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导入并分析" }));
    await waitFor(() => expect(ipcMock.startAnalysis).toHaveBeenCalledTimes(1));
    expect(refreshCalendar).toHaveBeenCalledTimes(1);
    await act(async () => {
      progressHandler?.({
        conversationId: "another-conversation",
        runId: "another-run",
        stage: "failed",
        completed: 1,
        total: 6,
        message: "unrelated analysis failed",
      });
    });
    expect(refreshCalendar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/unrelated analysis failed/)).not.toBeInTheDocument();
    await act(async () => {
      progressHandler?.({
        conversationId: "conversation-provider-test",
        runId: "run-provider-test",
        stage: "failed",
        completed: 1,
        total: 6,
        message: "fixture analysis failed",
      });
    });
    expect(refreshCalendar).toHaveBeenCalledTimes(2);
  });

  it("ignores another conversation's progress while reanalyzing a calendar entry", async () => {
    ipcMock.testAnalysisProvider.mockResolvedValue(statusFor("openai_api"));
    ipcMock.getSnapshot.mockResolvedValue(structuredClone(useAtlasStore.getState().snapshot));
    let progressHandler: ((progress: AnalysisProgress) => void) | undefined;
    ipcMock.onAnalysisProgress.mockImplementation(async (
      handler: (progress: AnalysisProgress) => void,
    ) => {
      progressHandler = handler;
      return () => undefined;
    });
    useAtlasStore.setState({
      primaryView: "calendar",
      calendarMode: "month",
      calendarAnchorDate: "2026-08-12",
      calendarEntries: [{
        id: "session-retry",
        externalSessionId: "session-retry",
        title: "需要重新分析",
        lastActivityAt: "2026-08-12T06:20:00.000Z",
        lastCompletedTurnAt: "2026-08-12T06:20:00.000Z",
        completionState: "completed",
        sourceState: "active",
        importState: "imported_current",
        analysisState: "failed",
        importedVersionCount: 1,
        snapshotCount: 0,
        latestConversationId: "conversation-retry",
      }],
      undatedCalendarEntries: [],
      selectedCalendarEntryId: null,
      selectedCalendarDate: null,
    });

    render(<CalendarView refreshCalendar={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /需要重新分析/ }));
    fireEvent.click(screen.getByRole("button", { name: "重新分析" }));
    await waitFor(() => expect(ipcMock.startAnalysis).toHaveBeenCalledTimes(1));

    await act(async () => {
      progressHandler?.({
        conversationId: "another-conversation",
        runId: "another-run",
        stage: "ready",
        completed: 6,
        total: 6,
        message: "unrelated ready",
      });
    });
    expect(ipcMock.getSnapshot).not.toHaveBeenCalled();
    expect(useAtlasStore.getState().primaryView).toBe("calendar");

    await act(async () => {
      progressHandler?.({
        conversationId: "conversation-retry",
        runId: "run-provider-test",
        stage: "ready",
        completed: 6,
        total: 6,
        message: "target ready",
      });
    });
    await waitFor(() => expect(ipcMock.getSnapshot).toHaveBeenCalledWith("conversation-retry"));
    expect(useAtlasStore.getState().primaryView).toBe("atlas");
  });

  it.each([
    ["codex_cli", "gpt-5.6-luna"],
    ["openai_api", "gpt-5-mini"],
  ] as const)("tests the saved %s provider before committing and starts with its returned model", async (provider, model) => {
    useAtlasStore.setState({ analysisSettings: settingsFor(provider) });
    const order: string[] = [];
    ipcMock.testAnalysisProvider.mockImplementation(async () => {
      order.push("test");
      return statusFor(provider);
    });
    ipcMock.commitImport.mockImplementation(async () => {
      order.push("commit");
      return { conversationId: "conversation-provider-test", alreadyImported: false };
    });
    ipcMock.onAnalysisProgress.mockImplementation(async () => {
      order.push("listen");
      return () => undefined;
    });
    ipcMock.startAnalysis.mockImplementation(async () => {
      order.push("start");
      return { runId: "run-provider-test" };
    });

    render(<ImportDialog />);
    fireEvent.change(screen.getByLabelText(/使用“用户/), {
      target: { value: "用户：问题\nGPT：回答" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览轮次" }));
    await screen.findByText(/2 条可见消息/);
    fireEvent.click(screen.getByRole("button", { name: "确认并分析" }));

    await waitFor(() => expect(ipcMock.startAnalysis).toHaveBeenCalled());
    expect(order).toEqual(["test", "commit", "listen", "start"]);
    expect(ipcMock.testAnalysisProvider).toHaveBeenCalledWith();
    expect(ipcMock.startAnalysis).toHaveBeenCalledWith({
      conversationId: "conversation-provider-test",
      modelId: model,
    });
  });

  it("does not commit or start when the saved provider is unavailable", async () => {
    useAtlasStore.setState({ analysisSettings: settingsFor("codex_cli") });
    ipcMock.testAnalysisProvider.mockResolvedValue(statusFor("codex_cli", false));

    render(<ImportDialog />);
    fireEvent.change(screen.getByLabelText(/使用“用户/), {
      target: { value: "用户：问题\nGPT：回答" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览轮次" }));
    await screen.findByText(/2 条可见消息/);
    fireEvent.click(screen.getByRole("button", { name: "确认并分析" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("codex_cli fixture unavailable");
    expect(ipcMock.commitImport).not.toHaveBeenCalled();
    expect(ipcMock.startAnalysis).not.toHaveBeenCalled();
  });

  it("previews without an API key and gives an actionable setup hint before analysis", async () => {
    useAtlasStore.setState({ analysisSettings: settingsFor("openai_api", windowsCapabilities) });
    ipcMock.testAnalysisProvider.mockResolvedValue({
      ...statusFor("openai_api", false),
      message: "尚未配置 OpenAI API key",
    });

    render(<ImportDialog />);
    fireEvent.change(screen.getByLabelText(/使用“用户/), {
      target: { value: "用户：问题\nGPT：回答" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览轮次" }));

    await screen.findByText(/2 条可见消息/);
    expect(screen.getByText(/预览不需要 API key/)).toHaveTextContent("Windows 凭据管理器");
    expect(ipcMock.testAnalysisProvider).not.toHaveBeenCalled();
    expect(ipcMock.commitImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认并分析" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请打开右上角“设置”");
    expect(screen.getByRole("alert")).toHaveTextContent("Windows 凭据管理器");
    expect(ipcMock.commitImport).not.toHaveBeenCalled();
    expect(ipcMock.startAnalysis).not.toHaveBeenCalled();
  });

  it("rechecks the saved provider before retrying an already committed conversation", async () => {
    useAtlasStore.setState({ analysisSettings: settingsFor("codex_cli") });
    let progressHandler: ((progress: AnalysisProgress) => void) | undefined;
    ipcMock.testAnalysisProvider.mockResolvedValue(statusFor("codex_cli"));
    ipcMock.onAnalysisProgress.mockImplementation(async (
      handler: (progress: AnalysisProgress) => void,
    ) => {
      progressHandler = handler;
      return () => undefined;
    });

    render(<ImportDialog />);
    fireEvent.change(screen.getByLabelText(/使用“用户/), {
      target: { value: "用户：问题\nGPT：回答" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览轮次" }));
    await screen.findByText(/2 条可见消息/);
    fireEvent.click(screen.getByRole("button", { name: "确认并分析" }));
    await waitFor(() => expect(ipcMock.startAnalysis).toHaveBeenCalledTimes(1));

    await act(async () => {
      progressHandler?.({
        conversationId: "another-conversation",
        runId: "another-run",
        stage: "ready",
        completed: 6,
        total: 6,
        message: "unrelated ready",
      });
    });
    expect(ipcMock.getSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByText(/unrelated ready/)).not.toBeInTheDocument();

    await act(async () => {
      progressHandler?.({
        conversationId: "conversation-provider-test",
        runId: "run-provider-test",
        stage: "failed",
        completed: 1,
        total: 6,
        message: "fixture analysis failed",
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "重新分析（当前来源）" }));
    await waitFor(() => expect(ipcMock.startAnalysis).toHaveBeenCalledTimes(2));

    expect(ipcMock.testAnalysisProvider).toHaveBeenCalledTimes(2);
    expect(ipcMock.commitImport).toHaveBeenCalledTimes(1);
  });
});
