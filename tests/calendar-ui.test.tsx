import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalendarView } from "../src/calendar/CalendarView";
import { DEMO_CALENDAR_ENTRIES, DEMO_UNDATED_CALENDAR_ENTRIES } from "../src/calendar/demoCalendar";
import { B5_SNAPSHOT } from "../src/fixtures/b5";
import { useAtlasStore } from "../src/store";

beforeEach(() => {
  useAtlasStore.setState({
    snapshot: structuredClone(B5_SNAPSHOT),
    primaryView: "calendar",
    calendarMode: "month",
    calendarAnchorDate: "2026-08-12",
    calendarEntries: structuredClone(DEMO_CALENDAR_ENTRIES),
    undatedCalendarEntries: structuredClone(DEMO_UNDATED_CALENDAR_ENTRIES),
    selectedCalendarEntryId: null,
    selectedCalendarDate: null,
    calendarLoading: false,
    toast: null,
  });
});

afterEach(() => cleanup());

describe("calendar presentation", () => {
  it("renders 42 month cells and keeps only three cards before the overflow affordance", () => {
    const originalLayout = structuredClone(useAtlasStore.getState().snapshot.layout);
    render(<CalendarView refreshCalendar={() => undefined} />);

    expect(screen.getAllByRole("group", { name: /周[日一二三四五六]，\d+ 段对话/ })).toHaveLength(42);
    const august12 = screen.getByRole("group", { name: "8月12日 · 周三，4 段对话" });
    expect(august12.querySelectorAll(".month-entry-card")).toHaveLength(3);
    fireEvent.click(within(august12).getByRole("button", { name: "+1 段对话" }));
    expect(screen.getByLabelText("当日全部对话")).toBeVisible();
    expect(within(screen.getByLabelText("当日全部对话")).getAllByRole("button")).toHaveLength(4);
    expect(useAtlasStore.getState().snapshot.layout).toEqual(originalLayout);
  });

  it("renders a three-entry time cluster and exposes exact times in the detail list", () => {
    useAtlasStore.setState({ calendarMode: "week" });
    render(<CalendarView refreshCalendar={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /^3 段对话/ }));
    const list = screen.getByLabelText("当日全部对话");
    expect(within(list).getByText("15:20")).toBeVisible();
    expect(within(list).getByText("15:34")).toBeVisible();
    expect(within(list).getByText("15:47")).toBeVisible();
    expect(screen.getByText("卡片高度≠对话时长", { selector: ".calendar-explanation p" })).toBeVisible();
  });

  it("keeps undated exports outside date cells", () => {
    useAtlasStore.getState().selectCalendarDate("undated");
    render(<CalendarView refreshCalendar={() => undefined} />);

    expect(screen.getByText("日期未知", { selector: ".calendar-detail header span" })).toBeVisible();
    expect(screen.getByText("可见对话导出（无消息时间）")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /可见对话导出（无消息时间）/ }));
    expect(screen.getByText(/本地导入记录 · 最后一条可见消息/)).toBeVisible();
    expect(screen.getByText(/不会回退到导入日/)).toBeVisible();
  });

  it("lists immutable import versions and opens an analyzed historical snapshot", async () => {
    render(<CalendarView refreshCalendar={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /Windows 交接包整理/ }));
    const history = await screen.findByLabelText("导入历史版本");
    expect(within(history).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(within(history).getByRole("button", { name: /历史版本 1/ }));

    await waitFor(() => expect(useAtlasStore.getState().primaryView).toBe("atlas"));
    expect(useAtlasStore.getState().snapshot.conversation.title).toBe("B5 固定示例对话");
  });
});
