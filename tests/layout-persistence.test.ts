import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  mode: "tauri" as const,
  saveLayout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return { ...actual, atlasIpc: ipcMock };
});

import { B5_SNAPSHOT } from "../src/fixtures/b5";
import { useAtlasStore } from "../src/store";

describe("layout persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAtlasStore.getState().setSnapshot(structuredClone(B5_SNAPSHOT));
  });

  it("persists the latest node positions when a post-layout viewport event arrives", () => {
    const computed = {
      U01: { x: 123, y: 456, pinned: false },
      A01: { x: 789, y: 321, pinned: true },
    };
    const viewport = { x: -18, y: 42, zoom: 0.84 };

    useAtlasStore.getState().replaceLayout(computed);
    useAtlasStore.getState().setViewport(viewport);

    expect(ipcMock.saveLayout).toHaveBeenCalledTimes(1);
    expect(ipcMock.saveLayout).toHaveBeenCalledWith(
      B5_SNAPSHOT.id,
      expect.objectContaining(computed),
      viewport,
      true,
    );
    expect(useAtlasStore.getState().snapshot.layout).toEqual(
      expect.objectContaining(computed),
    );
  });

  it("ignores a drag-stop event from a node belonging to a previous snapshot", () => {
    const before = structuredClone(useAtlasStore.getState().snapshot.layout);

    useAtlasStore.getState().moveNode("node-from-previous-snapshot", { x: 9, y: 12 });

    expect(useAtlasStore.getState().snapshot.layout).toEqual(before);
    expect(ipcMock.saveLayout).not.toHaveBeenCalled();
  });
});
