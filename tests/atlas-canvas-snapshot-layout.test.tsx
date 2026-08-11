import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasSnapshot, SemanticUnit } from "../src/domain";
import { B5_SNAPSHOT } from "../src/fixtures/b5";

const mocks = vi.hoisted(() => ({
  runElkLayout: vi.fn(),
  saveLayout: vi.fn().mockResolvedValue(undefined),
  fitView: vi.fn().mockResolvedValue(undefined),
  setViewport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  MiniMap: () => null,
  ReactFlow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  useReactFlow: () => ({ fitView: mocks.fitView, setViewport: mocks.setViewport }),
}));

vi.mock("../src/components/DialogueNode", () => ({ DialogueNode: () => null }));
vi.mock("../src/components/RelationEdge", () => ({ RelationEdge: () => null }));
vi.mock("../src/components/ModeIslands", () => ({ ModeIslands: () => null }));
vi.mock("../src/graph/layout", () => ({
  runElkLayout: (...args: unknown[]) => mocks.runElkLayout(...args),
}));
vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return {
    ...actual,
    atlasIpc: {
      ...actual.atlasIpc,
      mode: "tauri" as const,
      saveLayout: mocks.saveLayout,
    },
  };
});

import { AtlasCanvas } from "../src/components/AtlasCanvas";
import { useAtlasStore } from "../src/store";

function realSnapshot(id: string, unitIds: string[], withLayout = false): AtlasSnapshot {
  const baseUnits = B5_SNAPSHOT.units.filter((unit) => !unit.secondary);
  const units = unitIds.map((unitId, index) => ({
    ...structuredClone(baseUnits[index]),
    id: unitId,
    turnId: `turn-${unitId}`,
    turnOrdinal: index + 1,
    modeIds: [],
  })) as SemanticUnit[];
  return {
    ...structuredClone(B5_SNAPSHOT),
    id,
    conversation: {
      ...B5_SNAPSHOT.conversation,
      id: `conversation-${id}`,
      title: id,
      turns: units.length,
      totalUnits: units.length,
      expandedUnits: units.length,
      hiddenUnits: 0,
    },
    units,
    relations: [],
    modes: [],
    layout: withLayout
      ? Object.fromEntries(unitIds.map((unitId, index) => [
        unitId,
        { x: 80 + index * 260, y: 120, pinned: false },
      ]))
      : {},
    viewport: undefined,
    showModeIslands: true,
  };
}

function positionsFor(nodes: Array<{ id: string }>) {
  return Object.fromEntries(nodes.map((node, index) => [
    node.id,
    { x: 100 + index * 280, y: 160 },
  ]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runElkLayout.mockImplementation(async (nodes) => positionsFor(nodes));
  useAtlasStore.getState().setSnapshot(structuredClone(B5_SNAPSHOT));
});

afterEach(() => {
  cleanup();
  useAtlasStore.getState().setSnapshot(structuredClone(B5_SNAPSHOT));
});

describe("AtlasCanvas snapshot-safe layout", () => {
  it("never sends the initial demo node IDs when a real empty-layout snapshot arrives", async () => {
    render(<AtlasCanvas />);
    const real = realSnapshot("real-snapshot", ["real-u1", "real-u2"]);

    act(() => useAtlasStore.getState().setSnapshot(real));

    await waitFor(() => expect(mocks.runElkLayout).toHaveBeenCalledTimes(1));
    const inputIds = mocks.runElkLayout.mock.calls[0][0].map((node: { id: string }) => node.id);
    expect(inputIds).toEqual(["real-u1", "real-u2"]);
    await waitFor(() => expect(mocks.saveLayout).toHaveBeenCalled());
    expect(mocks.saveLayout).toHaveBeenLastCalledWith(
      "real-snapshot",
      expect.objectContaining({
        "real-u1": expect.any(Object),
        "real-u2": expect.any(Object),
      }),
      undefined,
      true,
    );
  });

  it("discards an old worker result after the active snapshot changes", async () => {
    let resolveOld: ((value: Record<string, { x: number; y: number }>) => void) | undefined;
    mocks.runElkLayout.mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve;
    }));
    render(<AtlasCanvas />);

    act(() => useAtlasStore.getState().setSnapshot(
      realSnapshot("old-snapshot", ["old-u1", "old-u2"]),
    ));
    await waitFor(() => expect(mocks.runElkLayout).toHaveBeenCalledTimes(1));

    const current = realSnapshot("current-snapshot", ["current-u1"], true);
    act(() => useAtlasStore.getState().setSnapshot(current));
    act(() => resolveOld?.({
      "old-u1": { x: 10, y: 20 },
      "old-u2": { x: 300, y: 20 },
    }));

    await waitFor(() => expect(useAtlasStore.getState().snapshot.id).toBe("current-snapshot"));
    expect(useAtlasStore.getState().snapshot.layout).toEqual(current.layout);
    expect(mocks.saveLayout).not.toHaveBeenCalledWith(
      "old-snapshot",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
