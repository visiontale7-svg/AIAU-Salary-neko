import { useEffect } from "react";
import { AppHeader } from "./components/AppHeader";
import { AtlasCanvas } from "./components/AtlasCanvas";
import { Drawers } from "./components/Drawers";
import { EvidenceInspector } from "./components/EvidenceInspector";
import { CorrectionDialog, ImportDialog, SettingsDialog } from "./components/Modals";
import { SideRail } from "./components/SideRail";
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

  useEffect(() => {
    let active = true;
    void atlasIpc.getAnalysisSettings().then((settings) => {
      if (active) setAnalysisSettings(settings);
    }).catch((error) => {
      if (active) setToast(`无法读取分析来源：${ipcErrorMessage(error, "未知错误")}`);
    });
    if (atlasIpc.mode !== "tauri") return () => { active = false; };
    void atlasIpc.listConversations().then(async (conversations) => {
      for (const conversation of conversations) {
        try {
          const snapshot = await atlasIpc.getSnapshot(conversation.id);
          if (active) setSnapshot(snapshot);
          return;
        } catch {
          // A committed import may not have a snapshot yet; try the next completed one.
        }
      }
      if (active && conversations.length) {
        setToast("发现尚未完成分析的本地导入；请检查当前分析来源后重新导入或分析");
      }
    }).catch((error) => {
      if (active) setToast(`无法读取本地会话：${ipcErrorMessage(error, "未知错误")}`);
    });
    return () => { active = false; };
  }, [setAnalysisSettings, setSnapshot, setToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="搜索原文"]')?.focus();
      }
      if (event.key === "Escape") {
        setSearch("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSearch]);

  return (
    <div className="atlas-app">
      <SideRail />
      <AppHeader />
      <main className="atlas-main">
        <AtlasCanvas />
        <EvidenceInspector />
        <Drawers />
      </main>

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
