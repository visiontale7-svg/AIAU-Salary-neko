import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisProvider,
  AnalysisProviderStatus,
  AtlasRelation,
  CredentialStoreKind,
  DialogueAct,
  ImportPreview,
  RelationType,
  SemanticUnit,
} from "../domain";
import { DIALOGUE_ACTS, RELATION_TYPES } from "../domain";
import { atlasIpc, ipcErrorMessage } from "../ipc";
import { useAtlasStore } from "../store";
import { CloseIcon, ImportIcon, SparkleIcon } from "./icons";

const providerLabel = (provider: AnalysisProvider) =>
  provider === "codex_cli" ? "Codex via ChatGPT" : "OpenAI API";

const credentialStoreLabel = (credentialStore: CredentialStoreKind) => {
  if (credentialStore === "macos_keychain") return "macOS Keychain";
  if (credentialStore === "windows_credential_manager") return "Windows 凭据管理器";
  return "系统凭据库";
};

function DialogShell({
  title,
  eyebrow,
  close,
  wide = false,
  children,
}: {
  title: string;
  eyebrow: string;
  close: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.querySelectorAll<HTMLElement>(".side-rail, .app-header, .atlas-main")];
    background.forEach((element) => {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    });
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => element.offsetParent !== null);
    const initial = dialogRef.current?.querySelector<HTMLElement>("[autofocus]") ?? focusable()[0];
    window.setTimeout(() => initial?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      background.forEach((element) => {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      });
      previous?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) close();
    }}>
      <section ref={dialogRef} className={`modal panel-shadow ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><span>{eyebrow}</span><h2>{title}</h2></div>
          <button type="button" aria-label="关闭" onClick={close}><CloseIcon /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function ImportDialog() {
  const setImport = useAtlasStore((state) => state.setImport);
  const registerAnalysisTask = useAtlasStore((state) => state.registerAnalysisTask);
  const focusAnalysisTask = useAtlasStore((state) => state.focusAnalysisTask);
  const analysisSettings = useAtlasStore((state) => state.analysisSettings);
  const credentialStore = credentialStoreLabel(analysisSettings.capabilities.credentialStore);
  const [sourceMode, setSourceMode] = useState<"paste" | "jsonl">("paste");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [committedConversationId, setCommittedConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewPaste = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await atlasIpc.previewPaste(text));
      setCommittedConversationId(null);
    } catch (value) {
      setError(ipcErrorMessage(value, "无法解析粘贴内容"));
    } finally {
      setBusy(false);
    }
  };

  const chooseJsonl = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await atlasIpc.chooseJsonl();
      if (!path) {
        if (atlasIpc.mode === "browser-demo") setError("浏览器演示无法读取本地文件，请改用粘贴；桌面应用支持 JSONL。 ");
        return;
      }
      setPreview(await atlasIpc.previewCodexJsonl(path));
      setCommittedConversationId(null);
    } catch (value) {
      setError(ipcErrorMessage(value, "无法读取 Codex JSONL"));
    } finally {
      setBusy(false);
    }
  };

  const changeSpeaker = (id: string) => {
    if (!preview) return;
    setPreview({
      ...preview,
      messages: preview.messages.map((message) =>
        message.id === id
          ? { ...message, speaker: message.speaker === "user" ? "assistant" : "user" }
          : message,
      ),
    });
  };

  const analyze = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const providerStatus = await atlasIpc.testAnalysisProvider();
      if (!providerStatus.ok) {
        const setupHint = providerStatus.provider === "openai_api"
          ? `请打开右上角“设置”，将 API key 保存到${credentialStore}后重试`
          : `请先在设置中完成${providerLabel(providerStatus.provider)}配置`;
        throw new Error(`${providerStatus.message || `${providerLabel(providerStatus.provider)}尚未配置`}；${setupHint}`);
      }
      if (!providerStatus.model.trim()) {
        throw new Error(`${providerLabel(providerStatus.provider)}未返回可用模型`);
      }
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
      }
      const started = await atlasIpc.startAnalysis({
        conversationId,
        modelId: providerStatus.model,
      });
      registerAnalysisTask({ runId: started.runId, conversationId, title: preview.title });
      setBusy(false);
      setImport(false);
      focusAnalysisTask(started.runId);
    } catch (value) {
      setBusy(false);
      setError(ipcErrorMessage(value, "无法开始分析"));
    }
  };

  const redactionCount = preview?.messages.reduce(
    (sum, message) => sum + (message.redactions?.length ?? 0),
    0,
  ) ?? 0;

  return (
    <DialogShell title="导入一段真实对话" eyebrow="本地来源与隐私预览" close={() => setImport(false)} wide>
      <div className="source-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={sourceMode === "paste"} className={sourceMode === "paste" ? "is-active" : ""} onClick={() => { setSourceMode("paste"); setPreview(null); setCommittedConversationId(null); }}>粘贴对话</button>
        <button type="button" role="tab" aria-selected={sourceMode === "jsonl"} className={sourceMode === "jsonl" ? "is-active" : ""} onClick={() => { setSourceMode("jsonl"); setPreview(null); setCommittedConversationId(null); }}>Codex JSONL</button>
      </div>

      {!preview && sourceMode === "paste" ? (
        <div className="modal-body import-source">
          <label htmlFor="dialogue-paste">使用“用户：／GPT：”或“User:／Assistant:”分隔发言</label>
          <textarea id="dialogue-paste" value={text} onChange={(event) => setText(event.target.value)} placeholder={'用户：请先调查成熟分类标准。\nGPT：可以从 ISO 24617-2 开始…'} autoFocus />
          <p className="privacy-copy">粘贴内容会按这里确认的字面文本参与隐私预览；Codex JSONL 模式才会自动排除 reasoning、工具事件和注入上下文。</p>
          <div className="modal-actions"><button type="button" onClick={() => setImport(false)}>取消</button><button type="button" className="primary" disabled={!text.trim() || busy} onClick={() => void previewPaste()}>{busy ? "解析中…" : "预览轮次"}</button></div>
        </div>
      ) : null}

      {!preview && sourceMode === "jsonl" ? (
        <div className="modal-body file-drop">
          <span className="file-icon"><ImportIcon size={30} /></span>
          <h3>选择 Codex JSONL</h3>
          <p>支持原始 rollout 与可见对话导出；只提取 user/assistant 文本，原始 JSONL 不会被复制进数据库。</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void chooseJsonl()}>{busy ? "读取中…" : "选择 JSONL 文件"}</button>
        </div>
      ) : null}

      {preview ? (
        <div className="modal-body preview-layout">
          <div className="preview-summary">
            <div><strong>{preview.title}</strong><span>{preview.messages.length} 条可见消息 · {preview.characterCount.toLocaleString()} 字符</span></div>
            <div className="privacy-chip"><SparkleIcon size={14} /> {atlasIpc.mode === "browser-demo" ? "浏览器仅预览轮次" : redactionCount ? `${redactionCount} 个建议遮盖项` : "未发现明显密钥"}</div>
          </div>
          {preview.warnings.length ? <div className="warning-box">{preview.warnings.join("；")}</div> : null}
          <div className="preview-messages" aria-label="导入轮次预览">
            {preview.messages.map((message) => (
              <article className="preview-message" key={message.id}>
                <button type="button" className={`speaker-toggle ${message.speaker}`} aria-label={`切换说话者：${message.speaker === "user" ? "用户" : "GPT"}`} onClick={() => changeSpeaker(message.id)}>{message.speaker === "user" ? "用户" : "GPT"}</button>
                <div><strong>T{String(message.turnOrdinal).padStart(2, "0")}{message.phase ? ` · ${message.phase}` : ""}</strong><p>{message.text}</p>{message.redactions?.length ? <small>{message.redactions.length} 个位置将在模型输入中遮盖；本地原文保留</small> : null}</div>
              </article>
            ))}
          </div>
          <div className="analysis-source-note">
            <strong>当前分析来源：{providerLabel(analysisSettings.provider)}</strong>
            <span>{analysisSettings.provider === "codex_cli" ? "GPT-5.6 Luna" : analysisSettings.defaultOpenaiModel}</span>
          </div>
          <p className="privacy-copy">{atlasIpc.mode === "browser-demo"
            ? "浏览器示例不会扫描隐私或启动模型分析；请在桌面应用中确认遮盖并分析。"
            : analysisSettings.provider === "codex_cli"
              ? "这里确认的可见文本或遮盖副本会通过本机 Codex CLI 分析。实际分析会先消耗套餐内 Codex 用量；超出套餐额度后，可能扣除账户已有 credits，若已开启 auto top-up 还可能触发付费充值。应用不会读取、复制或保存登录令牌；数据处理遵循你的 ChatGPT／Codex 数据控制。"
              : <>预览不需要 API key。开始分析前，请先在右上角“设置”中将 key 保存到{credentialStore}。模型只收到这里确认的可见文本或遮盖副本；Responses API 请求使用 <code>store:false</code>，这不等同于组织级 Zero Data Retention。</>}</p>
          <div className="modal-actions"><button type="button" onClick={() => { setPreview(null); setCommittedConversationId(null); }} disabled={busy}>返回修改</button><button type="button" className="primary" disabled={busy || atlasIpc.mode === "browser-demo"} onClick={() => void analyze()}>{atlasIpc.mode === "browser-demo" ? "请使用桌面版分析" : busy ? "正在启动…" : committedConversationId ? "重新分析（当前来源）" : "确认并分析"}</button></div>
        </div>
      ) : null}
      {error ? <div className="modal-error" role="alert">{error}</div> : null}
    </DialogShell>
  );
}

export function SettingsDialog() {
  const setSettings = useAtlasStore((state) => state.setSettings);
  const setToast = useAtlasStore((state) => state.setToast);
  const resetDemo = useAtlasStore((state) => state.resetDemo);
  const analysisSettings = useAtlasStore((state) => state.analysisSettings);
  const setAnalysisSettings = useAtlasStore((state) => state.setAnalysisSettings);
  const availableProviders = analysisSettings.capabilities.availableProviders;
  const credentialStore = credentialStoreLabel(analysisSettings.capabilities.credentialStore);
  const [selectedProvider, setSelectedProvider] = useState<AnalysisProvider>(analysisSettings.provider);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisProviderStatus | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedProvider(availableProviders.includes(analysisSettings.provider)
      ? analysisSettings.provider
      : availableProviders[0] ?? "openai_api");
  }, [analysisSettings.provider, availableProviders]);

  const save = async () => {
    if (atlasIpc.mode === "browser-demo") return;
    setBusy(true);
    setResult(null);
    setResultMessage(null);
    try {
      if (!availableProviders.includes(selectedProvider)) {
        throw new Error("当前平台不支持所选分析来源");
      }
      if (selectedProvider === "openai_api" && apiKey.trim()) {
        await atlasIpc.setApiKey(apiKey.trim());
        setApiKey("");
      }
      const saved = await atlasIpc.setAnalysisProvider(selectedProvider);
      setAnalysisSettings(saved);
      setResultMessage("分析来源已保存；正在检测…");
      const status = await atlasIpc.testAnalysisProvider();
      setResult(status);
      setResultMessage(status.message);
    } catch (value) {
      setResultMessage(ipcErrorMessage(value, "无法保存或检测分析来源"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="本地分析设置" eyebrow={atlasIpc.mode === "tauri" ? "分析来源与凭据" : "浏览器演示"} close={() => setSettings(false)}>
      <div className="modal-body settings-body">
        <fieldset className="provider-picker">
          <legend>选择分析来源</legend>
          {availableProviders.includes("codex_cli") ? (
            <label className={selectedProvider === "codex_cli" ? "provider-option is-selected" : "provider-option"}>
              <input type="radio" name="analysis-provider" value="codex_cli" checked={selectedProvider === "codex_cli"} onChange={() => { setSelectedProvider("codex_cli"); setResult(null); setResultMessage(null); }} />
              <span>
                <strong>Codex via ChatGPT <em>推荐</em></strong>
                <small>套餐内用量／credits · GPT-5.6 Luna</small>
              </span>
            </label>
          ) : null}
          {availableProviders.includes("openai_api") ? (
            <label className={selectedProvider === "openai_api" ? "provider-option is-selected" : "provider-option"}>
              <input type="radio" name="analysis-provider" value="openai_api" checked={selectedProvider === "openai_api"} onChange={() => { setSelectedProvider("openai_api"); setResult(null); setResultMessage(null); }} />
              <span>
                <strong>OpenAI API</strong>
                <small>{analysisSettings.defaultOpenaiModel || "gpt-5-mini"}</small>
              </span>
            </label>
          ) : null}
          {availableProviders.length === 0 ? <div className="settings-result is-error">当前平台没有可用的分析来源。</div> : null}
        </fieldset>

        {selectedProvider === "codex_cli" ? (
          <div className="provider-details">
            <p>使用本机 Codex CLI，通过你的 ChatGPT 登录运行。分析会先消耗套餐内 Codex 用量；超出套餐额度后，如果账户有已购 credits，则可能继续扣除 credits；启用 auto top-up 时可能触发付费充值。</p>
            <p>应用不会读取、复制或保存登录令牌；本机需有已验证的 ChatGPT 内置 Codex 或兼容的本机 Codex CLI，并完成 ChatGPT 登录；独立 CLI 可使用 <code>codex login</code>。设置中的就绪检查会显示实际使用的精确版本；内容与数据处理遵循你的 Codex／ChatGPT 方案及数据控制。</p>
            <p>“检测”只确认 CLI 兼容且当前为 ChatGPT 登录，不读取剩余额度、credits 余额、auto top-up 状态或本次费用；检测本身不发送模型请求、不产生用量。请在 Codex 设置 &gt; Usage 查看账户状态。</p>
          </div>
        ) : (
          <div className="provider-details">
            <label htmlFor="api-key">OpenAI API key</label>
            <input id="api-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`留空可检测${credentialStore}中已有的 key`} />
            <p>API key 保存在{credentialStore}，不进入 SQLite、日志或前端持久化。默认模型为 <strong>{analysisSettings.defaultOpenaiModel || "gpt-5-mini"}</strong>。</p>
            <p>“测试”只确认 key 能访问 <code>/models</code>，不确认目标模型、Responses／Structured Outputs、剩余额度或本次费用；实际分析才会创建模型请求。</p>
          </div>
        )}

        {atlasIpc.mode === "browser-demo" ? <div className="settings-result" role="status">浏览器演示不会调用本机分析来源、读取系统凭据库或发送 OpenAI API 请求。</div> : null}
        {atlasIpc.mode === "tauri" && analysisSettings.capabilities.platform === "windows" ? <div className="settings-result" role="status">Windows 版当前通过 OpenAI API 进行分析。</div> : null}
        {resultMessage ? (
          <div className={`settings-result ${result && !result.ok ? "is-error" : ""}`} role="status">
            <strong>{resultMessage}</strong>
            {result ? <small>{providerLabel(result.provider)} · {result.model}{result.version ? ` · CLI ${result.version}` : ""}</small> : null}
          </div>
        ) : null}
        <div className="settings-row"><span><strong>数据请求</strong><small>{selectedProvider === "codex_cli" ? "本机 CLI 发起远程 Codex 请求 · ephemeral 会话 · ChatGPT／Codex 数据控制" : "Responses API · store:false · 非 background"}</small></span><span className="status-pill">远程模型</span></div>
        <div className="settings-row"><span><strong>演示快照</strong><small>恢复 B5 的 15 轮／41 片段固定数据</small></span><button type="button" onClick={() => { resetDemo(); setToast("已恢复 B5 固定快照"); }}>恢复</button></div>
        <div className="modal-actions"><button type="button" onClick={() => setSettings(false)}>关闭</button><button type="button" className="primary" disabled={busy || atlasIpc.mode === "browser-demo" || !availableProviders.includes(selectedProvider)} onClick={() => void save()}>{busy ? "检测中…" : selectedProvider === "codex_cli" ? "保存并检测登录" : "保存并测试"}</button></div>
      </div>
    </DialogShell>
  );
}

export function CorrectionDialog() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const isFixedExample = snapshot.provider === "fixture";
  const selection = useAtlasStore((state) => state.selection);
  const setCorrection = useAtlasStore((state) => state.setCorrection);
  const applyCorrection = useAtlasStore((state) => state.applyCorrection);
  const resetItemToModel = useAtlasStore((state) => state.resetItemToModel);
  const selectedUnit = selection?.kind === "node" ? snapshot.units.find((unit) => unit.id === selection.id) : undefined;
  const selectedRelation = selection?.kind === "edge" ? snapshot.relations.find((relation) => relation.id === selection.id) : undefined;
  const evidenceUnits = snapshot.units.filter((unit) => unit.kind !== "unresolved" && unit.sourceSpans.length > 0);
  const creatingRelation = !selectedUnit && !selectedRelation;
  const [label, setLabel] = useState(selectedUnit?.label ?? selectedRelation?.label ?? "");
  const [acts, setActs] = useState<DialogueAct[]>(selectedUnit?.acts ?? []);
  const [modeIds, setModeIds] = useState<string[]>(selectedUnit?.modeIds ?? []);
  const [relationType, setRelationType] = useState<RelationType>(selectedRelation?.type ?? "回应");
  const [sourceId, setSourceId] = useState(evidenceUnits[0]?.id ?? "");
  const [targetId, setTargetId] = useState(evidenceUnits.find((unit) => unit.id !== evidenceUnits[0]?.id)?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAct = (act: DialogueAct) => setActs((current) => current.includes(act) ? current.filter((item) => item !== act) : [...current, act]);
  const toggleMode = (modeId: string) => setModeIds((current) => current.includes(modeId) ? current.filter((item) => item !== modeId) : [...current, modeId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (selectedUnit) {
        await applyCorrection({ kind: "update_unit", unitId: selectedUnit.id, label: label.trim() || selectedUnit.label, acts, modeIds });
      } else if (selectedRelation) {
        await applyCorrection({ kind: "update_relation", relationId: selectedRelation.id, type: relationType, label: label.trim() || relationType });
      } else {
        const source = evidenceUnits.find((unit) => unit.id === sourceId);
        const target = evidenceUnits.find((unit) => unit.id === targetId);
        if (!source || !target || source.id === target.id) {
          setError("请选择两个不同、且带有逐字证据的节点");
          return;
        }
        await applyCorrection({
          kind: "add_relation",
          relation: createRelationDraft(source, target, relationType, label.trim() || relationType),
        });
      }
      setCorrection(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={selectedUnit ? "纠正语义节点" : selectedRelation ? "纠正逻辑关系" : "新增有证据的关系"}
      eyebrow={isFixedExample ? "固定示例标注保持不变" : "原始 AI 快照保持不变"}
      close={() => setCorrection(false)}
      wide
    >
      <div className="modal-body correction-body">
        <label htmlFor="correction-label">显示标签</label>
        <input id="correction-label" value={label} onChange={(event) => setLabel(event.target.value)} />
        {selectedUnit ? (
          <>
            <fieldset><legend>对话行为（可多选）</legend><div className="chip-picker">{DIALOGUE_ACTS.map((act) => <button type="button" aria-pressed={acts.includes(act)} className={acts.includes(act) ? "is-selected" : ""} key={act} onClick={() => toggleAct(act)}>{act}</button>)}</div></fieldset>
            <fieldset><legend>模式归属（允许多重或无归属）</legend><div className="chip-picker modes">{snapshot.modes.map((mode) => <button type="button" aria-pressed={modeIds.includes(mode.id)} className={modeIds.includes(mode.id) ? "is-selected" : ""} style={{ "--chip-color": mode.color } as React.CSSProperties} key={mode.id} onClick={() => toggleMode(mode.id)}>{mode.label}</button>)}</div></fieldset>
          </>
        ) : selectedRelation ? (
          <>
            <label htmlFor="relation-type">受控关系类型</label>
            <select id="relation-type" value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)}>{RELATION_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
            <div className="relation-endpoints"><span>{selectedRelation?.source}</span><b>→</b><span>{selectedRelation?.target}</span></div>
          </>
        ) : (
          <>
            <label htmlFor="relation-type">受控关系类型</label>
            <select id="relation-type" value={relationType} onChange={(event) => setRelationType(event.target.value as RelationType)}>{RELATION_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
            <div className="relation-builder">
              <label>来源节点<select aria-label="关系来源节点" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{evidenceUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.turnId} · {unit.label}</option>)}</select></label>
              <b>→</b>
              <label>目标节点<select aria-label="关系目标节点" value={targetId} onChange={(event) => setTargetId(event.target.value)}>{evidenceUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.turnId} · {unit.label}</option>)}</select></label>
            </div>
            <p className="privacy-copy">新关系会引用两个端点中现有的逐字证据；没有证据的人工关系也不会进入主图。</p>
          </>
        )}
        {!creatingRelation ? (
          <p className="privacy-copy">
            纠正与恢复都以追加事件保存；不会重写原文或{isFixedExample ? "示例基础标注" : "模型基础快照"}。
          </p>
        ) : null}
        {error ? <div className="modal-error" role="alert">{error}</div> : null}
        <div className="modal-actions">
          {selectedRelation ? <button type="button" className="danger" onClick={() => {
            void applyCorrection({ kind: "delete_relation", relationId: selectedRelation.id });
            setCorrection(false);
          }}>移除此关系</button> : selectedUnit ? <button type="button" onClick={() => { void resetItemToModel(selectedUnit.id); setCorrection(false); }}>{isFixedExample ? "恢复示例" : "恢复 AI"}</button> : <span />}
          {selectedRelation ? <button type="button" onClick={() => { void resetItemToModel(selectedRelation.id); setCorrection(false); }}>{isFixedExample ? "恢复示例" : "恢复 AI"}</button> : null}
          <button type="button" onClick={() => setCorrection(false)}>取消</button>
          <button type="button" className="primary" disabled={saving || (creatingRelation && evidenceUnits.length < 2)} onClick={() => void save()}>{saving ? "保存中…" : creatingRelation ? "新增关系" : "保存纠正"}</button>
        </div>
      </div>
    </DialogShell>
  );
}

export function createRelationDraft(source: SemanticUnit, target: SemanticUnit, type: RelationType, label: string): AtlasRelation {
  const userUnit = [source, target].find((unit) => unit.speaker === "user");
  const assistantUnit = [source, target].find((unit) => unit.speaker === "assistant");
  return {
    id: `user-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    source: source.id,
    target: target.id,
    type,
    label,
    confidence: 1,
    evidence: {
      title: `人工新增 · ${source.turnId} → ${target.turnId}`,
      user: userUnit?.sourceSpans[0],
      assistant: assistantUnit?.sourceSpans[0],
      context: [source.sourceSpans[0]?.exactQuote, target.sourceSpans[0]?.exactQuote].filter(Boolean).join("\n"),
    },
    provenance: "user",
  };
}
