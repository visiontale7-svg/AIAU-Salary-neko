import { useMemo } from "react";
import { ViewportPortal } from "@xyflow/react";
import type { ModeDefinition, SemanticUnit } from "../domain";
import { nodeSize } from "../graph/graphTypes";

interface ModeIslandsProps {
  modes: ModeDefinition[];
  units: SemanticUnit[];
  positions: Record<string, { x: number; y: number }>;
}

interface Island {
  id: string;
  mode: ModeDefinition;
  x: number;
  y: number;
  width: number;
  height: number;
}

function hasRenderablePosition(position: { x: number; y: number } | undefined) {
  return Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y));
}

function isRenderableMode(
  mode: ModeDefinition,
  units: SemanticUnit[],
  positions: Record<string, { x: number; y: number }>,
) {
  return mode.confidence > 0 && units.some(
    (unit) => unit.modeIds.includes(mode.id) && hasRenderablePosition(positions[unit.id]),
  );
}

function clusterMembers(
  mode: ModeDefinition,
  units: SemanticUnit[],
  positions: Record<string, { x: number; y: number }>,
): Island[] {
  const members = units
    .filter((unit) => unit.modeIds.includes(mode.id) && hasRenderablePosition(positions[unit.id]))
    .map((unit) => {
      const size = nodeSize(unit);
      return {
        unit,
        x: positions[unit.id].x,
        y: positions[unit.id].y,
        width: size.width,
        height: size.height,
      };
    });
  const remaining = new Set(members.map((member) => member.unit.id));
  const groups: typeof members[] = [];

  while (remaining.size) {
    const seedId = remaining.values().next().value as string;
    const group: typeof members = [];
    const queue = [seedId];
    remaining.delete(seedId);
    while (queue.length) {
      const currentId = queue.shift()!;
      const current = members.find((member) => member.unit.id === currentId)!;
      group.push(current);
      for (const candidateId of [...remaining]) {
        const candidate = members.find((member) => member.unit.id === candidateId)!;
        const currentCenter = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
        const candidateCenter = { x: candidate.x + candidate.width / 2, y: candidate.y + candidate.height / 2 };
        if (
          Math.abs(currentCenter.x - candidateCenter.x) < 330 &&
          Math.abs(currentCenter.y - candidateCenter.y) < 265
        ) {
          remaining.delete(candidateId);
          queue.push(candidateId);
        }
      }
    }
    groups.push(group);
  }

  return groups.map((group, index) => {
    const paddingX = 28;
    const paddingY = 30;
    const minX = Math.min(...group.map((member) => member.x)) - paddingX;
    const minY = Math.min(...group.map((member) => member.y)) - paddingY;
    const maxX = Math.max(...group.map((member) => member.x + member.width)) + paddingX;
    const maxY = Math.max(...group.map((member) => member.y + member.height)) + paddingY;
    return {
      id: `${mode.id}-${index}`,
      mode,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  });
}

function blobPath({ x, y, width, height }: Island) {
  const r = Math.min(42, width / 5, height / 4);
  const wobble = Math.min(12, r / 3);
  return [
    `M ${x + r} ${y}`,
    `C ${x + width * 0.34} ${y - wobble}, ${x + width * 0.72} ${y + wobble}, ${x + width - r} ${y}`,
    `Q ${x + width} ${y}, ${x + width} ${y + r}`,
    `C ${x + width + wobble} ${y + height * 0.35}, ${x + width - wobble} ${y + height * 0.7}, ${x + width} ${y + height - r}`,
    `Q ${x + width} ${y + height}, ${x + width - r} ${y + height}`,
    `C ${x + width * 0.68} ${y + height + wobble}, ${x + width * 0.3} ${y + height - wobble}, ${x + r} ${y + height}`,
    `Q ${x} ${y + height}, ${x} ${y + height - r}`,
    `C ${x - wobble} ${y + height * 0.7}, ${x + wobble} ${y + height * 0.34}, ${x} ${y + r}`,
    `Q ${x} ${y}, ${x + r} ${y} Z`,
  ].join(" ");
}

export function ModeIslands({ modes, units, positions }: ModeIslandsProps) {
  const islands = useMemo(
    () => modes
      .filter((mode) => isRenderableMode(mode, units, positions))
      .flatMap((mode) => clusterMembers(mode, units, positions)),
    [modes, positions, units],
  );

  return (
    <ViewportPortal>
      <svg
        className="mode-islands"
        width="2100"
        height="1400"
        viewBox="0 0 2100 1400"
        aria-hidden="false"
      >
        {islands.map((island) => (
          <g
            key={island.id}
            data-testid="mode-island"
            role="region"
            aria-label={`AI 推断模式：${island.mode.label}`}
          >
            <path
              d={blobPath(island)}
              fill={`${island.mode.color}0d`}
              stroke={island.mode.color}
              strokeWidth="1.5"
              strokeDasharray="7 6"
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`translate(${island.x + 16} ${island.y - 12})`}>
              <rect width={island.mode.label.length * 15 + 48} height="30" rx="15" fill="white" stroke={island.mode.color} strokeWidth="2" />
              <circle cx="15" cy="15" r="5" fill={island.mode.color} />
              <text x="28" y="20" fill="#1d3158" fontSize="13" fontWeight="700">
                {island.mode.label}
              </text>
            </g>
          </g>
        ))}
      </svg>
    </ViewportPortal>
  );
}
