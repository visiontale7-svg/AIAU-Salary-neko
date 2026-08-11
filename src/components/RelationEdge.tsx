import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { RelationFlowEdge } from "../graph/graphTypes";
import { RELATION_COLORS } from "../domain";
import { useAtlasStore } from "../store";

export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<RelationFlowEdge>) {
  const select = useAtlasStore((state) => state.select);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: data?.relation.type === "撤回" ? 0.42 : 0.26,
  });
  if (!data) return null;
  const color = RELATION_COLORS[data.relation.type];
  const dashed = ["未解决", "中断后续答"].includes(data.relation.type);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: data.selected ? 3.2 : data.relation.type === "撤回" ? 2.7 : 2,
          strokeDasharray: dashed ? "7 6" : undefined,
          opacity: data.dimmed ? 0.24 : 0.9,
          transition: "opacity 180ms ease, stroke-width 180ms ease",
        }}
      />
      {!data.dimmed ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`edge-label ${data.selected ? "is-selected" : ""}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              borderColor: `${color}44`,
              color,
            }}
            aria-label={`关系：${data.relation.source} 到 ${data.relation.target}，${data.relation.label || data.relation.type}`}
            onClick={(event) => {
              event.stopPropagation();
              select({ kind: "edge", id: data.relation.id });
            }}
          >
            {data.relation.label || data.relation.type}
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
