import type { Edge, Node } from "@xyflow/react";
import type { AtlasRelation, SemanticUnit } from "../domain";

export interface DialogueNodeData extends Record<string, unknown> {
  unit: SemanticUnit;
  selected: boolean;
  dimmed: boolean;
  matched: boolean;
}

export interface RelationEdgeData extends Record<string, unknown> {
  relation: AtlasRelation;
  selected: boolean;
  dimmed: boolean;
}

export type DialogueFlowNode = Node<DialogueNodeData, "dialogue">;
export type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

export const nodeSize = (unit: SemanticUnit) => {
  if (unit.kind === "anchor") return { width: 224, height: 122 };
  if (unit.kind === "operation") return { width: 178, height: 68 };
  if (unit.kind === "unresolved") return { width: 64, height: 64 };
  return { width: 206, height: 92 };
};
