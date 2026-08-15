import { useEffect, useRef, useState } from "react";
import { atlasIpc, ipcErrorMessage } from "../ipc";
import { useAtlasStore } from "../store";
import { CloseIcon } from "./icons";

const stageLabel: Record<string, string> = {
  parsing: "准备分析",
  privacy_review: "确认隐私副本",
  segmenting: "拆分发言与识别意图",
  linking: "判断逻辑关系",
  modes: "生成模式叠层",
  validating: "核对逐字证据",
  ready: "分析完成",
  partial: "部分分析完成",
  failed: "分析失败",
  cancelled: "分析已停止",
};

export function AnalysisProgressDialog() {
  const runId = useAtlasStore((state) => state.focusedAnalysisRunId);
  const task = useAtlasStore((state) => runId ? state.analysisTasks[runId] : undefined);
  const focusTask = useAtlasStore((state) => state.focusAnalysisTask);
  const markStopping = useAtlasStore((state) => state.markAnalysisStopping);
  const setSnapshot = useAtlasStore((state) => state.setSnapshot);
  const setPrimaryView = useAtlasStore((state) => state.setPrimaryView);
  const setToast = useAtlasStore((state) => state.setToast);
  const dialogRef = useRef<HTMLElement>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!task) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") focusTask(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [focusTask, task]);

  if (!task) return null;
  const terminal = ["ready", "partial", "failed", "cancelled"].includes(task.status);
  const successful = task.status === "ready" || task.status === "partial";
  const close = () => focusTask(null);
  const stop = async () => {
    markStopping(task.runId);
    try {
      const accepted = await atlasIpc.cancelAnalysis(task.runId);
      if (!accepted) setToast("任务已经结束；正在等待最终状态同步");
    } catch (error) {
      setToast(`无法请求停止：${ipcErrorMessage(error, "未知错误")}`);
    }
  };
  const openAtlas = async () => {
    setOpening(true);
    try {
      setSnapshot(await atlasIpc.getSnapshot(task.conversationId));
      setPrimaryView("atlas");
      close();
    } catch (error) {
      setToast(`无法打开论点星图：${ipcErrorMessage(error, "未知错误")}`);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="modal-backdrop analysis-progress-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) close();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="modal analysis-progress-dialog panel-shadow" role="dialog" aria-modal="true" aria-label="分析进度">
        <header className="modal-header">
          <div><span>后台分析任务</span><h2>{task.title || "对话分析"}</h2></div>
          <button type="button" aria-label="关闭" onClick={close}><CloseIcon /></button>
        </header>
        <div className="modal-body">
          <div className={`analysis-task-state is-${task.status}`}>
            {!terminal ? <span className="analysis-spinner" /> : <i />}
            <div>
              <strong>{stageLabel[task.progress.stage] ?? task.progress.message}</strong>
              <span>{task.progress.message}</span>
            </div>
            <b>{task.progress.completed} / {task.progress.total}</b>
          </div>
          <progress value={task.progress.completed} max={Math.max(task.progress.total, 1)} />
          <p className="privacy-copy">关闭此窗口不会取消分析。任务会在 Dialogue Atlas 继续运行；只有“停止分析”会发送取消请求。</p>
          <div className="modal-actions">
            {!terminal ? <button type="button" className="danger" disabled={task.status === "stopping"} onClick={() => void stop()}>{task.status === "stopping" ? "停止中…" : "停止分析"}</button> : null}
            <button type="button" onClick={close}>{terminal ? "关闭" : "在后台继续"}</button>
            {successful ? <button type="button" className="primary" disabled={opening} onClick={() => void openAtlas()}>{opening ? "打开中…" : "打开论点星图"}</button> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
