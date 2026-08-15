import { useCallback, useEffect, useRef } from "react";
import { AppHeader } from "./components/AppHeader";
import { AtlasCanvas } from "./components/AtlasCanvas";
import { Drawers } from "./components/Drawers";
import { EvidenceInspector } from "./components/EvidenceInspector";
import { CorrectionDialog, ImportDialog, SettingsDialog } from "./components/Modals";
import { SideRail } from "./components/SideRail";
import { CalendarHeader } from "./calendar/CalendarHeader";
import { CalendarView } from "./calendar/CalendarView";
import { calendarQueryFor } from "./calendar/calendarUtils";
import { atlasIpc, ipcErrorMessage } from "./ipc";
import { useAtlasStore } from "./store";

export function App() {
  const toast = useAtlasStore((state) => state.toast);
  const showImport = useAtlasStore((state) => state.showImport);
  const showSettings = useAtlasStore((state) => state.showSettings);
  const showCorrection = useAtlasStore((state) => state.showCorrection);
  const progress = useAtlasStore((state) => state.progress);
  const setProgress = useAtlasStore((state) => state.setProgress);
  const setAnalysisSettings = useAtlasStore((state) => state.setAnalysisSettings);
  const setSearch = useAtlasStore((state) => state.setSearch);
  const setSnapshot = useAtlasStore((state) => state.setSnapshot);
  const setToast = useAtlasStore((state) => state.setToast);
  const primaryView = useAtlasStore((state) => state.primaryView);
  const calendarMode = useAtlasStore((state) => state.calendarMode);
  const calendarAnchorDate = useAtlasStore((state) => state.calendarAnchorDate);
  const setCalendarEntries = useAtlasStore((state) => state.setCalendarEntries);
  const setUndatedCalendarEntries = useAtlasStore((state) => state.setUndatedCalendarEntries);
  const setCalendarLoading = useAtlasStore((state) => state.setCalendarLoading);
  const setCodexIndexStatus = useAtlasStore((state) => state.setCodexIndexStatus);
  const settings = useAtlasStore((state) => state.analysisSettings);
  const startupIndexStarted = useRef(false);
  const atlasLoaded = useRef(false);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const [entries, undated] = await Promise.all([
        atlasIpc.queryCalendarEntries(calendarQueryFor(calendarAnchorDate, calendarMode)),
        atlasIpc.listUndatedCalendarEntries(),
      ]);
      setCalendarEntries(entries);
      setUndatedCalendarEntries(undated);
    } catch (error) {
      setToast(`无法读取对话日历：${ipcErrorMessage(error, "未知错误")}`);
    } finally {
      setCalendarLoading(false);
    }
  }, [calendarAnchorDate, calendarMode, setCalendarEntries, setCalendarLoading, setToast, setUndatedCalendarEntries]);

  const refreshIndex = useCallback(async () => {
    if (atlasIpc.mode !== "tauri" || settings.capabilities.platform !== "macos") return;
    setCalendarLoading(true);
    try {
      const status = await atlasIpc.startCodexSessionIndex();
      setCodexIndexStatus(status);
      if (!status.running) await loadCalendar();
    } catch (error) {
      setToast(`本机会话索引未更新：${ipcErrorMessage(error, "旧缓存仍可使用")}`);
    } finally {
      setCalendarLoading(false);
    }
  }, [loadCalendar, setCalendarLoading, setCodexIndexStatus, setToast, settings.capabilities.platform]);

  const cancelIndex = useCallback(async () => {
    try {
      const accepted = await atlasIpc.cancelCodexSessionIndex();
      if (accepted) {
        const current = useAtlasStore.getState().codexIndexStatus;
        if (current) setCodexIndexStatus({ ...current, message: "正在停止本地索引…" });
      } else {
        setToast("本地索引已经结束，无需取消");
      }
    } catch (error) {
      setToast(`无法取消本地索引：${ipcErrorMessage(error, "未知错误")}`);
    }
  }, [setCodexIndexStatus, setToast]);

  useEffect(() => {
    let active = true;
    void atlasIpc.getAnalysisSettings().then((settings) => {
      if (active) setAnalysisSettings(settings);
    }).catch((error) => {
      if (active) setToast(`无法读取分析来源：${ipcErrorMessage(error, "未知错误")}`);
    });
    return () => { active = false; };
  }, [setAnalysisSettings, setToast]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    if (atlasIpc.mode !== "tauri" || settings.capabilities.platform !== "macos" || startupIndexStarted.current) return;
    startupIndexStarted.current = true;
    void refreshIndex();
  }, [refreshIndex, settings.capabilities.platform]);

  useEffect(() => {
    if (atlasIpc.mode !== "tauri") return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void atlasIpc.onCodexIndexProgress((next) => {
      if (!active) return;
      const running = !["ready", "cancelled", "failed"].includes(next.stage);
      setCodexIndexStatus({ ...next, running });
      if (next.stage === "failed") setToast(next.message);
      if (!running) void loadCalendar();
    }).then((value) => { unlisten = value; });
    return () => { active = false; unlisten?.(); };
  }, [loadCalendar, setCodexIndexStatus]);

  useEffect(() => {
    if (primaryView !== "atlas" || atlasIpc.mode !== "tauri" || atlasLoaded.current) return;
    if (useAtlasStore.getState().snapshot.conversation.sourceKind !== "demo") {
      atlasLoaded.current = true;
      return;
    }
    atlasLoaded.current = true;
    let active = true;
    void atlasIpc.listConversations().then(async (conversations) => {
      for (const conversation of conversations) {
        try {
          const snapshot = await atlasIpc.getSnapshot(conversation.id);
          if (active) setSnapshot(snapshot);
          return;
        } catch {
          // A committed import may not have a snapshot yet; try the next one.
        }
      }
    }).catch((error) => {
      if (active) setToast(`无法读取本地会话：${ipcErrorMessage(error, "未知错误")}`);
    });
    return () => { active = false; };
  }, [primaryView, setSnapshot, setToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if (primaryView === "atlas" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="搜索原文"]')?.focus();
      }
      if (event.key === "Escape") {
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [primaryView, setSearch]);

  return (
    <div className="atlas-app">
      <SideRail />
      {primaryView === "calendar" ? <CalendarHeader refresh={() => void refreshIndex()} cancel={() => void cancelIndex()} /> : <AppHeader />}
      {primaryView === "calendar" ? <CalendarView refreshCalendar={() => void loadCalendar()} /> : (
        <main className="atlas-main">
          <AtlasCanvas />
          <EvidenceInspector />
          <Drawers />
        </main>
      )}

      {progress && !["ready", "partial", "failed", "cancelled"].includes(progress.stage) ? (
        <div className="analysis-status panel-shadow" role="status" aria-live="polite">
          <span className="analysis-spinner" />
          <div>
            <strong>{progress.message}</strong>
            <span>{progress.completed} / {progress.total} · {progress.stage}</span>
          </div>
          <progress value={progress.completed} max={Math.max(progress.total, 1)} />
          <button type="button" disabled={progress.message.startsWith("正在停止")} onClick={() => {
            void atlasIpc.cancelAnalysis(progress.runId).then((accepted) => {
              if (accepted) {
                setProgress({ ...progress, message: "正在停止本地任务；已发出的远程请求仍可能产生用量" });
              } else {
                setToast("当前分析任务已经结束，无法再取消");
              }
            }).catch((error) => {
              setToast(`无法请求取消：${ipcErrorMessage(error, "未知错误")}`);
            });
          }}>{progress.message.startsWith("正在停止") ? "停止中…" : "停止"}</button>
        </div>
      ) : null}

      {showImport ? <ImportDialog /> : null}
      {showSettings ? <SettingsDialog /> : null}
      {showCorrection ? <CorrectionDialog /> : null}
      {toast ? <div className="toast panel-shadow" role="status">{toast}</div> : null}
    </div>
  );
}
