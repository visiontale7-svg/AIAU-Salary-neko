import { atlasIpc } from "../ipc";
import { useAtlasStore } from "../store";
import { AtlasIcon, LayersIcon, SettingsIcon, SparkleIcon } from "./icons";

export function AppHeader() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const conversation = snapshot.conversation;
  const showModes = useAtlasStore((state) => state.showModes);
  const toggleModes = useAtlasStore((state) => state.toggleModes);
  const setSettings = useAtlasStore((state) => state.setSettings);
  const setDrawer = useAtlasStore((state) => state.setDrawer);
  const validationIssues = useAtlasStore((state) => state.snapshot.validationIssues);
  const issues = validationIssues ?? [];

  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark"><AtlasIcon size={22} /></span>
        <div>
          <h1>对话图谱 <span>/ 论点星图</span></h1>
          <p>Dialogue Atlas · {atlasIpc.mode === "browser-demo" ? "浏览器演示" : conversation.sourceKind === "demo" ? "本地桌面 · B5 示例" : `本地桌面 · ${snapshot.provider === "codex_cli" ? "Codex via ChatGPT" : snapshot.provider === "openai_api" ? "OpenAI API" : "来源未记录"}`}</p>
        </div>
      </div>
      <div className="conversation-summary" aria-label="对话分析摘要">
        <strong>{conversation.title}</strong>
        <i />
        <span>{conversation.turns} 轮</span>
        <i />
        <span>{conversation.totalUnits} 个语义片段</span>
        <i />
        <span>{conversation.expandedUnits} 已展开</span>
      </div>
      <div className="header-actions">
        {issues.length ? (
          <button type="button" className="review-badge" onClick={() => setDrawer("review")}>
            {issues.length} 项待复核
          </button>
        ) : null}
        <button
          type="button"
          className={`mode-toggle ${showModes ? "is-on" : ""}`}
          onClick={toggleModes}
          aria-pressed={showModes}
          aria-label="模式叠层"
        >
          <LayersIcon size={16} />
          <span>模式叠层</span>
          <i><b /></i>
          <em>{showModes ? "开" : "关"}</em>
        </button>
        <div className="inference-badge" title="模式和初始关系来自模型推断，可逐项检查和纠正">
          <SparkleIcon size={17} /> AI 推断
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="设置"
          onClick={() => setSettings(true)}
        >
          <SettingsIcon size={19} />
        </button>
      </div>
    </header>
  );
}
