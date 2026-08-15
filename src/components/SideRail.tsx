import { useAtlasStore } from "../store";
import {
  AtlasIcon,
  CalendarIcon,
  HelpIcon,
  ImportIcon,
  LayersIcon,
  OutlineIcon,
  RelayIcon,
  SlidersIcon,
} from "./icons";

interface RailButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function RailButton({ label, active, onClick, children }: RailButtonProps) {
  return (
    <button
      type="button"
      className={`rail-button ${active ? "is-active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
      <span className="rail-tooltip">{label}</span>
    </button>
  );
}

export function SideRail() {
  const primaryView = useAtlasStore((state) => state.primaryView);
  const setPrimaryView = useAtlasStore((state) => state.setPrimaryView);
  const isFixedExample = useAtlasStore((state) => state.snapshot.provider === "fixture");
  const drawer = useAtlasStore((state) => state.drawer);
  const setDrawer = useAtlasStore((state) => state.setDrawer);
  const setImport = useAtlasStore((state) => state.setImport);
  const toggleModes = useAtlasStore((state) => state.toggleModes);
  const setToast = useAtlasStore((state) => state.setToast);

  return (
    <nav className="side-rail" aria-label="主要工具">
      <div className="rail-top">
        <div className="rail-logo" aria-hidden="true"><AtlasIcon size={26} /></div>
        <RailButton label="对话日历" active={primaryView === "calendar"} onClick={() => { setDrawer("none"); setPrimaryView("calendar"); }}><CalendarIcon /></RailButton>
        <RailButton label="论点星图" active={primaryView === "atlas"} onClick={() => { setDrawer("none"); setPrimaryView("atlas"); }}><AtlasIcon /></RailButton>
        <RailButton label="协作空间" active={primaryView === "relay"} onClick={() => { setDrawer("none"); setPrimaryView("relay"); }}><RelayIcon /></RailButton>
        <RailButton label="导入对话" onClick={() => setImport(true)}><ImportIcon /></RailButton>
        {primaryView === "atlas" ? <RailButton
          label="线性大纲"
          active={drawer === "outline"}
          onClick={() => setDrawer(drawer === "outline" ? "none" : "outline")}
        ><OutlineIcon /></RailButton> : null}
        {primaryView === "atlas" ? <RailButton
          label="模式"
          active={drawer === "modes"}
          onClick={() => setDrawer(drawer === "modes" ? "none" : "modes")}
        ><LayersIcon /></RailButton> : null}
        {primaryView === "atlas" ? <RailButton label="筛选" onClick={() => setToast("筛选已简化为原文搜索和模式开关")}><SlidersIcon /></RailButton> : null}
      </div>
      <RailButton label="帮助" onClick={() => {
        if (primaryView === "atlas") {
          toggleModes();
          window.setTimeout(toggleModes, 420);
        }
        setToast(primaryView === "calendar"
          ? "对话时间点来自最后一条可见消息；索引、预览和浏览均在本地完成"
          : isFixedExample
          ? "柔色岛是固定示例中的模式标注，可关闭、重叠或重复出现"
          : "柔色岛是 AI 推断的对话模式，可关闭、重叠或重复出现");
      }}><HelpIcon /></RailButton>
    </nav>
  );
}
