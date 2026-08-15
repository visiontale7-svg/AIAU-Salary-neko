import type { PublicPoint } from "@dialogue-atlas/relay-contract";
import type { AtlasGraphModel } from "./types";

export const ATLAS_NODE_WIDTH = 216;
export const ATLAS_NODE_HEIGHT = 112;

const COLUMN_GAP = 92;
const ROW_GAP = 58;
const PADDING_X = 76;
const PADDING_Y = 94;

function isFinitePoint(point: PublicPoint | undefined): point is PublicPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

export function buildAtlasLayout(graph: AtlasGraphModel): Record<string, PublicPoint> {
  const modeIndex = new Map(graph.modes.map((mode, index) => [mode.id, index]));
  const occupiedRows = new Map<number, number>();
  const result: Record<string, PublicPoint> = {};

  const orderedNodes = [...graph.nodes].sort((left, right) => {
    const leftMode = modeIndex.get(left.modeIds[0] ?? "") ?? graph.modes.length;
    const rightMode = modeIndex.get(right.modeIds[0] ?? "") ?? graph.modes.length;
    return leftMode - rightMode || Number(right.primary) - Number(left.primary) || left.id.localeCompare(right.id);
  });

  for (const node of orderedNodes) {
    const column = modeIndex.get(node.modeIds[0] ?? "") ?? graph.modes.length;
    const existing = graph.layout[node.id];
    if (isFinitePoint(existing)) {
      result[node.id] = { ...existing };
      occupiedRows.set(column, (occupiedRows.get(column) ?? 0) + 1);
      continue;
    }

    const row = occupiedRows.get(column) ?? 0;
    occupiedRows.set(column, row + 1);
    result[node.id] = {
      x: PADDING_X + column * (ATLAS_NODE_WIDTH + COLUMN_GAP),
      y: PADDING_Y + row * (ATLAS_NODE_HEIGHT + ROW_GAP),
    };
  }

  return result;
}

export interface AtlasViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function atlasViewBox(layout: Readonly<Record<string, PublicPoint>>): AtlasViewBox {
  const positions = Object.values(layout).filter(isFinitePoint);
  if (positions.length === 0) return { x: 0, y: 0, width: 760, height: 520 };

  const minX = Math.min(...positions.map((point) => point.x)) - PADDING_X;
  const minY = Math.min(...positions.map((point) => point.y)) - PADDING_Y;
  const maxX = Math.max(...positions.map((point) => point.x + ATLAS_NODE_WIDTH)) + PADDING_X;
  const maxY = Math.max(...positions.map((point) => point.y + ATLAS_NODE_HEIGHT)) + PADDING_Y;
  return {
    x: minX,
    y: minY,
    width: Math.max(760, maxX - minX),
    height: Math.max(520, maxY - minY),
  };
}

export function nextTeamNodePosition(layout: Readonly<Record<string, PublicPoint>>): PublicPoint {
  const positions = Object.values(layout).filter(isFinitePoint);
  if (positions.length === 0) return { x: PADDING_X, y: PADDING_Y };
  const rightmost = Math.max(...positions.map((point) => point.x));
  const atRight = positions.filter((point) => Math.abs(point.x - rightmost) < 2);
  return {
    x: rightmost,
    y: Math.max(...atRight.map((point) => point.y)) + ATLAS_NODE_HEIGHT + ROW_GAP,
  };
}
