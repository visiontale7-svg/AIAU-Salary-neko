import type {
  PublicGraphEdge,
  PublicGraphMode,
  PublicGraphNode,
  PublicPoint,
} from "@dialogue-atlas/relay-contract";

export interface AtlasNodeReviewSummary {
  confirm: number;
  challenge: number;
  needsEvidence: number;
  openProposals: number;
}

export interface AtlasAcceptedProposal {
  proposalId: string;
  operation: "replace_label" | "replace_relation" | "remove" | "reclassify";
  decidedAt: string;
}

export interface AtlasGraphNode extends PublicGraphNode {
  review?: AtlasNodeReviewSummary;
  acceptedProposal?: AtlasAcceptedProposal;
  editable?: boolean;
  /** Present only for mutable team contributions, never immutable source nodes. */
  authoredBy?: string;
}

export interface AtlasGraphEdge extends PublicGraphEdge {
  openProposals?: number;
  acceptedProposal?: AtlasAcceptedProposal;
  baseOrigin?: PublicGraphEdge["origin"];
  editable?: boolean;
  /** Present only for mutable team contributions, never immutable source edges. */
  authoredBy?: string;
}

export interface AtlasGraphModel {
  nodes: readonly AtlasGraphNode[];
  edges: readonly AtlasGraphEdge[];
  modes: readonly PublicGraphMode[];
  layout: Readonly<Record<string, PublicPoint>>;
}

export type AtlasSelection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

export interface AtlasPresence {
  userId: string;
  displayName: string;
  activeNodeId?: string;
  editingNodeId?: string;
  color?: string;
}

export interface AtlasGraphCallbacks {
  onSelectionChange?(selection: AtlasSelection): void;
  onNodePositionChange?(nodeId: string, position: PublicPoint): void;
  onNodeDragPreview?(nodeId: string, position: PublicPoint): void;
  onCreateTeamNode?(position: PublicPoint): void;
  onCreateTeamEdge?(sourceId: string, targetId: string): void;
  onEditTeamNode?(nodeId: string): void;
  onEditTeamEdge?(edgeId: string): void;
}

export interface AtlasGraphViewProps {
  graph: AtlasGraphModel;
  selection?: AtlasSelection;
  presence?: readonly AtlasPresence[];
  callbacks?: AtlasGraphCallbacks;
}
