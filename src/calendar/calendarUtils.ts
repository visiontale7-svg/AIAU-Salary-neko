import type { CalendarEntry, CalendarQuery } from "../domain";
import type { CalendarMode } from "../store";

export const CALENDAR_TIME_ZONE = "Asia/Tokyo" as const;
export const WEEK_HOUR_HEIGHT = 68;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: CALENDAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function calendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function addCalendarDays(value: string, days: number): string {
  const result = calendarDate(value);
  result.setUTCDate(result.getUTCDate() + days);
  return dateKey(result);
}

export function shiftCalendarAnchor(value: string, mode: CalendarMode, direction: -1 | 1): string {
  const result = calendarDate(value);
  if (mode === "month") {
    // Calendar navigation is month-based, not a duration from the selected
    // day. Reset first so Jan 31 + one month cannot overflow into March.
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + direction);
  }
  else result.setUTCDate(result.getUTCDate() + 7 * direction);
  return dateKey(result);
}

export function tokyoDateKey(iso: string): string | undefined {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function tokyoToday(now = new Date()): string {
  const parts = Object.fromEntries(dateFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatTokyoTime(iso?: string): string {
  if (!iso) return "时间未知";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? timeFormatter.format(date) : "时间无效";
}

export function tokyoMinuteOfDay(iso: string): number | undefined {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: CALENDAR_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function monthGridDates(anchorDate: string): string[] {
  const anchor = calendarDate(anchorDate);
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    return dateKey(date);
  });
}

export function weekDates(anchorDate: string): string[] {
  const anchor = calendarDate(anchorDate);
  anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
  const start = dateKey(anchor);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index));
}

export function calendarQueryFor(anchorDate: string, mode: CalendarMode): CalendarQuery {
  const dates = mode === "month" ? monthGridDates(anchorDate) : weekDates(anchorDate);
  return {
    startDate: dates[0],
    endDateExclusive: addCalendarDays(dates.at(-1)!, 1),
    timeZone: CALENDAR_TIME_ZONE,
  };
}

export function calendarPeriodLabel(anchorDate: string, mode: CalendarMode): string {
  const [year, month] = anchorDate.split("-").map(Number);
  if (mode === "month") return `${year}年${month}月`;
  const dates = weekDates(anchorDate);
  const start = calendarDate(dates[0]);
  const end = calendarDate(dates[6]);
  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCFullYear()}年${start.getUTCMonth() + 1}月${start.getUTCDate()}—${end.getUTCDate()}日`;
  }
  return `${start.getUTCFullYear()}年${start.getUTCMonth() + 1}月${start.getUTCDate()}日—${end.getUTCFullYear()}年${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
}

export function monthOf(value: string): number {
  return calendarDate(value).getUTCMonth() + 1;
}

export function dayOfMonth(value: string): number {
  return calendarDate(value).getUTCDate();
}

export function weekdayOf(value: string): number {
  return calendarDate(value).getUTCDay();
}

export function formatChineseDate(value: string): string {
  const date = calendarDate(value);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 · ${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getUTCDay()]}`;
}

export function groupCalendarEntries(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const result = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    if (!entry.lastActivityAt) continue;
    const key = tokyoDateKey(entry.lastActivityAt);
    if (!key) continue;
    const group = result.get(key) ?? [];
    group.push(entry);
    result.set(key, group);
  }
  for (const group of result.values()) {
    group.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  }
  return result;
}

export interface WeekCluster {
  id: string;
  date: string;
  minute: number;
  entries: CalendarEntry[];
}

export function clusterWeekEntries(entries: CalendarEntry[], windowMinutes = 45): WeekCluster[] {
  const byDate = groupCalendarEntries(entries);
  const clusters: WeekCluster[] = [];
  for (const [date, datedEntries] of byDate) {
    const positioned = datedEntries
      .map((entry) => ({ entry, minute: tokyoMinuteOfDay(entry.lastActivityAt!) }))
      .filter((item): item is { entry: CalendarEntry; minute: number } => item.minute !== undefined)
      .sort((a, b) => a.minute - b.minute);
    let active: WeekCluster | undefined;
    for (const item of positioned) {
      if (!active || item.minute - active.minute >= windowMinutes) {
        active = { id: `${date}-${item.minute}`, date, minute: item.minute, entries: [item.entry] };
        clusters.push(active);
      } else {
        active.entries.push(item.entry);
      }
    }
  }
  return clusters;
}

export function analysisStateLabel(entry: CalendarEntry): string {
  if (entry.importState === "source_updated") return "源会话已更新";
  return ({
    none: entry.importState === "not_imported" ? "未导入" : "未分析",
    ready: "已分析",
    partial: "部分完成",
    failed: "分析失败",
  } as const)[entry.analysisState];
}

export function calendarEntryAction(entry: CalendarEntry):
  | "preview"
  | "open_atlas"
  | "analyze"
  | "preview_update"
  | "unavailable" {
  if (entry.sourceState === "missing" && entry.importState !== "imported_current") return "unavailable";
  if (entry.importState === "source_updated") return "preview_update";
  if (entry.importState === "not_imported") return entry.sourceState === "missing" ? "unavailable" : "preview";
  if (entry.analysisState === "ready" || entry.analysisState === "partial") return "open_atlas";
  return "analyze";
}
