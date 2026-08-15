import { atlasIpc } from "../ipc";
import { useAtlasStore } from "../store";
import { CalendarIcon, ChevronIcon, CloseIcon, RefreshIcon, SettingsIcon } from "../components/icons";
import { calendarPeriodLabel, shiftCalendarAnchor, tokyoToday } from "./calendarUtils";

export function CalendarHeader({ refresh, cancel }: { refresh: () => void; cancel: () => void }) {
  const mode = useAtlasStore((state) => state.calendarMode);
  const anchor = useAtlasStore((state) => state.calendarAnchorDate);
  const entries = useAtlasStore((state) => state.calendarEntries);
  const undated = useAtlasStore((state) => state.undatedCalendarEntries);
  const loading = useAtlasStore((state) => state.calendarLoading);
  const indexStatus = useAtlasStore((state) => state.codexIndexStatus);
  const platform = useAtlasStore((state) => state.analysisSettings.capabilities.platform);
  const setMode = useAtlasStore((state) => state.setCalendarMode);
  const setAnchor = useAtlasStore((state) => state.setCalendarAnchorDate);
  const setSettings = useAtlasStore((state) => state.setSettings);
  const selectDate = useAtlasStore((state) => state.selectCalendarDate);

  const go = (direction: -1 | 1) => setAnchor(shiftCalendarAnchor(anchor, mode, direction));
  const showRefresh = atlasIpc.mode === "tauri" && platform === "macos";

  return (
    <header className="app-header calendar-header">
      <div className="brand-block">
        <span className="brand-mark"><CalendarIcon size={21} /></span>
        <div>
          <h1>对话图谱 <span>/ 对话日历</span></h1>
          <p>Dialogue Atlas · 本地资料库 · Asia/Tokyo</p>
        </div>
      </div>
      <div className="calendar-period-summary" aria-label="当前日历范围">
        <strong>{calendarPeriodLabel(anchor, mode)}</strong>
        <span>{entries.length} 段对话</span>
        {undated.length ? (
          <button type="button" onClick={() => selectDate("undated")}>日期未知 {undated.length}</button>
        ) : null}
        {indexStatus?.running ? <em>{indexStatus.completed}/{indexStatus.total} 更新中</em> : null}
      </div>
      <div className="header-actions calendar-actions">
        <div className="calendar-nav-group">
          <button type="button" aria-label="上一时期" onClick={() => go(-1)}><ChevronIcon className="is-back" /></button>
          <button type="button" aria-label="下一时期" onClick={() => go(1)}><ChevronIcon /></button>
        </div>
        <button type="button" className="calendar-today-button" onClick={() => setAnchor(tokyoToday())}>今天</button>
        <div className="calendar-mode-switch" role="group" aria-label="日历视图">
          <button type="button" className={mode === "month" ? "is-active" : ""} aria-pressed={mode === "month"} onClick={() => setMode("month")}>月</button>
          <button type="button" className={mode === "week" ? "is-active" : ""} aria-pressed={mode === "week"} onClick={() => setMode("week")}>周</button>
        </div>
        {showRefresh ? (
          <button
            type="button"
            className="icon-button"
            aria-label={indexStatus?.running ? "取消本机会话索引" : "刷新本机会话索引"}
            disabled={loading && !indexStatus?.running}
            onClick={indexStatus?.running ? cancel : refresh}
          >
            {indexStatus?.running ? <CloseIcon size={18} /> : <RefreshIcon size={18} />}
          </button>
        ) : null}
        <button type="button" className="icon-button" aria-label="设置" onClick={() => setSettings(true)}><SettingsIcon size={19} /></button>
      </div>
    </header>
  );
}
