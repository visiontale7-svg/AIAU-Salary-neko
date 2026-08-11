import { describe, expect, it, vi } from "vitest";
import { createSerializedLayoutSaver } from "../src/ipc";

describe("serialized layout saves", () => {
  it("finishes same-snapshot writes in invocation order", async () => {
    const releases: Array<() => void> = [];
    const completed: Array<number | undefined> = [];
    const rawSave = vi.fn((
      _snapshotId: string,
      layout: Record<string, { x: number; y: number }>,
    ) => new Promise<void>((resolve) => {
      releases.push(() => {
        completed.push(layout.node?.x);
        resolve();
      });
    }));
    const save = createSerializedLayoutSaver(rawSave);

    const stale = save("snapshot-1", {}, { x: 0, y: 0, zoom: 1 });
    const current = save("snapshot-1", { node: { x: 240, y: 80 } });

    await vi.waitFor(() => expect(rawSave).toHaveBeenCalledTimes(1));
    releases[0]();
    await stale;
    await vi.waitFor(() => expect(rawSave).toHaveBeenCalledTimes(2));
    releases[1]();
    await current;

    expect(completed).toEqual([undefined, 240]);
  });

  it("continues with the newest save after an earlier request fails", async () => {
    const rawSave = vi.fn()
      .mockRejectedValueOnce(new Error("first write failed"))
      .mockResolvedValueOnce(undefined);
    const save = createSerializedLayoutSaver(rawSave);

    const first = save("snapshot-1", {});
    const second = save("snapshot-1", { node: { x: 12, y: 34 } });

    await expect(first).rejects.toThrow("first write failed");
    await expect(second).resolves.toBeUndefined();
    expect(rawSave).toHaveBeenCalledTimes(2);
  });
});
