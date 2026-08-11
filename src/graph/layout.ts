/// <reference types="vite/client" />

import ELK, { type ELK as ElkInstance } from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";
import type { LayoutItem } from "../domain";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  pinned?: boolean;
  x?: number;
  y?: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

const LAYOUT_TIMEOUT_MS = 10_000;

const fallbackLayout = (nodes: LayoutNode[]): Record<string, LayoutItem> =>
  Object.fromEntries(
    nodes.map((node, index) => [
      node.id,
      {
        x: 60 + (index % 6) * 285,
        y: 70 + Math.floor(index / 6) * 145,
      },
    ]),
  );

function completeLayout(
  nodes: LayoutNode[],
  children: Array<{ id: string; x?: number; y?: number }> | undefined,
): Record<string, LayoutItem> | null {
  const positions = Object.fromEntries(
    (children ?? []).map((node) => [node.id, { x: node.x, y: node.y }]),
  );
  if (
    !nodes.every((node) => {
      const position = positions[node.id];
      return position && Number.isFinite(position.x) && Number.isFinite(position.y);
    })
  ) {
    return null;
  }
  return positions as Record<string, LayoutItem>;
}

export async function runElkLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Promise<Record<string, LayoutItem>> {
  const fallback = fallbackLayout(nodes);
  if (nodes.length === 0 || typeof Worker === "undefined") return fallback;

  let elk: ElkInstance | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    elk = new ELK({
      algorithms: ["layered"],
      workerFactory: () => new ElkWorker(),
    });
    const graph = await Promise.race([
      elk.layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "44",
          "elk.layered.spacing.nodeNodeBetweenLayers": "88",
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
          "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
          "elk.layered.cycleBreaking.strategy": "GREEDY",
          "elk.edgeRouting": "SPLINES",
          "elk.padding": "[top=72,left=72,bottom=72,right=72]",
        },
        children: nodes.map((node) => ({
          id: node.id,
          width: node.width,
          height: node.height,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("ELK layout timed out")), LAYOUT_TIMEOUT_MS);
      }),
    ]);
    return completeLayout(nodes, graph.children) ?? fallback;
  } catch {
    return fallback;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    try {
      elk?.terminateWorker();
    } catch {
      // Termination is best-effort after a worker startup/runtime failure.
    }
  }
}
