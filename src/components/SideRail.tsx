import { useAtlasStore } from "../store";
import {
  AtlasIcon,
  HelpIcon,
  ImportIcon,
  LayersIcon,
  OutlineIcon,
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
        <RailButton label="论点星图" active onClick={() => setDrawer("none")}><AtlasIcon /></RailButton>
        <RailButton label="导入对话" onClick={() => setImport(true)}><ImportIcon /></RailButton>
        <RailButton
          label="线性大纲"
          active={drawer === "outline"}
          onClick={() => setDrawer(drawer === "outline" ? "none" : "outline")}
        ><OutlineIcon /></RailButton>
        <RailButton
          label="模式"
          active={drawer === "modes"}
          onClick={() => setDrawer(drawer === "modes" ? "none" : "modes")}
        ><LayersIcon /></RailButton>
        <RailButton label="筛选" onClick={() => setToast("筛选已简化为原文搜索和模式开关")}><SlidersIcon /></RailButton>
      </div>
      <RailButton label="帮助" onClick={() => {
        toggleModes();
        window.setTimeout(toggleModes, 420);
        setToast(isFixedExample
          ? "柔色岛是固定示例中的模式标注，可关闭、重叠或重复出现"
          : "柔色岛是 AI 推断的对话模式，可关闭、重叠或重复出现");
      }}><HelpIcon /></RailButton>
    </nav>
  );
}
