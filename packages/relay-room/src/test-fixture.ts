import type { RelayPackageV1, RoomBundle } from "@dialogue-atlas/relay-contract";
import type { RelayReadyRoomModel } from "./types";

export const testPackage: RelayPackageV1 = {
  schemaVersion: "relay-v1",
  packageId: "pkg_test",
  clientPublishId: "client_test",
  title: "Review the rollout plan",
  publishedAt: "2026-08-15T03:00:00.000Z",
  graph: {
    nodes: [
      { id: "n001", origin: "source", label: "Ship a bounded Relay room", kind: "claim", speaker: "assistant", acts: ["propose"], modeIds: ["m001"], evidenceIds: ["e001"], importance: 0.9, primary: true },
      { id: "n002", origin: "source", label: "Keep original transcripts local", kind: "decision", speaker: "user", acts: ["decide"], modeIds: ["m002"], evidenceIds: ["e002"], importance: 1, primary: true },
    ],
    edges: [{ id: "r001", origin: "source", source: "n001", target: "n002", type: "bounded_by", label: "bounded by", evidenceIds: [] }],
    modes: [
      { id: "m001", kind: "proposal", label: "Proposal", color: "#6c63c7", memberNodeIds: ["n001"] },
      { id: "m002", kind: "decision", label: "Decision", color: "#2d766c", memberNodeIds: ["n002"] },
    ],
    layout: { n001: { x: 60, y: 80 }, n002: { x: 380, y: 80 } },
  },
  evidence: {
    e001: { excerpt: "A small room can carry reviewed structure without the full conversation.", speaker: "assistant" },
    e002: { excerpt: "The original transcript should remain on the local device.", speaker: "user" },
  },
};

export const testBundle: RoomBundle = {
  room: { id: "room_test", title: "Relay readiness review", ownerId: "user_owner", status: "open", currentVersionId: "version_1", revision: 4 },
  member: { roomId: "room_test", userId: "user_owner", displayName: "Mina", role: "owner", colorKey: "member-0" },
  members: [
    { roomId: "room_test", userId: "user_owner", displayName: "Mina", role: "owner", colorKey: "member-0" },
    { roomId: "room_test", userId: "user_reviewer", displayName: "Ari", role: "member", colorKey: "member-1" },
  ],
  atlas: testPackage,
  layout: [
    { roomId: "room_test", nodeId: "n001", x: 72, y: 92, revision: 1, updatedBy: "user_owner" },
    { roomId: "room_test", nodeId: "n001", x: 88, y: 104, revision: 2, updatedBy: "user_owner" },
  ],
  teamItems: [
    { itemType: "node", id: "team_node_1", roomId: "room_test", label: "Run a two-browser rehearsal", kind: "action", modeIds: ["m002"], revision: 1, createdBy: "user_owner" },
    { itemType: "edge", id: "team_edge_1", roomId: "room_test", source: "n002", target: "team_node_1", type: "enables", label: "enables", revision: 1, createdBy: "user_owner" },
  ],
  stances: [
    { roomId: "room_test", nodeId: "n001", userId: "user_owner", stance: "confirm", updatedAt: "2026-08-15T03:10:00.000Z" },
    { roomId: "room_test", nodeId: "n001", userId: "user_reviewer", stance: "needs_evidence", updatedAt: "2026-08-15T03:11:00.000Z" },
  ],
  proposals: [
    { id: "proposal_open", roomId: "room_test", targetType: "source_node", targetId: "n001", operation: "replace_label", proposedValue: { value: "Ship a privacy-bounded Relay room" }, rationale: "Make the privacy boundary explicit.", status: "open", revision: 1, createdBy: "user_reviewer", createdAt: "2026-08-15T03:15:00.000Z" },
    { id: "proposal_done", roomId: "room_test", targetType: "source_node", targetId: "n002", operation: "reclassify", proposedValue: { value: "decision" }, rationale: "Treat the local-only boundary as a locked decision.", status: "accepted", revision: 2, createdBy: "user_owner", createdAt: "2026-08-15T03:12:00.000Z" },
  ],
  comments: [
    { id: "comment_1", roomId: "room_test", proposalId: "proposal_open", body: "This also helps the demo explanation.", createdBy: "user_owner", createdAt: "2026-08-15T03:17:00.000Z", clientMutationId: "cm_1" },
  ],
  decisions: [
    { id: "decision_1", roomId: "room_test", proposalId: "proposal_done", decision: "accepted", rationale: "This is an explicit publication boundary.", decidedBy: "user_owner", decidedAt: "2026-08-15T03:20:00.000Z" },
  ],
  actionBriefs: [
    { id: "brief_1", roomId: "room_test", decisionId: "decision_1", title: "Add room policy tests", objective: "Verify the locked publication boundary.", baselineSha: "abc1234", allowedFiles: ["supabase/tests/**"], acceptanceCommands: ["npm test"], forbiddenActions: ["Do not disable RLS"], approvedContext: ["Relay DTOs only"], createdBy: "user_owner", createdAt: "2026-08-15T03:22:00.000Z" },
  ],
  devinRuns: [
    { id: "devin_1", roomId: "room_test", actionBriefId: "brief_1", externalSessionId: "fixture_session_1", externalUrl: "https://example.test/devin/session/1", state: "working", statusDetail: "Fixture run is exercising policy tests.", pullRequestUrl: "https://example.test/pull/12", pullRequestState: "draft", checksState: "pending", providerHealth: "healthy", lastSuccessfulPollAt: "2026-08-15T03:28:00.000Z", lastProviderEventAt: "2026-08-15T03:27:00.000Z", consecutiveFailures: 0, updatedAt: "2026-08-15T03:28:00.000Z" },
  ],
  lastActivitySeq: 18,
};

export function readyModel(overrides: Partial<RelayReadyRoomModel> = {}): RelayReadyRoomModel {
  return {
    phase: "ready",
    bundle: testBundle,
    connection: "live",
    presence: [
      { ...testBundle.member, onlineAt: "2026-08-15T03:25:00.000Z", activeNodeId: "n001" },
      { roomId: "room_test", userId: "user_reviewer", displayName: "Ari", role: "member", colorKey: "member-1", onlineAt: "2026-08-15T03:25:00.000Z", activeNodeId: "n001" },
    ],
    selection: { kind: "node", id: "n001" },
    invite: { shareUrl: "https://relay.example.test/join/demo" },
    offline: { drafts: [], lastSyncedAt: "2026-08-15T03:29:00.000Z" },
    devinEvents: {
      devin_1: [{ id: "event_1", runId: "devin_1", eventType: "provider_message", actorType: "devin", createdAt: "2026-08-15T03:27:00.000Z", text: "Fixture event: policy test task started." }],
    },
    demoMode: true,
    ...overrides,
  };
}
