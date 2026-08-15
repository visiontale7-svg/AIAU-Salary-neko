import { useEffect } from "react";
import { atlasIpc } from "../ipc";
import { useAtlasStore } from "../store";

export function AnalysisProgressListener({ refreshCalendar }: { refreshCalendar: () => void | Promise<void> }) {
  const upsertAnalysisProgress = useAtlasStore((state) => state.upsertAnalysisProgress);
  const setToast = useAtlasStore((state) => state.setToast);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void atlasIpc.onAnalysisProgress((next) => {
      if (!active) return;
      const before = useAtlasStore.getState().analysisTasks[next.runId];
      upsertAnalysisProgress(next);
      const terminal = ["ready", "partial", "failed", "cancelled"].includes(next.stage);
      const wasTerminal = before && ["ready", "partial", "failed", "cancelled"].includes(before.status);
      if (!terminal || wasTerminal) return;
      void refreshCalendar();
      if (next.stage === "ready") setToast("后台分析完成，可打开论点星图");
      else if (next.stage === "partial") setToast("后台分析部分完成，待复核项已保留");
      else if (next.stage === "cancelled") setToast("分析已停止");
      else setToast(`分析失败：${next.message}`);
    }).then((value) => { unlisten = value; });
    return () => { active = false; unlisten?.(); };
  }, [refreshCalendar, setToast, upsertAnalysisProgress]);

  return null;
}
