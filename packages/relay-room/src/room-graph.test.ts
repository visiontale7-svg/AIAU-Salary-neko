import { describe, expect, it } from "vitest";
import { buildRoomGraph } from "./room-graph";
import { testBundle } from "./test-fixture";

describe("buildRoomGraph", () => {
  it("composes team items and latest shared layout without mutating the published package", () => {
    const before = JSON.stringify(testBundle.atlas);
    const graph = buildRoomGraph(testBundle);
    expect(graph.nodes.map((node) => node.id)).toContain("team_node_1");
    expect(graph.edges.map((edge) => edge.id)).toContain("team_edge_1");
    expect(graph.nodes.find((node) => node.id === "team_node_1")?.authoredBy).toBe("user_owner");
    expect(graph.edges.find((edge) => edge.id === "team_edge_1")?.authoredBy).toBe("user_owner");
    expect(graph.nodes.find((node) => node.id === "n001")?.authoredBy).toBeUndefined();
    expect(graph.edges.find((edge) => edge.id === "r001")?.authoredBy).toBeUndefined();
    expect(graph.layout.n001).toEqual({ x: 88, y: 104 });
    expect(JSON.stringify(testBundle.atlas)).toBe(before);
  });

  it("summarizes stances and open proposals on source nodes", () => {
    const node = buildRoomGraph(testBundle).nodes.find((item) => item.id === "n001");
    expect(node?.review).toEqual({ confirm: 1, challenge: 0, needsEvidence: 1, openProposals: 1 });
  });

  it("applies the latest owner-accepted label overlay without mutating the package", () => {
    const bundle = structuredClone(testBundle);
    bundle.proposals = [
      { id: "p_old", roomId: bundle.room.id, targetType: "source_node", targetId: "n001", operation: "replace_label", proposedValue: { value: "Earlier label" }, rationale: "First wording", status: "accepted", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
      { id: "p_latest", roomId: bundle.room.id, targetType: "source_node", targetId: "n001", operation: "replace_label", proposedValue: { label: "Owner-approved effective label" }, rationale: "Clearer wording", status: "accepted", revision: 2, createdBy: "user_reviewer", createdAt: "2026-08-15T03:01:00.000Z" },
    ];
    bundle.decisions = [
      { id: "d_old", roomId: bundle.room.id, proposalId: "p_old", decision: "accepted", rationale: "Accepted first", decidedBy: "user_owner", decidedAt: "2026-08-15T03:02:00.000Z" },
      { id: "d_latest", roomId: bundle.room.id, proposalId: "p_latest", decision: "accepted", rationale: "Accepted latest", decidedBy: "user_owner", decidedAt: "2026-08-15T03:03:00.000Z" },
    ];
    const before = JSON.stringify(bundle.atlas);
    const node = buildRoomGraph(bundle).nodes.find((item) => item.id === "n001");
    expect(node?.label).toBe("Owner-approved effective label");
    expect(node?.origin).toBe("source");
    expect(node?.acceptedProposal?.proposalId).toBe("p_latest");
    expect(JSON.stringify(bundle.atlas)).toBe(before);
  });

  it("does not apply open, rejected, or deferred proposal semantics", () => {
    const bundle = structuredClone(testBundle);
    bundle.proposals = [
      { id: "p_open", roomId: bundle.room.id, targetType: "source_node", targetId: "n001", operation: "replace_label", proposedValue: { value: "Open wording" }, rationale: "Open", status: "open", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
      { id: "p_rejected", roomId: bundle.room.id, targetType: "source_node", targetId: "n001", operation: "reclassify", proposedValue: { value: "action" }, rationale: "Rejected", status: "rejected", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
      { id: "p_deferred", roomId: bundle.room.id, targetType: "source_edge", targetId: "r001", operation: "replace_relation", proposedValue: { label: "Deferred relation" }, rationale: "Deferred", status: "deferred", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
    ];
    bundle.decisions = [
      { id: "d_rejected", roomId: bundle.room.id, proposalId: "p_rejected", decision: "rejected", rationale: "No", decidedBy: "user_owner", decidedAt: "2026-08-15T03:02:00.000Z" },
      { id: "d_deferred", roomId: bundle.room.id, proposalId: "p_deferred", decision: "deferred", rationale: "Later", decidedBy: "user_owner", decidedAt: "2026-08-15T03:03:00.000Z" },
    ];
    const graph = buildRoomGraph(bundle);
    expect(graph.nodes.find((item) => item.id === "n001")).toMatchObject({ label: "Ship a bounded Relay room", kind: "claim" });
    expect(graph.edges.find((item) => item.id === "r001")).toMatchObject({ label: "bounded by", origin: "source" });
  });

  it("applies accepted reclassification, relation, and removal as a closed effective graph", () => {
    const bundle = structuredClone(testBundle);
    bundle.proposals = [
      { id: "p_kind", roomId: bundle.room.id, targetType: "source_node", targetId: "n001", operation: "reclassify", proposedValue: { kind: "action" }, rationale: "Actionable", status: "accepted", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
      { id: "p_relation", roomId: bundle.room.id, targetType: "source_edge", targetId: "r001", operation: "replace_relation", proposedValue: { source: "n002", target: "n001", type: "challenges", label: "challenges" }, rationale: "Reverse dependency", status: "accepted", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
      { id: "p_remove", roomId: bundle.room.id, targetType: "team_node", targetId: "team_node_1", operation: "remove", proposedValue: {}, rationale: "Duplicate action", status: "accepted", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:00:00.000Z" },
    ];
    bundle.decisions = bundle.proposals.map((proposal, index) => ({ id: `d_${index}`, roomId: bundle.room.id, proposalId: proposal.id, decision: "accepted" as const, rationale: "Approved", decidedBy: "user_owner", decidedAt: `2026-08-15T03:0${index + 1}:00.000Z` }));
    const graph = buildRoomGraph(bundle);
    expect(graph.nodes.find((item) => item.id === "n001")?.kind).toBe("action");
    expect(graph.nodes.some((item) => item.id === "team_node_1")).toBe(false);
    expect(graph.edges.some((item) => item.id === "team_edge_1")).toBe(false);
    expect(graph.edges.find((item) => item.id === "r001")).toMatchObject({ source: "n002", target: "n001", type: "challenges", label: "challenges", origin: "accepted_proposal", baseOrigin: "source", editable: false });
  });
});
