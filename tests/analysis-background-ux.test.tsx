import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisProgress } from "../src/domain";

const ipcMock = vi.hoisted(() => ({
  mode: "tauri" as const,
  onAnalysisProgress: vi.fn(),
  cancelAnalysis: vi.fn(),
  getSnapshot: vi.fn(),
  testAnalysisProvider: vi.fn(),
  commitImport: vi.fn(),
  startAnalysis: vi.fn(),
}));

vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return { ...actual, atlasIpc: ipcMock };
});

import { AnalysisProgressDialog } from "../src/components/AnalysisProgressDialog";
import { AnalysisProgressListener } from "../src/components/AnalysisProgressListener";
import { CalendarImportPreviewDialog } from "../src/calendar/CalendarImportPreviewDialog";
import { DEFAULT_ANALYSIS_SETTINGS } from "../src/domain";
import { useAtlasStore } from "../src/store";

beforeEach(() => {
  vi.clearAllMocks();
  useAtlasStore.setState({
    analysisSettings: { ...DEFAULT_ANALYSIS_SETTINGS },
    analysisTasks: {},
    focusedAnalysisRunId: null,
    progress: null,
    primaryView: "calendar",
    toast: null,
  });
  ipcMock.cancelAnalysis.mockResolvedValue(true);
  ipcMock.testAnalysisProvider.mockResolvedValue({
    provider: "openai_api",
    ok: true,
    configured: true,
    available: true,
    authenticated: true,
    model: "gpt-5-mini",
    message: "ready",
  });
  ipcMock.commitImport.mockResolvedValue({ conversationId: "conversation-1", alreadyImported: false });
});

afterEach(() => cleanup());

describe("non-blocking analysis UX", () => {
  it("lets the preview close while start is pending and keeps the resulting task in the background", async () => {
    let resolveStart!: (value: { runId: string }) => void;
    ipcMock.startAnalysis.mockReturnValue(new Promise((resolve) => { resolveStart = resolve; }));
    const close = vi.fn();
    render(<CalendarImportPreviewDialog
      entry={{
        id: "entry-1",
        title: "Relay 设计对话",
        completionState: "undated",
        sourceState: "active",
        importState: "not_imported",
        analysisState: "none",
        importedVersionCount: 0,
        snapshotCount: 0,
      }}
      initialPreview={{
        id: "preview-1",
        title: "Relay 设计对话",
        sourceKind: "codex_jsonl",
        sourceFormat: "raw_rollout",
        messages: [{ id: "message-1", speaker: "user", turnOrdinal: 1, text: "把私人对话变成团队共创" }],
        characterCount: 14,
        warnings: [],
        timeCoverage: "none",
      }}
      close={close}
      refreshCalendar={() => undefined}
    />);

    fireEvent.click(screen.getByRole("button", { name: "导入并分析" }));
    await screen.findByRole("button", { name: "在后台继续" });
    fireEvent.click(screen.getByRole("button", { name: "在后台继续" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(ipcMock.cancelAnalysis).not.toHaveBeenCalled();

    resolveStart({ runId: "run-1" });
    await waitFor(() => expect(useAtlasStore.getState().analysisTasks["run-1"]).toMatchObject({
      conversationId: "conversation-1",
      originEntryId: "entry-1",
      status: "running",
    }));
    expect(useAtlasStore.getState().focusedAnalysisRunId).toBeNull();
  });

  it("keeps progress after the initiating UI closes and never auto-navigates on completion", async () => {
    let handler: ((progress: AnalysisProgress) => void) | undefined;
    ipcMock.onAnalysisProgress.mockImplementation(async (next: (progress: AnalysisProgress) => void) => {
      handler = next;
      return () => undefined;
    });
    const refresh = vi.fn();
    useAtlasStore.getState().registerAnalysisTask({ runId: "run-2", conversationId: "conversation-2", title: "后台任务" });
    render(<AnalysisProgressListener refreshCalendar={refresh} />);
    await waitFor(() => expect(ipcMock.onAnalysisProgress).toHaveBeenCalledTimes(1));

    handler?.({ runId: "run-2", conversationId: "conversation-2", stage: "segmenting", completed: 3, total: 7, message: "正在拆分" });
    expect(useAtlasStore.getState().analysisTasks["run-2"].progress.completed).toBe(3);
    handler?.({ runId: "run-2", conversationId: "conversation-2", stage: "ready", completed: 7, total: 7, message: "完成" });

    expect(useAtlasStore.getState().analysisTasks["run-2"].status).toBe("ready");
    expect(useAtlasStore.getState().primaryView).toBe("calendar");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useAtlasStore.getState().toast).toContain("后台分析完成");
  });

  it("closing progress does not cancel, while the explicit stop action cancels the exact run", async () => {
    useAtlasStore.getState().registerAnalysisTask({ runId: "run-3", conversationId: "conversation-3", title: "可关闭任务" });
    useAtlasStore.getState().focusAnalysisTask("run-3");
    const view = render(<AnalysisProgressDialog />);

    fireEvent.click(screen.getByRole("button", { name: "在后台继续" }));
    expect(ipcMock.cancelAnalysis).not.toHaveBeenCalled();
    expect(useAtlasStore.getState().focusedAnalysisRunId).toBeNull();

    useAtlasStore.getState().focusAnalysisTask("run-3");
    view.rerender(<AnalysisProgressDialog />);
    fireEvent.click(screen.getByRole("button", { name: "停止分析" }));
    await waitFor(() => expect(ipcMock.cancelAnalysis).toHaveBeenCalledWith("run-3"));
    expect(useAtlasStore.getState().analysisTasks["run-3"].status).toBe("stopping");
    expect(screen.getByRole("button", { name: "停止中…" })).toBeDisabled();
  });
});
