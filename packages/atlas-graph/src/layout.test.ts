import { describe, expect, it } from "vitest";
import type { AtlasGraphModel } from "./types";
import { atlasViewBox, buildAtlasLayout } from "./layout";

const graph: AtlasGraphModel = {
  modes: [
    { id: "m001", kind: "explore", label: "Explore", color: "#448", memberNodeIds: ["n001"] },
    { id: "m002", kind: "decide", label: "Decide", color: "#884", memberNodeIds: ["n002"] },
  ],
  nodes: [
    { id: "n002", origin: "source", label: "Decision", kind: "decision", acts: [], modeIds: ["m002"], evidenceIds: [], importance: 1, primary: true },
    { id: "n001", origin: "source", label: "Question", kind: "anchor", acts: [], modeIds: ["m001"], evidenceIds: [], importance: 1, primary: true },
  ],
  edges: [],
  layout: { n001: { x: 42, y: 84 } },
};

describe("buildAtlasLayout", () => {
  it("preserves supplied coordinates and deterministically places missing nodes", () => {
    const first = buildAtlasLayout(graph);
    const second = buildAtlasLayout(graph);
    expect(first.n001).toEqual({ x: 42, y: 84 });
    expect(first.n002).toEqual(second.n002);
    expect(Number.isFinite(first.n002?.x)).toBe(true);
  });

  it("returns a minimum usable view box", () => {
    expect(atlasViewBox(buildAtlasLayout(graph))).toMatchObject({ width: 760, height: 520 });
  });

  it("places a missing team node after existing nodes in the same region", () => {
    const withTeam: AtlasGraphModel = {
      ...graph,
      nodes: [...graph.nodes, { id: "team_1", origin: "team", label: "Follow up", kind: "action", acts: [], modeIds: ["m002"], evidenceIds: [], importance: 0.5, primary: false }],
    };
    const layout = buildAtlasLayout(withTeam);
    expect(layout.team_1?.y).toBeGreaterThan(layout.n002?.y ?? 0);
  });
});
