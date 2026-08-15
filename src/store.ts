import { create } from "zustand";
import type {
  AnalysisProgress,
  AnalysisTask,
  AnalysisSettings,
  AtlasRelation,
  AtlasSnapshot,
  CorrectionCommand,
  DialogueAct,
  LayoutItem,
  CalendarEntry,
  CodexIndexStatus,
  RelationType,
  Selection,
} from "./domain";
import { DEFAULT_ANALYSIS_SETTINGS } from "./domain";
import { B5_SNAPSHOT } from "./fixtures/b5";
import { atlasIpc, ipcErrorMessage } from "./ipc";

type Drawer = "none" | "context" | "outline" | "modes" | "review";
export type PrimaryView = "calendar" | "atlas" | "relay";
export type CalendarMode = "month" | "week";

interface AtlasStore {
  snapshot: AtlasSnapshot;
  analysisSettings: AnalysisSettings;
  selection: Selection;
  showModes: boolean;
  showSecondary: boolean;
  showImport: boolean;
  showSettings: boolean;
  showCorrection: boolean;
  showShare: boolean;
  drawer: Drawer;
  search: string;
  progress: AnalysisProgress | null;
  analysisTasks: Record<string, AnalysisTask>;
  focusedAnalysisRunId: string | null;
  toast: string | null;
  primaryView: PrimaryView;
  activeRelayRoomId: string | null;
  activeRelayUrl: string | null;
  calendarMode: CalendarMode;
  calendarAnchorDate: string;
  calendarEntries: CalendarEntry[];
  undatedCalendarEntries: CalendarEntry[];
  selectedCalendarEntryId: string | null;
  selectedCalendarDate: string | null;
  calendarLoading: boolean;
  codexIndexStatus: CodexIndexStatus | null;
  setSnapshot(snapshot: AtlasSnapshot): void;
  setAnalysisSettings(settings: AnalysisSettings): void;
  select(selection: Selection): void;
  toggleModes(): void;
  toggleSecondary(): void;
  setImport(open: boolean): void;
  setSettings(open: boolean): void;
  setCorrection(open: boolean): void;
  setShare(open: boolean): void;
  setDrawer(drawer: Drawer): void;
  setSearch(search: string): void;
  setProgress(progress: AnalysisProgress | null): void;
  registerAnalysisTask(input: { runId: string; conversationId: string; originEntryId?: string; title?: string }): void;
  upsertAnalysisProgress(progress: AnalysisProgress): void;
  markAnalysisStopping(runId: string): void;
  focusAnalysisTask(runId: string | null): void;
  setToast(message: string | null): void;
  setPrimaryView(view: PrimaryView): void;
  openRelayRoom(roomId: string, relayUrl: string): void;
  setCalendarMode(mode: CalendarMode): void;
  setCalendarAnchorDate(date: string): void;
  setCalendarEntries(entries: CalendarEntry[]): void;
  setUndatedCalendarEntries(entries: CalendarEntry[]): void;
  selectCalendarEntry(entryId: string | null, date?: string | null): void;
  selectCalendarDate(date: string | null): void;
  setCalendarLoading(loading: boolean): void;
  setCodexIndexStatus(status: CodexIndexStatus | null): void;
  moveNode(unitId: string, position: { x: number; y: number }, pinned?: boolean): void;
  replaceLayout(layout: Record<string, LayoutItem>): void;
  setViewport(viewport: { x: number; y: number; zoom: number }): void;
  updateUnit(unitId: string, label: string, acts: DialogueAct[], modeIds: string[]): void;
  updateRelation(relationId: string, type: RelationType, label?: string): void;
  updateMode(modeId: string, label: string): void;
  deleteRelation(relationId: string): void;
  addRelation(relation: AtlasRelation): void;
  applyCorrection(command: CorrectionCommand): Promise<void>;
  resetItemToModel(itemId: string): Promise<void>;
  resetDemo(): void;
}

const cloneFixture = () => structuredClone(B5_SNAPSHOT);

const DEMO_SNAPSHOT_KEY = "dialogue-atlas-demo-snapshot-v1";

function loadInitialSnapshot(): AtlasSnapshot {
  if (atlasIpc.mode !== "browser-demo" || typeof window === "undefined") {
    const demo = cloneFixture();
    demo.conversation = {
      ...demo.conversation,
      title: "B5 示例 · 请导入真实对话",
      sourceKind: "demo",
    };
    return demo;
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("reset") === "1") {
    window.localStorage?.removeItem(DEMO_SNAPSHOT_KEY);
    url.searchParams.delete("reset");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return cloneFixture();
  }
  const stored = window.localStorage?.getItem(DEMO_SNAPSHOT_KEY);
  if (!stored) return cloneFixture();
  try {
    return JSON.parse(stored) as AtlasSnapshot;
  } catch {
    window.localStorage?.removeItem(DEMO_SNAPSHOT_KEY);
    return cloneFixture();
  }
}

const initialSnapshot = loadInitialSnapshot();

function tokyoToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function initialPrimaryView(): PrimaryView {
  if (typeof window === "undefined") return "calendar";
  const query = new URL(window.location.href).searchParams;
  // Keep the approved B5 graph fixture address stable for visual regression;
  // every normal desktop launch still enters the calendar.
  return query.get("fixture") === "b5" && query.get("view") !== "calendar" ? "atlas" : "calendar";
}

function initialCalendarDate(): string {
  if (typeof window !== "undefined") {
    const query = new URL(window.location.href).searchParams;
    if (query.get("fixture") === "calendar") return "2026-08-12";
  }
  return tokyoToday();
}

export const useAtlasStore = create<AtlasStore>((set, get) => ({
  snapshot: initialSnapshot,
  analysisSettings: { ...DEFAULT_ANALYSIS_SETTINGS },
  selection: { kind: "edge", id: "R28" },
  showModes: initialSnapshot.showModeIslands ?? true,
  showSecondary: false,
  showImport: false,
  showSettings: false,
  showCorrection: false,
  showShare: false,
  drawer: "none",
  search: "",
  progress: null,
  analysisTasks: {},
  focusedAnalysisRunId: null,
  toast: null,
  primaryView: initialPrimaryView(),
  activeRelayRoomId: null,
  activeRelayUrl: null,
  calendarMode: "month",
  calendarAnchorDate: initialCalendarDate(),
  calendarEntries: [],
  undatedCalendarEntries: [],
  selectedCalendarEntryId: null,
  selectedCalendarDate: null,
  calendarLoading: false,
  codexIndexStatus: null,

  setSnapshot: (snapshot) => set({
    snapshot,
    selection: null,
    showSecondary: false,
    showModes: snapshot.showModeIslands ?? true,
  }),
  setAnalysisSettings: (analysisSettings) => set({ analysisSettings }),
  select: (selection) => set({ selection }),
  toggleModes: () => set((state) => {
    const showModes = !state.showModes;
    void atlasIpc.saveLayout(
      state.snapshot.id,
      state.snapshot.layout,
      state.snapshot.viewport,
      showModes,
    ).catch(() => undefined);
    return {
      showModes,
      snapshot: { ...state.snapshot, showModeIslands: showModes },
    };
  }),
  toggleSecondary: () => set((state) => ({ showSecondary: !state.showSecondary })),
  setImport: (showImport) => set({ showImport }),
  setSettings: (showSettings) => set({ showSettings }),
  setCorrection: (showCorrection) => set({ showCorrection }),
  setShare: (showShare) => set({ showShare }),
  setDrawer: (drawer) => set({ drawer }),
  setSearch: (search) => set({ search }),
  setProgress: (progress) => set({ progress }),
  registerAnalysisTask: (input) => set((state) => {
    const now = new Date().toISOString();
    const existing = state.analysisTasks[input.runId];
    const progress = existing?.progress ?? {
      runId: input.runId,
      conversationId: input.conversationId,
      stage: "parsing",
      completed: 0,
      total: 7,
      message: "分析任务已启动",
    };
    return {
      progress,
      analysisTasks: {
        ...state.analysisTasks,
        [input.runId]: {
          runId: input.runId,
          conversationId: input.conversationId,
          originEntryId: input.originEntryId ?? existing?.originEntryId,
          title: input.title ?? existing?.title,
          status: existing?.status ?? "running",
          progress,
          startedAt: existing?.startedAt ?? now,
          updatedAt: now,
        },
      },
    };
  }),
  upsertAnalysisProgress: (progress) => set((state) => {
    const now = new Date().toISOString();
    const existing = state.analysisTasks[progress.runId];
    const terminal = ["ready", "partial", "failed", "cancelled"].includes(progress.stage);
    return {
      progress,
      analysisTasks: {
        ...state.analysisTasks,
        [progress.runId]: {
          runId: progress.runId,
          conversationId: progress.conversationId,
          originEntryId: existing?.originEntryId,
          title: existing?.title,
          status: terminal ? progress.stage as AnalysisTask["status"] : existing?.status === "stopping" ? "stopping" : "running",
          progress,
          startedAt: existing?.startedAt ?? now,
          updatedAt: now,
        },
      },
    };
  }),
  markAnalysisStopping: (runId) => set((state) => {
    const task = state.analysisTasks[runId];
    if (!task || ["ready", "partial", "failed", "cancelled"].includes(task.status)) return state;
    const progress = { ...task.progress, message: "正在停止分析；已发出的远程请求仍可能产生用量" };
    return {
      progress,
      analysisTasks: {
        ...state.analysisTasks,
        [runId]: { ...task, status: "stopping", progress, updatedAt: new Date().toISOString() },
      },
    };
  }),
  focusAnalysisTask: (focusedAnalysisRunId) => set({ focusedAnalysisRunId }),
  setToast: (toast) => {
    set({ toast });
    if (toast) window.setTimeout(() => set({ toast: null }), 2600);
  },
  setPrimaryView: (primaryView) => set({ primaryView }),
  openRelayRoom: (activeRelayRoomId, activeRelayUrl) => set({
    activeRelayRoomId,
    activeRelayUrl,
    primaryView: "relay",
    showShare: false,
  }),
  setCalendarMode: (calendarMode) => set({ calendarMode }),
  setCalendarAnchorDate: (calendarAnchorDate) => set({
    calendarAnchorDate,
    selectedCalendarEntryId: null,
    selectedCalendarDate: null,
  }),
  setCalendarEntries: (calendarEntries) => set({ calendarEntries }),
  setUndatedCalendarEntries: (undatedCalendarEntries) => set({ undatedCalendarEntries }),
  selectCalendarEntry: (selectedCalendarEntryId, date) => set((state) => ({
    selectedCalendarEntryId,
    selectedCalendarDate: date === undefined ? state.selectedCalendarDate : date,
  })),
  selectCalendarDate: (selectedCalendarDate) => set({
    selectedCalendarDate,
    selectedCalendarEntryId: null,
  }),
  setCalendarLoading: (calendarLoading) => set({ calendarLoading }),
  setCodexIndexStatus: (codexIndexStatus) => set({ codexIndexStatus }),

  moveNode: (unitId, position, pinned = true) =>
    set((state) => {
      if (!state.snapshot.units.some((unit) => unit.id === unitId)) return state;
      return {
        snapshot: {
          ...state.snapshot,
          layout: {
            ...state.snapshot.layout,
            [unitId]: { ...position, pinned },
          },
        },
      };
    }),

  replaceLayout: (layout) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        layout: {
          ...layout,
          ...Object.fromEntries(
            Object.entries(state.snapshot.layout).filter(([, value]) => value.pinned),
          ),
        },
      },
    })),

  setViewport: (viewport) => set((state) => {
    // Persist from the current store state. React Flow can emit onMoveEnd after
    // an async relayout, when a component closure still holds the pre-layout
    // snapshot; saving that stale value would erase every computed position.
    void atlasIpc.saveLayout(
      state.snapshot.id,
      state.snapshot.layout,
      viewport,
      state.showModes,
    ).catch(() => undefined);
    return {
      snapshot: { ...state.snapshot, viewport },
    };
  }),

  updateUnit: (unitId, label, acts, modeIds) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        units: state.snapshot.units.map((unit) =>
          unit.id === unitId ? { ...unit, label, acts, modeIds, provenance: "user" } : unit,
        ),
      },
    })),

  updateRelation: (relationId, type, label) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        relations: state.snapshot.relations.map((relation) =>
          relation.id === relationId
            ? { ...relation, type, label: label || type, provenance: "user" }
            : relation,
        ),
      },
    })),

  updateMode: (modeId, label) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        modes: state.snapshot.modes.map((mode) =>
          mode.id === modeId ? { ...mode, label } : mode,
        ),
      },
    })),

  deleteRelation: (relationId) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        relations: state.snapshot.relations.filter((relation) => relation.id !== relationId),
      },
      selection: null,
    })),

  addRelation: (relation) =>
    set((state) => ({
      snapshot: {
        ...state.snapshot,
        relations: [...state.snapshot.relations, relation],
      },
    })),

  applyCorrection: async (command) => {
    const state = get();
    if (command.kind === "update_unit") {
      state.updateUnit(command.unitId, command.label, command.acts, command.modeIds);
    } else if (command.kind === "update_relation") {
      state.updateRelation(command.relationId, command.type, command.label);
    } else if (command.kind === "delete_relation") {
      state.deleteRelation(command.relationId);
    } else if (command.kind === "add_relation") {
      state.addRelation(command.relation);
    } else if (command.kind === "update_mode") {
      state.updateMode(command.modeId, command.label);
    } else if (command.kind === "move_node") {
      state.moveNode(command.unitId, command.position, command.pinned);
    }
    try {
      await atlasIpc.applyCorrection(state.snapshot.id, command);
      get().setToast(state.snapshot.provider === "fixture"
        ? "纠正已记录；固定示例标注保持不变"
        : "纠正已记录；原始 AI 快照保持不变");
    } catch (error) {
      get().setToast(`本地已应用，持久化失败：${ipcErrorMessage(error, "未知错误")}`);
    }
  },

  resetItemToModel: async (itemId) => {
    const current = get();
    try {
      await atlasIpc.resetItemToModel(current.snapshot.id, itemId);
      if (atlasIpc.mode === "tauri") {
        const snapshot = await atlasIpc.getSnapshot(current.snapshot.conversation.id);
        set({ snapshot, selection: snapshot.units.some((unit) => unit.id === itemId)
          ? { kind: "node", id: itemId }
          : snapshot.relations.some((relation) => relation.id === itemId)
            ? { kind: "edge", id: itemId }
            : null });
      } else {
        const base = cloneFixture();
        set((state) => {
          const baseUnit = base.units.find((unit) => unit.id === itemId);
          const baseRelation = base.relations.find((relation) => relation.id === itemId);
          const baseMode = base.modes.find((mode) => mode.id === itemId);
          return {
            snapshot: {
              ...state.snapshot,
              units: baseUnit
                ? state.snapshot.units.map((unit) => unit.id === itemId ? baseUnit : unit)
                : state.snapshot.units,
              relations: baseRelation
                ? state.snapshot.relations.map((relation) => relation.id === itemId ? baseRelation : relation)
                : state.snapshot.relations.filter((relation) => relation.id !== itemId),
              modes: baseMode
                ? state.snapshot.modes.map((mode) => mode.id === itemId ? baseMode : mode)
                : state.snapshot.modes,
            },
            selection: baseRelation || baseUnit ? state.selection : null,
          };
        });
      }
      get().setToast(current.snapshot.provider === "fixture"
        ? "已追加恢复事件；该项目与示例基础标注一致"
        : "已追加恢复事件；该项目与 AI 基础快照一致");
    } catch (error) {
      get().setToast(`无法恢复：${ipcErrorMessage(error, "未知错误")}`);
    }
  },

  resetDemo: () =>
    set({
      snapshot: cloneFixture(),
      selection: { kind: "edge", id: "R28" },
      showModes: true,
      showSecondary: false,
      search: "",
      drawer: "none",
    }),
}));

if (atlasIpc.mode === "browser-demo" && typeof window !== "undefined" && window.localStorage) {
  useAtlasStore.subscribe((state) => {
    window.localStorage.setItem(DEMO_SNAPSHOT_KEY, JSON.stringify(state.snapshot));
  });
}
