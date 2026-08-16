import type {
  Proposal,
  ProposalDecision,
  PublicGraphMode,
  PublicPoint,
  RoomBundle,
  SharedLayoutItem,
  TeamEdgeItem,
  TeamNodeItem,
} from "@dialogue-atlas/relay-contract";
import type {
  AtlasGraphEdge,
  AtlasGraphModel,
  AtlasGraphNode,
} from "@dialogue-atlas/atlas-graph";

function latestLayout(items: readonly SharedLayoutItem[]): Record<string, PublicPoint> {
  const revisions = new Map<string, number>();
  const result: Record<string, PublicPoint> = {};
  for (const item of items) {
    if ((revisions.get(item.nodeId) ?? -1) > item.revision) continue;
    revisions.set(item.nodeId, item.revision);
    result[item.nodeId] = { x: item.x, y: item.y };
  }
  return result;
}

function reviewForNode(bundle: RoomBundle, nodeId: string) {
  const stances = bundle.stances.filter((stance) => stance.nodeId === nodeId);
  const decidedProposalIds = new Set(bundle.decisions.map((decision) => decision.proposalId));
  return {
    confirm: stances.filter((stance) => stance.stance === "confirm").length,
    challenge: stances.filter((stance) => stance.stance === "challenge").length,
    needsEvidence: stances.filter((stance) => stance.stance === "needs_evidence").length,
    openProposals: bundle.proposals.filter((proposal) => proposal.targetId === nodeId && proposal.status === "open" && !decidedProposalIds.has(proposal.id)).length,
  };
}

function teamNode(item: TeamNodeItem, bundle: RoomBundle): AtlasGraphNode {
  return {
    id: item.id,
    origin: "team",
    label: item.label,
    kind: item.kind,
    acts: ["team contribution"],
    modeIds: [...item.modeIds],
    evidenceIds: [],
    importance: 0.5,
    primary: false,
    editable: item.createdBy === bundle.member.userId,
    authoredBy: item.createdBy,
    review: reviewForNode(bundle, item.id),
  };
}

function teamEdge(item: TeamEdgeItem, bundle: RoomBundle): AtlasGraphEdge {
  return {
    id: item.id,
    origin: "team",
    source: item.source,
    target: item.target,
    type: item.type,
    label: item.label,
    evidenceIds: [],
    baseOrigin: "team",
    editable: item.createdBy === bundle.member.userId,
    authoredBy: item.createdBy,
    openProposals: bundle.proposals.filter((proposal) => proposal.targetId === item.id && proposal.status === "open").length,
  };
}

const NODE_KINDS: ReadonlySet<string> = new Set(["anchor", "claim", "evidence", "decision", "action", "note"]);

function valueString(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

interface AcceptedChange {
  proposal: Proposal;
  decision: ProposalDecision;
}

function acceptedChanges(bundle: RoomBundle): AcceptedChange[] {
  const proposals = new Map(bundle.proposals.map((proposal) => [proposal.id, proposal]));
  return bundle.decisions
    .filter((decision) => decision.decision === "accepted")
    .map((decision) => ({ proposal: proposals.get(decision.proposalId), decision }))
    .filter((entry): entry is AcceptedChange => entry.proposal !== undefined)
    .sort((left, right) => left.decision.decidedAt.localeCompare(right.decision.decidedAt) || left.decision.id.localeCompare(right.decision.id));
}

function applyAcceptedChanges(
  bundle: RoomBundle,
  inputNodes: AtlasGraphNode[],
  inputEdges: AtlasGraphEdge[],
): { nodes: AtlasGraphNode[]; edges: AtlasGraphEdge[] } {
  const nodes = new Map(inputNodes.map((node) => [node.id, { ...node }]));
  const edges = new Map(inputEdges.map((edge) => [edge.id, { ...edge }]));

  for (const { proposal, decision } of acceptedChanges(bundle)) {
    const acceptedProposal = { proposalId: proposal.id, operation: proposal.operation, decidedAt: decision.decidedAt };
    const node = nodes.get(proposal.targetId);
    const edge = edges.get(proposal.targetId);

    if (proposal.operation === "remove") {
      if (node) nodes.delete(node.id);
      if (edge) edges.delete(edge.id);
      continue;
    }

    if (node) {
      if (proposal.operation === "replace_label") {
        const label = valueString(proposal.proposedValue, "label", "value");
        if (label) nodes.set(node.id, { ...node, label, acceptedProposal });
      } else if (proposal.operation === "reclassify") {
        const kind = valueString(proposal.proposedValue, "kind", "value");
        if (kind && NODE_KINDS.has(kind)) {
          nodes.set(node.id, { ...node, kind: kind as AtlasGraphNode["kind"], acceptedProposal });
        }
      }
      continue;
    }

    if (!edge) continue;
    const baseOrigin = edge.baseOrigin ?? edge.origin;
    if (proposal.operation === "replace_label") {
      const label = valueString(proposal.proposedValue, "label", "value");
      if (label) edges.set(edge.id, { ...edge, label, origin: "accepted_proposal", baseOrigin, acceptedProposal });
    } else if (proposal.operation === "reclassify") {
      const type = valueString(proposal.proposedValue, "type", "value");
      if (type) edges.set(edge.id, { ...edge, type, origin: "accepted_proposal", baseOrigin, acceptedProposal });
    } else if (proposal.operation === "replace_relation") {
      edges.set(edge.id, {
        ...edge,
        source: valueString(proposal.proposedValue, "source") ?? edge.source,
        target: valueString(proposal.proposedValue, "target") ?? edge.target,
        type: valueString(proposal.proposedValue, "type", "relation") ?? edge.type,
        label: valueString(proposal.proposedValue, "label", "value") ?? edge.label,
        origin: "accepted_proposal",
        baseOrigin,
        acceptedProposal,
      });
    }
  }

  const effectiveNodes = [...nodes.values()];
  const nodeIds = new Set(effectiveNodes.map((node) => node.id));
  return {
    nodes: effectiveNodes,
    edges: [...edges.values()].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function graphModes(bundle: RoomBundle, teamNodes: readonly TeamNodeItem[]): PublicGraphMode[] {
  return bundle.atlas.graph.modes.map((mode) => ({
    ...mode,
    memberNodeIds: [
      ...mode.memberNodeIds,
      ...teamNodes.filter((node) => node.modeIds.includes(mode.id)).map((node) => node.id),
    ],
  }));
}

export function buildRoomGraph(bundle: RoomBundle): AtlasGraphModel {
  const teamNodes = bundle.teamItems.filter((item): item is TeamNodeItem => item.itemType === "node");
  const teamEdges = bundle.teamItems.filter((item): item is TeamEdgeItem => item.itemType === "edge");
  const sourceNodes: AtlasGraphNode[] = bundle.atlas.graph.nodes.map((node) => ({
    ...node,
    review: reviewForNode(bundle, node.id),
  }));
  const sourceEdges: AtlasGraphEdge[] = bundle.atlas.graph.edges.map((edge) => ({
    ...edge,
    baseOrigin: edge.origin,
    editable: false,
    openProposals: bundle.proposals.filter((proposal) => proposal.targetId === edge.id && proposal.status === "open").length,
  }));

  const effective = applyAcceptedChanges(
    bundle,
    [...sourceNodes, ...teamNodes.map((node) => teamNode(node, bundle))],
    [...sourceEdges, ...teamEdges.map((edge) => teamEdge(edge, bundle))],
  );
  const nodeIds = new Set(effective.nodes.map((node) => node.id));
  const composedLayout = { ...bundle.atlas.graph.layout, ...latestLayout(bundle.layout) };

  return {
    nodes: effective.nodes,
    edges: effective.edges,
    modes: graphModes(bundle, teamNodes).map((mode) => ({ ...mode, memberNodeIds: mode.memberNodeIds.filter((id) => nodeIds.has(id)) })),
    layout: Object.fromEntries(Object.entries(composedLayout).filter(([id]) => nodeIds.has(id))),
  };
}
