import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const elkMock = vi.hoisted(() => ({
  mode: "resolve" as "resolve" | "reject" | "pending" | "worker-throw" | "elk-throw",
  terminated: 0,
}));

vi.mock("elkjs/lib/elk-worker.min.js?worker", () => ({
  default: class MockElkWorker {
    constructor() {
      if (elkMock.mode === "worker-throw") throw new Error("worker startup details");
    }
  },
}));

vi.mock("elkjs/lib/elk-api.js", () => ({
  default: class MockElk {
    constructor(options: { workerFactory: () => unknown }) {
      if (elkMock.mode === "elk-throw") throw new Error("ELK startup details");
      options.workerFactory();
    }

    layout() {
      if (elkMock.mode === "reject") return Promise.reject(new Error("raw layout details"));
      if (elkMock.mode === "pending") return new Promise(() => undefined);
      return Promise.resolve({
        children: [
          { id: "a", x: 72, y: 72 },
          { id: "b", x: 410, y: 72 },
        ],
      });
    }

    terminateWorker() {
      elkMock.terminated += 1;
    }
  },
}));

import { runElkLayout, type LayoutNode } from "../src/graph/layout";

const nodes: LayoutNode[] = [
  { id: "a", width: 200, height: 90 },
  { id: "b", width: 200, height: 90 },
];
const edges = [{ id: "a-b", source: "a", target: "b" }];
const fallback = {
  a: { x: 60, y: 70 },
  b: { x: 345, y: 70 },
};

beforeEach(() => {
  vi.stubGlobal("Worker", class Worker {});
  elkMock.mode = "resolve";
  elkMock.terminated = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runElkLayout", () => {
  it("uses the direct ELK worker result and terminates it", async () => {
    await expect(runElkLayout(nodes, edges)).resolves.toEqual({
      a: { x: 72, y: 72 },
      b: { x: 410, y: 72 },
    });
    expect(elkMock.terminated).toBe(1);
  });

  it.each(["worker-throw", "elk-throw", "reject"] as const)(
    "resolves the deterministic fallback for %s failures",
    async (mode) => {
      elkMock.mode = mode;
      await expect(runElkLayout(nodes, edges)).resolves.toEqual(fallback);
    },
  );

  it("resolves the deterministic fallback after a timeout", async () => {
    vi.useFakeTimers();
    elkMock.mode = "pending";

    const result = runElkLayout(nodes, edges);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual(fallback);
    expect(elkMock.terminated).toBe(1);
  });
});
