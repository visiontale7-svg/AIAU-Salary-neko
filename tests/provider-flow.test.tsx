import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisProgress,
  AnalysisProvider,
  AnalysisProviderStatus,
  AnalysisSettings,
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
}));

vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return { ...actual, atlasIpc: ipcMock };
});

import { ImportDialog, SettingsDialog } from "../src/components/Modals";
import { useAtlasStore } from "../src/store";

const settingsFor = (provider: AnalysisProvider): AnalysisSettings => ({
  provider,
  defaultOpenaiModel: "gpt-5-mini",
  codexCliModel: "gpt-5.6-luna",
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
  ipcMock.commitImport.mockResolvedValue({ conversationId: "conversation-provider-test" });
  ipcMock.onAnalysisProgress.mockResolvedValue(() => undefined);
  ipcMock.startAnalysis.mockResolvedValue({ runId: "run-provider-test" });
  ipcMock.setApiKey.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("analysis provider settings", () => {
  it("presents ChatGPT Codex usage and credit disclosure separately from the Keychain API option", async () => {
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
      return { conversationId: "conversation-provider-test" };
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
