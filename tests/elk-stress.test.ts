import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import { MAX_VISIBLE_GRAPH_NODES } from "../src/domain";

describe("300-unit graph budget", () => {
  it("keeps the default view at 120 nodes and completes the ELK target under three seconds", async () => {
    const nodes = Array.from({ length: 300 }, (_, index) => ({
      id: `stress-${index + 1}`,
      width: index % 9 === 0 ? 230 : 190,
      height: index % 7 === 0 ? 110 : 82,
    }));
    const edges = nodes.slice(1).map((node, index) => ({
      id: `edge-${index + 1}`,
      sources: [nodes[index].id],
      targets: [node.id],
    }));
    const started = performance.now();
    const result = await new ELK().layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.layered.cycleBreaking.strategy": "GREEDY",
        "elk.edgeRouting": "SPLINES",
      },
      children: nodes,
      edges,
    });
    const elapsed = performance.now() - started;

    expect(nodes.slice(0, MAX_VISIBLE_GRAPH_NODES)).toHaveLength(120);
    expect(result.children).toHaveLength(300);
    expect(elapsed).toBeLessThan(3_000);
  }, 5_000);
});
