import { useEffect, useRef, useState } from "react";
import type { CalendarEntry, ImportPreview } from "../domain";
import { atlasIpc, ipcErrorMessage } from "../ipc";
import { useAtlasStore } from "../store";
import { CloseIcon, FileIcon, SparkleIcon } from "../components/icons";
import { formatTokyoTime } from "./calendarUtils";

interface Props {
  entry: CalendarEntry;
  initialPreview: ImportPreview;
  close: () => void;
  refreshCalendar: () => void;
}

function credentialStoreLabel(kind: string): string {
  if (kind === "macos_keychain") return "macOS Keychain";
  if (kind === "windows_credential_manager") return "Windows 凭据管理器";
  return "系统凭据库";
}

function providerLabel(provider: string): string {
  return provider === "codex_cli" ? "Codex via ChatGPT" : "OpenAI API";
}

export function CalendarImportPreviewDialog({ entry, initialPreview, close, refreshCalendar }: Props) {
  const [preview, setPreview] = useState(initialPreview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedConversationId, setCommittedConversationId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const analysisSettings = useAtlasStore((state) => state.analysisSettings);
  const setProgress = useAtlasStore((state) => state.setProgress);
  const setSnapshot = useAtlasStore((state) => state.setSnapshot);
  const setPrimaryView = useAtlasStore((state) => state.setPrimaryView);
  const setToast = useAtlasStore((state) => state.setToast);
  const credentialStore = credentialStoreLabel(analysisSettings.capabilities.credentialStore);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [busy, close]);

  const changeSpeaker = (id: string) => setPreview((current) => ({
    ...current,
    messages: current.messages.map((message) => message.id === id
      ? { ...message, speaker: message.speaker === "user" ? "assistant" : "user" }
      : message),
  }));

  const analyze = async () => {
    if (atlasIpc.mode === "browser-demo") return;
    setBusy(true);
    setError(null);
    let expectedRunId = "";
    let unlisten: (() => void) | undefined;
    try {
      // This preflight intentionally happens before commit: a missing provider
      // must never leave an empty imported conversation behind.
      const providerStatus = await atlasIpc.testAnalysisProvider();
      if (!providerStatus.ok) {
        const hint = providerStatus.provider === "openai_api"
          ? `请打开右上角“设置”，将 API key 保存到${credentialStore}后重试`
          : "请先在设置中完成 Codex 登录检测";
        throw new Error(`${providerStatus.message || "当前分析来源尚未配置"}；${hint}`);
      }
      if (!providerStatus.model.trim()) throw new Error("当前分析来源未返回可用模型");

      let conversationId = committedConversationId;
      if (!conversationId) {
        const committed = await atlasIpc.commitImport({
          previewId: preview.id,
          title: preview.title,
          messages: preview.messages,
          redactionEnabled: true,
        });
        conversationId = committed.conversationId;
        setCommittedConversationId(conversationId);
        // Import is durable even if the following analysis fails or is
        // cancelled. Reflect the immutable new source version immediately.
        refreshCalendar();
      }
      const targetConversationId = conversationId;
      unlisten = await atlasIpc.onAnalysisProgress(async (next) => {
        if (next.conversationId !== targetConversationId) return;
        if (expectedRunId && next.runId !== expectedRunId) return;
        setProgress(next);
        if (next.stage === "ready" || next.stage === "partial") {
          try {
            const snapshot = await atlasIpc.getSnapshot(targetConversationId);
            setSnapshot(snapshot);
            setPrimaryView("atlas");
            setToast(next.stage === "partial" ? "部分分析完成；待复核项已保留" : "对话星图已生成");
            refreshCalendar();
            close();
          } catch (value) {
            setError(ipcErrorMessage(value, "分析完成，但无法读取快照"));
          } finally {
            unlisten?.();
            setBusy(false);
          }
        } else if (next.stage === "failed" || next.stage === "cancelled") {
          setError(`${next.message}；可使用当前分析来源重新分析。`);
          refreshCalendar();
          unlisten?.();
          setBusy(false);
        }
      });
      const started = await atlasIpc.startAnalysis({ conversationId, modelId: providerStatus.model });
      expectedRunId = started.runId;
    } catch (value) {
      unlisten?.();
      setBusy(false);
      setError(ipcErrorMessage(value, "无法导入并分析"));
    }
  };

  const redactionCount = preview.messages.reduce(
    (total, message) => total + (message.redactions?.length ?? 0),
    0,
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) close();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="modal is-wide panel-shadow" role="dialog" aria-modal="true" aria-label="本地会话预览">
        <header className="modal-header">
          <div><span>本地可见消息与隐私确认</span><h2>{entry.importState === "source_updated" ? "预览新版本" : "读取本地预览"}</h2></div>
          <button type="button" aria-label="关闭" disabled={busy} onClick={close}><CloseIcon /></button>
        </header>
        <div className="modal-body preview-layout calendar-import-preview">
          <div className="preview-summary">
            <div><strong>{preview.title}</strong><span>{preview.messages.length} 条可见消息 · {preview.characterCount.toLocaleString()} 字符</span></div>
            <div className="privacy-chip"><SparkleIcon size={14} /> {redactionCount ? `${redactionCount} 个建议遮盖项` : "未发现明显密钥"}</div>
          </div>
          <div className="calendar-preview-metadata">
            <span><FileIcon size={14} /> {preview.sourceFormat === "raw_rollout" ? "Codex 原始会话" : "可见对话"}</span>
            <span>首条可见消息 {formatTokyoTime(preview.firstVisibleAt)}</span>
            <span>最后活动 {formatTokyoTime(preview.lastActivityAt)}</span>
            <span>时间覆盖 {preview.timeCoverage === "complete" ? "完整" : preview.timeCoverage === "partial" ? "部分" : "无"}</span>
          </div>
          {preview.warnings.length ? <div className="warning-box">{preview.warnings.join("；")}</div> : null}
          {preview.sourceStillWriting ? <div className="warning-box">源会话仍在写入；末尾不完整记录未进入本次预览。提交前若文件继续变化，预览会被丢弃并要求重读。</div> : null}
          <div className="preview-messages" aria-label="本地会话轮次预览">
            {preview.messages.map((message) => (
              <article className="preview-message" key={message.id}>
                <button type="button" className={`speaker-toggle ${message.speaker}`} aria-label={`切换说话者：${message.speaker === "user" ? "用户" : "GPT"}`} onClick={() => changeSpeaker(message.id)}>{message.speaker === "user" ? "用户" : "GPT"}</button>
                <div>
                  <strong>T{String(message.turnOrdinal).padStart(2, "0")}{message.phase ? ` · ${message.phase}` : ""}</strong>
                  <p>{message.text}</p>
                  {message.redactions?.length ? <small>{message.redactions.length} 个位置将在模型输入中遮盖；本地原文保留</small> : null}
                </div>
              </article>
            ))}
          </div>
          <div className="analysis-source-note">
            <strong>导入后立即分析：{providerLabel(analysisSettings.provider)}</strong>
            <span>{analysisSettings.provider === "codex_cli" ? analysisSettings.codexCliModel : analysisSettings.defaultOpenaiModel}</span>
          </div>
          <p className="privacy-copy">索引与本地预览未触发模型。点击“导入并分析”后，才会把这里确认的可见文本或遮盖副本发送给当前分析来源；原始 JSONL、reasoning 和工具内容不会写入数据库。</p>
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={close}>取消</button>
            <button type="button" className="primary" disabled={busy || atlasIpc.mode === "browser-demo"} onClick={() => void analyze()}>
              {atlasIpc.mode === "browser-demo" ? "演示不执行导入" : busy ? "分析中…" : committedConversationId ? "重新分析" : "导入并分析"}
            </button>
          </div>
        </div>
        {error ? <div className="modal-error" role="alert">{error}</div> : null}
      </section>
    </div>
  );
}
