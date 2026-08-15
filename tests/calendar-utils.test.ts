import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "../src/domain";
import {
  addCalendarDays,
  calendarEntryAction,
  calendarQueryFor,
  clusterWeekEntries,
  monthGridDates,
  tokyoDateKey,
  tokyoMinuteOfDay,
  shiftCalendarAnchor,
  weekDates,
} from "../src/calendar/calendarUtils";

const entry = (id: string, iso: string): CalendarEntry => ({
  id,
  title: id,
  lastActivityAt: iso,
  lastCompletedTurnAt: iso,
  completionState: "completed",
  sourceState: "active",
  importState: "not_imported",
  analysisState: "none",
  importedVersionCount: 0,
  snapshotCount: 0,
});

describe("calendar date contract", () => {
  it("uses a Sunday-first fixed 42-cell month grid", () => {
    const dates = monthGridDates("2026-08-12");
    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe("2026-07-26");
    expect(dates.at(-1)).toBe("2026-09-05");
    expect(calendarQueryFor("2026-08-12", "month")).toEqual({
      startDate: "2026-07-26",
      endDateExclusive: "2026-09-06",
      timeZone: "Asia/Tokyo",
    });
  });

  it("uses Sunday as the week boundary without relying on the host timezone", () => {
    expect(weekDates("2026-08-12")).toEqual([
      "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12",
      "2026-08-13", "2026-08-14", "2026-08-15",
    ]);
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("moves between calendar months without end-of-month overflow", () => {
    expect(shiftCalendarAnchor("2026-01-31", "month", 1)).toBe("2026-02-01");
    expect(shiftCalendarAnchor("2026-03-31", "month", -1)).toBe("2026-02-01");
  });

  it("places UTC source times using Tokyo calendar date and minute", () => {
    expect(tokyoDateKey("2026-08-08T15:30:00.000Z")).toBe("2026-08-09");
    expect(tokyoMinuteOfDay("2026-08-08T15:30:00.000Z")).toBe(30);
  });
});

describe("week density and state actions", () => {
  it("keeps one or two entries separate and clusters three entries inside 45 minutes", () => {
    const values = [
      entry("one", "2026-08-12T06:10:00.000Z"),
      entry("two", "2026-08-12T06:25:00.000Z"),
      entry("three", "2026-08-12T06:44:00.000Z"),
      entry("four", "2026-08-12T07:10:00.000Z"),
      entry("other-day", "2026-08-13T06:20:00.000Z"),
    ];
    const clusters = clusterWeekEntries(values);
    expect(clusters.map((cluster) => cluster.entries.map(({ id }) => id))).toEqual([
      ["one", "two", "three"],
      ["four"],
      ["other-day"],
    ]);
  });

  it("derives the exact allowed action without silently changing providers", () => {
    expect(calendarEntryAction(entry("preview", "2026-08-12T06:10:00.000Z"))).toBe("preview");
    expect(calendarEntryAction({
      ...entry("updated", "2026-08-12T06:10:00.000Z"),
      importState: "source_updated",
      analysisState: "ready",
    })).toBe("preview_update");
    expect(calendarEntryAction({
      ...entry("ready", "2026-08-12T06:10:00.000Z"),
      importState: "imported_current",
      analysisState: "ready",
      latestConversationId: "conversation-1",
    })).toBe("open_atlas");
  });
});
