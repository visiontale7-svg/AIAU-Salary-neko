import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CalendarEntry,
  ImportPreview,
  ImportPreviewProgress,
  ImportPreviewReady,
  CalendarConversationVersion,
} from "../domain";
import { atlasIpc, ipcErrorMessage } from "../ipc";
import { useAtlasStore } from "../store";
import { FileIcon } from "../components/icons";
import { CalendarImportPreviewDialog } from "./CalendarImportPreviewDialog";
import { activeTaskForConversation } from "../analysisTasks";
import {
  WEEK_HOUR_HEIGHT,
  analysisStateLabel,
  calendarEntryAction,
  clusterWeekEntries,
  dayOfMonth,
  formatChineseDate,
  formatTokyoTime,
  groupCalendarEntries,
  monthGridDates,
  monthOf,
  tokyoDateKey,
  tokyoMinuteOfDay,
  tokyoToday,
  weekDates,
  weekdayOf,
} from "./calendarUtils";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function CalendarStatePill({ entry }: { entry: CalendarEntry }) {
  const activeTask = useAtlasStore((state) => activeTaskForConversation(state.analysisTasks, entry.latestConversationId));
  if (activeTask) return <span className={`calendar-state-pill is-${activeTask.status}`}>{activeTask.status === "stopping" ? "停止中" : "分析中"}</span>;
  const state = entry.importState === "source_updated" ? "updated" : entry.analysisState;
  return <span className={`calendar-state-pill is-${state}`}>{analysisStateLabel(entry)}</span>;
}

function MonthEntryCard({ entry, selected, select }: {
  entry: CalendarEntry;
  selected: boolean;
  select: () => void;
}) {
  return (
    <button type="button" className={`month-entry-card ${selected ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); select(); }}>
      <span className="month-entry-time">{formatTokyoTime(entry.lastActivityAt)}</span>
      <strong>{entry.title}</strong>
      <CalendarStatePill entry={entry} />
    </button>
  );
}

function MonthCalendar() {
  const anchor = useAtlasStore((state) => state.calendarAnchorDate);
  const entries = useAtlasStore((state) => state.calendarEntries);
  const selectedId = useAtlasStore((state) => state.selectedCalendarEntryId);
  const selectEntry = useAtlasStore((state) => state.selectCalendarEntry);
  const selectDate = useAtlasStore((state) => state.selectCalendarDate);
  const dates = useMemo(() => monthGridDates(anchor), [anchor]);
  const grouped = useMemo(() => groupCalendarEntries(entries), [entries]);
  const currentMonth = monthOf(anchor);
  const today = tokyoToday();

  return (
    <section className="month-calendar" aria-label="对话月历">
      <div className="month-weekday-row" aria-hidden="true">
        {WEEKDAYS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="month-grid">
        {dates.map((date) => {
          const dayEntries = grouped.get(date) ?? [];
          const outside = monthOf(date) !== currentMonth;
          return (
            <div
              key={date}
              role="group"
              aria-label={`${formatChineseDate(date)}，${dayEntries.length} 段对话`}
              className={`month-day ${outside ? "is-outside" : ""} ${date === today ? "is-today" : ""}`}
              onClick={() => selectDate(date)}
            >
              <button type="button" className="month-day-number" aria-label={`查看 ${formatChineseDate(date)}`} onClick={() => selectDate(date)}>{dayOfMonth(date)}</button>
              <div className="month-day-entries">
                {dayEntries.slice(0, 3).map((entry) => (
                  <MonthEntryCard key={entry.id} entry={entry} selected={selectedId === entry.id} select={() => selectEntry(entry.id, date)} />
                ))}
                {dayEntries.length > 3 ? (
                  <button type="button" className="month-more" onClick={(event) => { event.stopPropagation(); selectDate(date); }}>+{dayEntries.length - 3} 段对话</button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekEntryCard({ entry, selected, lane, laneCount, select }: {
  entry: CalendarEntry;
  selected: boolean;
  lane: number;
  laneCount: number;
  select: () => void;
}) {
  const minute = tokyoMinuteOfDay(entry.lastActivityAt!) ?? 0;
  const top = minute / 60 * WEEK_HOUR_HEIGHT;
  return (
    <div className="week-event-position" style={{ top, left: `${lane / laneCount * 100}%`, width: `${100 / laneCount}%` }}>
      <i className="week-event-dot" />
      <i className="week-event-leader" />
      <button type="button" className={`week-entry-card ${selected ? "is-selected" : ""}`} aria-label={`${entry.title}，最后活动 ${formatTokyoTime(entry.lastActivityAt)}`} onClick={(event) => { event.stopPropagation(); select(); }}>
        <strong>{entry.title}</strong>
        <span>最后活动 {formatTokyoTime(entry.lastActivityAt)}</span>
        <small>{entry.turnCount ? `${entry.turnCount}轮` : "轮次待预览"}<CalendarStatePill entry={entry} /></small>
      </button>
    </div>
  );
}

function WeekCalendar() {
  const anchor = useAtlasStore((state) => state.calendarAnchorDate);
  const entries = useAtlasStore((state) => state.calendarEntries);
  const selectedId = useAtlasStore((state) => state.selectedCalendarEntryId);
  const selectEntry = useAtlasStore((state) => state.selectCalendarEntry);
  const selectDate = useAtlasStore((state) => state.selectCalendarDate);
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const clusters = useMemo(() => clusterWeekEntries(entries), [entries]);
  const scroller = useRef<HTMLDivElement>(null);
  const today = tokyoToday();
  const now = new Date();
  const nowMinute = tokyoMinuteOfDay(now.toISOString()) ?? 0;
  const selected = entries.find((entry) => entry.id === selectedId);

  useEffect(() => {
    if (typeof scroller.current?.scrollTo === "function") {
      // Leave a small inset so the transformed 08:00 label is fully visible.
      scroller.current.scrollTo({ top: 8 * WEEK_HOUR_HEIGHT - 14, behavior: "auto" });
    }
  }, [anchor]);

  useEffect(() => {
    const minute = selected?.lastActivityAt ? tokyoMinuteOfDay(selected.lastActivityAt) : undefined;
    const element = scroller.current;
    if (minute === undefined || !element || typeof element.scrollTo !== "function") return;
    const point = minute / 60 * WEEK_HOUR_HEIGHT;
    const visibleTop = element.scrollTop + 28;
    const visibleBottom = element.scrollTop + element.clientHeight - 90;
    // "Scroll to its time" means reveal it, not unnecessarily pin it to the top.
    if (point < visibleTop || point > visibleBottom) {
      element.scrollTo({ top: Math.max(0, point - 90), behavior: "smooth" });
    }
  }, [selected?.id, selected?.lastActivityAt]);

  return (
    <section className="week-calendar" aria-label="对话周历">
      <div className="week-day-header">
        <span className="week-zone">GMT+09</span>
        {dates.map((date) => (
          <button type="button" key={date} className={date === today ? "is-today" : ""} onClick={() => selectDate(date)}>
            <span>{WEEKDAYS[weekdayOf(date)]}</span><strong>{dayOfMonth(date)}</strong>
          </button>
        ))}
      </div>
      <div ref={scroller} className="week-scroll" tabIndex={0} aria-label="00:00 至 24:00 时间网格">
        <div className="week-time-canvas" style={{ height: 24 * WEEK_HOUR_HEIGHT }}>
          <div className="week-hour-labels" aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * WEEK_HOUR_HEIGHT }}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
          <div className="week-day-columns">
            {dates.map((date) => (
              <div key={date} className="week-day-column" aria-label={formatChineseDate(date)} onClick={() => selectDate(date)}>
                {Array.from({ length: 24 }, (_, hour) => <i className="week-hour-line" key={hour} style={{ top: hour * WEEK_HOUR_HEIGHT }} />)}
                {date === today ? <div className="week-now-line" style={{ top: nowMinute / 60 * WEEK_HOUR_HEIGHT }}><i /><span>现在</span></div> : null}
                {clusters.filter((cluster) => cluster.date === date).map((cluster) => cluster.entries.length >= 3 ? (
                  <div className="week-event-position is-cluster" style={{ top: cluster.minute / 60 * WEEK_HOUR_HEIGHT }} key={cluster.id}>
                    <i className="week-event-dot" /><i className="week-event-leader" />
                    <button type="button" className={`week-entry-card week-cluster-card ${cluster.entries.some((entry) => entry.id === selectedId) ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); selectDate(date); }}>
                      <strong>{cluster.entries.length} 段对话</strong>
                      <span>{formatTokyoTime(cluster.entries[0].lastActivityAt)}—{formatTokyoTime(cluster.entries.at(-1)?.lastActivityAt)}</span>
                      <small>点击查看精确时间</small>
                    </button>
                  </div>
                ) : cluster.entries.map((entry, lane) => (
                  <WeekEntryCard
                    key={entry.id}
                    entry={entry}
                    lane={lane}
                    laneCount={cluster.entries.length}
                    selected={selectedId === entry.id}
                    select={() => selectEntry(entry.id, date)}
                  />
                )))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function sourceStateLabel(state: CalendarEntry["sourceState"]): string {
  return ({ active: "当前会话", archived: "已归档", missing: "源文件不可用", import_only: "仅导入记录" } as const)[state];
}

function actionLabel(entry: CalendarEntry, hasActiveTask = false): string {
  if (hasActiveTask) return "查看分析进度";
  return ({
    preview: "读取本地预览",
    open_atlas: "打开论点星图",
    analyze: entry.analysisState === "failed" ? "重新分析" : "开始分析",
    preview_update: "预览新版本",
    unavailable: "源文件不可用",
  } as const)[calendarEntryAction(entry)];
}

function CalendarDetail({ action, busyEntryId }: { action: (entry: CalendarEntry) => void; busyEntryId: string | null }) {
  const entries = useAtlasStore((state) => state.calendarEntries);
  const undated = useAtlasStore((state) => state.undatedCalendarEntries);
  const selectedId = useAtlasStore((state) => state.selectedCalendarEntryId);
  const selectedDate = useAtlasStore((state) => state.selectedCalendarDate);
  const selectEntry = useAtlasStore((state) => state.selectCalendarEntry);
  const selected = [...entries, ...undated].find((entry) => entry.id === selectedId);
  const activeTask = useAtlasStore((state) => activeTaskForConversation(state.analysisTasks, selected?.latestConversationId));
  const setSnapshot = useAtlasStore((state) => state.setSnapshot);
  const setPrimaryView = useAtlasStore((state) => state.setPrimaryView);
  const setToast = useAtlasStore((state) => state.setToast);
  const [versions, setVersions] = useState<CalendarConversationVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const dayEntries = selectedDate === "undated"
    ? undated
    : selectedDate
      ? (groupCalendarEntries(entries).get(selectedDate) ?? [])
      : [];

  useEffect(() => {
    let active = true;
    if (!selected || selected.importedVersionCount === 0) {
      setVersions([]);
      return () => { active = false; };
    }
    setVersionsLoading(true);
    void atlasIpc.listCalendarEntryVersions(selected.id).then((next) => {
      if (active) setVersions(next);
    }).catch((value) => {
      if (active) setToast(`无法读取历史版本：${ipcErrorMessage(value, "未知错误")}`);
    }).finally(() => {
      if (active) setVersionsLoading(false);
    });
    return () => { active = false; };
  }, [selected?.id, selected?.importedVersionCount, setToast]);

  const openVersion = async (version: CalendarConversationVersion) => {
    if (version.snapshotCount === 0) {
      setToast(version.isLatest ? "当前版本尚无可打开的分析快照" : "该历史版本没有分析快照");
      return;
    }
    try {
      setSnapshot(await atlasIpc.getSnapshot(version.conversationId));
      setPrimaryView("atlas");
    } catch (value) {
      setToast(`无法打开历史图谱：${ipcErrorMessage(value, "未知错误")}`);
    }
  };

  if (!selected && !selectedDate) {
    return (
      <aside className="calendar-detail panel-shadow" aria-label="对话详情">
        <div className="calendar-detail-empty"><FileIcon size={30} /><strong>选择一段对话</strong><p>查看最后活动时间、索引状态与可用操作。</p></div>
        <div className="calendar-local-note">本地历史索引 · 浏览不会触发模型</div>
      </aside>
    );
  }

  return (
    <aside className="calendar-detail panel-shadow" aria-label="对话详情">
      <div className="calendar-detail-scroll">
        <header>
          <span>{selectedDate === "undated" ? "日期未知" : selectedDate ? formatChineseDate(selectedDate) : "对话详情"}</span>
          <h2>{selected?.title ?? `${dayEntries.length} 段对话`}</h2>
        </header>
        {dayEntries.length > 0 && (!selected || dayEntries.length > 1) ? (
          <div className="calendar-day-list" aria-label="当日全部对话">
            {dayEntries.map((entry) => (
              <button type="button" className={entry.id === selectedId ? "is-selected" : ""} key={entry.id} onClick={() => selectEntry(entry.id, selectedDate)}>
                <span>{entry.lastActivityAt ? formatTokyoTime(entry.lastActivityAt) : "—"}</span><strong>{entry.title}</strong><CalendarStatePill entry={entry} />
              </button>
            ))}
          </div>
        ) : null}
        {selected ? (
          <>
            <div className="calendar-source-line">
              <FileIcon size={16} />
              {selected.sourceState === "import_only" ? "本地导入记录" : "Codex JSONL"} · 最后一条可见消息
            </div>
            <dl className="calendar-detail-facts">
              <div><dt>最后活动</dt><dd>{formatTokyoTime(selected.lastActivityAt)}</dd></div>
              <div><dt>完成回复</dt><dd>{formatTokyoTime(selected.lastCompletedTurnAt)}</dd></div>
              <div><dt>轮次</dt><dd>{selected.turnCount ?? "预览后可见"}</dd></div>
              <div><dt>来源</dt><dd>{sourceStateLabel(selected.sourceState)}</dd></div>
              <div><dt>导入版本</dt><dd>{selected.importedVersionCount}</dd></div>
              <div><dt>状态</dt><dd><CalendarStatePill entry={selected} /></dd></div>
              {selected.timeCoverage === "complete" && selected.activeDayCount !== undefined ? <div><dt>活跃日</dt><dd>{selected.activeDayCount}</dd></div> : null}
            </dl>
            {selected.importedVersionCount > 0 ? (
              <div className="calendar-version-list" aria-label="导入历史版本">
                <strong>历史版本</strong>
                {versionsLoading ? <span>读取中…</span> : versions.map((version, index) => (
                  <button type="button" key={version.conversationId} disabled={version.snapshotCount === 0} onClick={() => void openVersion(version)}>
                    <span>{version.isLatest ? "当前版本" : `历史版本 ${versions.length - index}`}</span>
                    <small>{formatTokyoTime(version.lastActivityAt)} · {version.snapshotCount ? `${version.snapshotCount} 个快照` : "未分析"}</small>
                  </button>
                ))}
              </div>
            ) : null}
            {selected.completionState === "in_progress_or_unknown" ? <div className="calendar-completion-warning">最后活动晚于最后一条 assistant final，结束状态未确认。</div> : null}
            {selected.scanWarning ? <div className="calendar-completion-warning">{selected.scanWarning}</div> : null}
            <button type="button" className="calendar-primary-action" disabled={busyEntryId === selected.id || calendarEntryAction(selected) === "unavailable"} onClick={() => action(selected)}>{busyEntryId === selected.id ? "处理中…" : actionLabel(selected, Boolean(activeTask))}</button>
          </>
        ) : <p className="calendar-list-hint">选择列表中的一段对话查看详情。</p>}
        <div className="calendar-explanation">
          <p>时间点＝最后一条可见消息</p>
          <p>卡片高度≠对话时长</p>
          {selectedDate === "undated" ? <p>缺少真实消息时间的导出不会回退到导入日。</p> : null}
        </div>
      </div>
      <div className="calendar-local-note">本地历史索引 · 不触发模型</div>
    </aside>
  );
}

interface Props {
  refreshCalendar: () => void;
}

export function CalendarView({ refreshCalendar }: Props) {
  const mode = useAtlasStore((state) => state.calendarMode);
  const setSnapshot = useAtlasStore((state) => state.setSnapshot);
  const setPrimaryView = useAtlasStore((state) => state.setPrimaryView);
  const registerAnalysisTask = useAtlasStore((state) => state.registerAnalysisTask);
  const focusAnalysisTask = useAtlasStore((state) => state.focusAnalysisTask);
  const setSettings = useAtlasStore((state) => state.setSettings);
  const setToast = useAtlasStore((state) => state.setToast);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<CalendarEntry | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewProgress, setPreviewProgress] = useState<ImportPreviewProgress | null>(null);
  const activePreviewId = useRef<string | null>(null);
  const previewRequestToken = useRef(0);
  const pendingReady = useRef(new Map<string, ImportPreviewReady>());

  useEffect(() => {
    let active = true;
    let unlistenProgress: (() => void) | undefined;
    let unlistenReady: (() => void) | undefined;
    void atlasIpc.onImportPreviewProgress((next) => {
      if (active && next.previewId === activePreviewId.current) setPreviewProgress(next);
    }).then((unlisten) => { unlistenProgress = unlisten; });
    void atlasIpc.onImportPreviewReady((ready) => {
      if (!active) return;
      if (ready.previewId === activePreviewId.current) {
        if (ready.error) {
          setPreviewEntry(null);
          setToast(`无法读取本地预览：${ready.error}`);
          activePreviewId.current = null;
        } else if (ready.preview) {
          setPreview(ready.preview);
        }
        setPreviewProgress(null);
        setBusyEntryId(null);
      } else {
        if (pendingReady.current.size >= 16) pendingReady.current.clear();
        pendingReady.current.set(ready.previewId, ready);
      }
    }).then((unlisten) => { unlistenReady = unlisten; });
    return () => { active = false; unlistenProgress?.(); unlistenReady?.(); };
  }, []);

  const openPreview = async (entry: CalendarEntry) => {
    const requestToken = ++previewRequestToken.current;
    setBusyEntryId(entry.id);
    setPreviewEntry(entry);
    setPreview(null);
    setPreviewProgress({ previewId: "pending", completedBytes: 0, totalBytes: 0, message: "正在读取本地可见消息…" });
    try {
      const started = await atlasIpc.startImportPreview(entry.id);
      if (previewRequestToken.current !== requestToken) {
        void atlasIpc.cancelImportPreview(started.previewId).catch(() => undefined);
        return;
      }
      activePreviewId.current = started.previewId;
      const alreadyReady = pendingReady.current.get(started.previewId);
      if (alreadyReady) pendingReady.current.delete(started.previewId);
      if (alreadyReady?.error) {
        activePreviewId.current = null;
        setBusyEntryId(null);
        setPreviewProgress(null);
        setPreviewEntry(null);
        setToast(`无法读取本地预览：${alreadyReady.error}`);
        return;
      }
      const readyPreview = started.preview ?? alreadyReady?.preview;
      if (readyPreview) {
        setPreview(readyPreview);
        setPreviewProgress(null);
        setBusyEntryId(null);
      } else {
        setPreviewProgress((current) => ({
          previewId: started.previewId,
          completedBytes: current?.completedBytes ?? 0,
          totalBytes: current?.totalBytes ?? 0,
          message: current?.message ?? "正在读取本地可见消息…",
        }));
      }
    } catch (value) {
      setBusyEntryId(null);
      setPreviewProgress(null);
      setPreviewEntry(null);
      setToast(`无法读取本地预览：${ipcErrorMessage(value, "未知错误")}`);
    }
  };

  const startExistingAnalysis = async (entry: CalendarEntry) => {
    if (!entry.latestConversationId) {
      setToast("该记录没有可分析的导入版本，请先读取本地预览");
      return;
    }
    setBusyEntryId(entry.id);
    try {
      const provider = await atlasIpc.testAnalysisProvider();
      if (!provider.ok) {
        setToast(`${provider.message || "分析来源尚未配置"}；请在设置中完成配置`);
        setSettings(true);
        return;
      }
      const conversationId = entry.latestConversationId;
      const started = await atlasIpc.startAnalysis({ conversationId, modelId: provider.model });
      registerAnalysisTask({ runId: started.runId, conversationId, originEntryId: entry.id, title: entry.title });
      focusAnalysisTask(started.runId);
    } catch (value) {
      setToast(`无法开始分析：${ipcErrorMessage(value, "未知错误")}`);
    } finally {
      setBusyEntryId(null);
    }
  };

  const act = async (entry: CalendarEntry) => {
    const activeTask = activeTaskForConversation(useAtlasStore.getState().analysisTasks, entry.latestConversationId);
    if (activeTask) {
      focusAnalysisTask(activeTask.runId);
      return;
    }
    const action = calendarEntryAction(entry);
    if (action === "preview" || action === "preview_update") return openPreview(entry);
    if (action === "open_atlas" && entry.latestConversationId) {
      setBusyEntryId(entry.id);
      try {
        setSnapshot(await atlasIpc.getSnapshot(entry.latestConversationId));
        setPrimaryView("atlas");
      } catch (value) {
        setToast(`无法打开论点星图：${ipcErrorMessage(value, "未知错误")}`);
      } finally {
        setBusyEntryId(null);
      }
      return;
    }
    if (action === "analyze") return startExistingAnalysis(entry);
    setToast("源文件不可用，无法读取新的本地预览");
  };

  const closePreview = () => {
    previewRequestToken.current += 1;
    const previewId = activePreviewId.current;
    if (!preview && previewId) void atlasIpc.cancelImportPreview(previewId).catch(() => undefined);
    activePreviewId.current = null;
    setPreview(null);
    setPreviewEntry(null);
    setPreviewProgress(null);
    setBusyEntryId(null);
  };

  return (
    <main className="calendar-main">
      <div className="calendar-stage">
        {mode === "month" ? <MonthCalendar /> : <WeekCalendar />}
        <footer className="calendar-legend">
          <span><i className="legend-point" /> 时间点＝最后可见消息</span>
          <span>卡片高度≠对话时长</span>
          <span>时区 Asia/Tokyo</span>
        </footer>
        {previewProgress ? (
          <div className="calendar-preview-progress panel-shadow" role="status">
            <span className="analysis-spinner" />
            <div><strong>{previewProgress.message}</strong><small>{previewProgress.totalBytes > 0 ? `${Math.round(previewProgress.completedBytes / previewProgress.totalBytes * 100)}%` : "流式读取中"}</small></div>
            <button type="button" onClick={closePreview}>取消</button>
          </div>
        ) : null}
      </div>
      <CalendarDetail action={(entry) => void act(entry)} busyEntryId={busyEntryId} />
      {previewEntry && preview ? <CalendarImportPreviewDialog entry={previewEntry} initialPreview={preview} close={closePreview} refreshCalendar={refreshCalendar} /> : null}
    </main>
  );
}
