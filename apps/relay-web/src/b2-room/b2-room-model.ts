import { buildRoomGraph, type RelayReadyRoomModel } from "@dialogue-atlas/relay-room";
import type { AtlasGraphEdge, AtlasGraphNode } from "@dialogue-atlas/atlas-graph";
import type { HaloAssetKey } from "../b2-visual/halo-assets";
import type { StarOpticsSpec, Tone } from "../b2-visual/StarOptics";

export interface B2RoomStar {
  node: AtlasGraphNode;
  x: number;
  y: number;
  optics: StarOpticsSpec;
  author?: { userId: string; displayName: string; colorKey: string; color: string };
  presence: Array<{ userId: string; displayName: string; color: string }>;
}

export interface B2RoomPath {
  edge: AtlasGraphEdge;
  d: string;
  tone: Tone;
}

export interface B2RoomProjection {
  stars: B2RoomStar[];
  paths: B2RoomPath[];
  toRoomPoint(point: { x: number; y: number }): { x: number; y: number };
}

const SOURCE_ASSETS: HaloAssetKey[] = ["source-blue-v0", "source-blue-v1", "source-blue-v2"];
const TEAM_TONES: Array<{ tone: Tone; assets: [HaloAssetKey, HaloAssetKey] }> = [
  { tone: "violet", assets: ["team-violet-v0", "team-violet-v1"] },
  { tone: "cyan", assets: ["team-cyan-v0", "team-cyan-v1"] },
  { tone: "green", assets: ["team-green-v0", "team-green-v1"] },
  { tone: "orange", assets: ["team-orange-v0", "team-orange-v1"] },
];
const PRESENCE_COLORS = ["#ff9f8f", "#8ed2aa", "#83b8ff", "#cf9cff", "#ffd078"];

export function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function opticsFor(node: AtlasGraphNode, sourceIndex: number, authorColorKey?: string): StarOpticsSpec {
  if (node.origin === "team") {
    const family = TEAM_TONES[stableIndex(authorColorKey ?? node.id, TEAM_TONES.length)]!;
    return {
      family: "team",
      tone: family.tone,
      assetKey: family.assets[stableIndex(`${node.id}:asset`, 2)],
      energy: 2,
      shellRadius: 8,
      coreSize: 4.5,
    };
  }
  if (sourceIndex === 0 || node.kind === "anchor") {
    return { family: "root", tone: "blue", assetKey: "root-blue-v0", energy: 2, shellRadius: 13.5, coreSize: 7 };
  }
  return {
    family: "source",
    tone: "blue",
    assetKey: SOURCE_ASSETS[stableIndex(node.id, SOURCE_ASSETS.length)],
    energy: 2,
    shellRadius: 12.5,
    coreSize: 6,
  };
}

function defaultPoint(index: number, total: number): { x: number; y: number } {
  const columns = Math.max(2, Math.ceil(Math.sqrt(total)));
  const row = Math.floor(index / columns);
  const column = index % columns;
  return { x: column * 260, y: row * 190 };
}

function normalizedPositions(nodes: readonly AtlasGraphNode[], layout: Readonly<Record<string, { x: number; y: number }>>) {
  const raw = nodes.map((node, index) => layout[node.id] ?? defaultPoint(index, nodes.length));
  const minX = Math.min(...raw.map((point) => point.x));
  const maxX = Math.max(...raw.map((point) => point.x));
  const minY = Math.min(...raw.map((point) => point.y));
  const maxY = Math.max(...raw.map((point) => point.y));
  const rangeX = Math.max(1, maxX - minX);
  const rangeY = Math.max(1, maxY - minY);
  const positions = Object.fromEntries(nodes.map((node, index) => {
    const point = raw[index]!;
    return [node.id, {
      x: 110 + ((point.x - minX) / rangeX) * 820,
      y: 180 + ((point.y - minY) / rangeY) * 560,
    }];
  }));
  return {
    positions,
    toRoomPoint(point: { x: number; y: number }) {
      return {
        x: minX + ((point.x - 110) / 820) * rangeX,
        y: minY + ((point.y - 180) / 560) * rangeY,
      };
    },
  };
}

function pathBetween(source: { x: number; y: number }, target: { x: number; y: number }): string {
  const dx = target.x - source.x;
  return `M ${source.x} ${source.y} C ${source.x + dx * .36} ${source.y}, ${target.x - dx * .36} ${target.y}, ${target.x} ${target.y}`;
}

export function buildB2RoomProjection(model: RelayReadyRoomModel): B2RoomProjection {
  const graph = buildRoomGraph(model.bundle);
  const members = new Map(model.bundle.members.map((member) => [member.userId, member]));
  const normalized = normalizedPositions(graph.nodes, {
    ...graph.layout,
    ...(model.dragPreviews ?? {}),
  });
  const positions = normalized.positions;
  let sourceIndex = 0;
  const stars = graph.nodes.map((node) => {
    const currentSourceIndex = node.origin === "source" ? sourceIndex++ : -1;
    const active = model.presence.filter((member) => member.activeNodeId === node.id);
    const authorMember = node.authoredBy ? members.get(node.authoredBy) : undefined;
    const authorColor = authorMember ? PRESENCE_COLORS[stableIndex(authorMember.colorKey, PRESENCE_COLORS.length)]! : undefined;
    return {
      node,
      ...positions[node.id]!,
      optics: opticsFor(node, currentSourceIndex, authorMember?.colorKey),
      author: authorMember && authorColor ? { ...authorMember, color: authorColor } : undefined,
      presence: active.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        color: PRESENCE_COLORS[stableIndex(member.colorKey, PRESENCE_COLORS.length)]!,
      })),
    };
  });
  const paths = graph.edges.flatMap((edge) => {
    const source = positions[edge.source];
    const target = positions[edge.target];
    if (!source || !target) return [];
    const targetNode = graph.nodes.find((node) => node.id === edge.target);
    const targetAuthor = targetNode?.authoredBy ? members.get(targetNode.authoredBy) : undefined;
    const tone = targetNode?.origin === "team"
      ? opticsFor(targetNode, -1, targetAuthor?.colorKey).tone
      : "blue";
    return [{ edge, d: pathBetween(source, target), tone }];
  });
  return { stars, paths, toRoomPoint: normalized.toRoomPoint };
}
