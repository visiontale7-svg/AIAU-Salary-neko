import {
  assertRelayPackage,
  type PresenceMember,
  type RelayPackageV1,
  type RoomBundle,
} from "@dialogue-atlas/relay-contract";

export const relayFixturePackage: RelayPackageV1 = {
  schemaVersion: "relay-v1",
  packageId: "pkg_static_demo",
  clientPublishId: "publish_static_demo",
  title: "Turn a private AI workflow into a team decision",
  publishedAt: "2026-08-15T03:00:00.000Z",
  graph: {
    nodes: [
      { id: "n001", origin: "source", label: "How can personal AI work become reviewable by a team?", kind: "anchor", speaker: "user", acts: ["question"], modeIds: ["m001"], evidenceIds: ["e001"], importance: 1, primary: true },
      { id: "n002", origin: "source", label: "Keep original conversations and local identifiers on the device", kind: "claim", speaker: "assistant", acts: ["bound scope"], modeIds: ["m001"], evidenceIds: ["e002"], importance: 0.95, primary: true },
      { id: "n003", origin: "source", label: "Publish only an approved evidence-linked graph projection", kind: "claim", speaker: "assistant", acts: ["propose"], modeIds: ["m002"], evidenceIds: ["e003"], importance: 0.92, primary: true },
      { id: "n004", origin: "source", label: "Let reviewers confirm, challenge, or request evidence", kind: "claim", speaker: "assistant", acts: ["refine"], modeIds: ["m003"], evidenceIds: ["e004"], importance: 0.86, primary: true },
      { id: "n005", origin: "source", label: "Lock source meaning; route changes through explicit proposals", kind: "decision", speaker: "user", acts: ["decide"], modeIds: ["m004"], evidenceIds: ["e005"], importance: 1, primary: true },
      { id: "n006", origin: "source", label: "Hand accepted decisions to a bounded implementation brief", kind: "action", speaker: "assistant", acts: ["handoff"], modeIds: ["m004"], evidenceIds: ["e006"], importance: 0.82, primary: false },
    ],
    edges: [
      { id: "r001", origin: "source", source: "n001", target: "n002", type: "bounded_by", label: "bounded by", evidenceIds: [] },
      { id: "r002", origin: "source", source: "n002", target: "n003", type: "enables", label: "enables", evidenceIds: [] },
      { id: "r003", origin: "source", source: "n003", target: "n004", type: "reviewed_through", label: "reviewed through", evidenceIds: [] },
      { id: "r004", origin: "source", source: "n004", target: "n005", type: "resolved_by", label: "resolved by", evidenceIds: [] },
      { id: "r005", origin: "source", source: "n005", target: "n006", type: "authorizes", label: "authorizes", evidenceIds: [] },
    ],
    modes: [
      { id: "m001", kind: "exploration", label: "Frame", color: "#496e9e", memberNodeIds: ["n001", "n002"] },
      { id: "m002", kind: "proposal", label: "Shape", color: "#6d5dc5", memberNodeIds: ["n003"] },
      { id: "m003", kind: "quality", label: "Review", color: "#c0753e", memberNodeIds: ["n004"] },
      { id: "m004", kind: "decision", label: "Decide", color: "#2f796a", memberNodeIds: ["n005", "n006"] },
    ],
    layout: {
      n001: { x: 60, y: 80 },
      n002: { x: 60, y: 250 },
      n003: { x: 360, y: 155 },
      n004: { x: 660, y: 155 },
      n005: { x: 960, y: 80 },
      n006: { x: 960, y: 250 },
    },
    viewport: { x: 0, y: 0, zoom: 0.86 },
  },
  evidence: {
    e001: { excerpt: "The team needs reviewable decisions, not another full chat export.", speaker: "user" },
    e002: { excerpt: "The original conversation and local identifiers remain on the publishing device.", speaker: "assistant" },
    e003: { excerpt: "Only explicitly approved nodes, relationships, and evidence excerpts enter the Relay package.", speaker: "assistant" },
    e004: { excerpt: "Reviewers can confirm a claim, challenge it, or ask for stronger evidence.", speaker: "assistant" },
    e005: { excerpt: "Published source meaning stays immutable; proposed changes remain visible and owner-decided.", speaker: "user" },
    e006: { excerpt: "Accepted changes can become a bounded action brief with files, commands, and forbidden actions.", speaker: "assistant" },
  },
};

assertRelayPackage(relayFixturePackage);

export function createRelayFixtureBundle(): RoomBundle {
  return {
    room: {
      id: "room_static_demo",
      title: "Relay launch decision",
      ownerId: "member_owner_demo",
      status: "open",
      currentVersionId: "version_static_demo",
      revision: 7,
    },
    member: { roomId: "room_static_demo", userId: "member_owner_demo", displayName: "Mina", role: "owner", colorKey: "member-coral" },
    members: [
      { roomId: "room_static_demo", userId: "member_owner_demo", displayName: "Mina", role: "owner", colorKey: "member-coral" },
      { roomId: "room_static_demo", userId: "member_reviewer_demo", displayName: "Ari", role: "member", colorKey: "member-mint" },
    ],
    atlas: relayFixturePackage,
    layout: [],
    teamItems: [
      { itemType: "node", id: "team_node_demo", roomId: "room_static_demo", label: "Rehearse reconnect with two browsers", kind: "action", modeIds: ["m004"], revision: 1, createdBy: "member_owner_demo" },
      { itemType: "edge", id: "team_edge_demo", roomId: "room_static_demo", source: "n005", target: "team_node_demo", type: "validated_by", label: "validated by", revision: 1, createdBy: "member_owner_demo" },
    ],
    stances: [
      { roomId: "room_static_demo", nodeId: "n005", userId: "member_owner_demo", stance: "confirm", updatedAt: "2026-08-15T03:10:00.000Z" },
      { roomId: "room_static_demo", nodeId: "n004", userId: "member_reviewer_demo", stance: "needs_evidence", updatedAt: "2026-08-15T03:12:00.000Z" },
    ],
    proposals: [
      { id: "proposal_open_demo", roomId: "room_static_demo", targetType: "source_node", targetId: "n004", operation: "replace_label", proposedValue: { value: "Let reviewers record a stance and its evidence need" }, rationale: "Clarify that the stance is durable while focus is temporary.", status: "open", revision: 1, createdBy: "member_reviewer_demo", createdAt: "2026-08-15T03:14:00.000Z" },
      { id: "proposal_done_demo", roomId: "room_static_demo", targetType: "source_node", targetId: "n005", operation: "reclassify", proposedValue: { value: "decision" }, rationale: "Treat source immutability as an explicit product decision.", status: "accepted", revision: 2, createdBy: "member_owner_demo", createdAt: "2026-08-15T03:08:00.000Z" },
    ],
    comments: [
      { id: "comment_demo", roomId: "room_static_demo", proposalId: "proposal_open_demo", body: "We should show the difference in the connection banner.", createdBy: "member_owner_demo", createdAt: "2026-08-15T03:16:00.000Z", clientMutationId: "comment_static_demo" },
    ],
    decisions: [
      { id: "decision_demo", roomId: "room_static_demo", proposalId: "proposal_done_demo", decision: "accepted", rationale: "This protects the published evidence boundary.", decidedBy: "member_owner_demo", decidedAt: "2026-08-15T03:18:00.000Z" },
    ],
    actionBriefs: [
      { id: "brief_demo", roomId: "room_static_demo", decisionId: "decision_demo", title: "Verify immutable source behavior", objective: "Add deterministic tests showing source semantics remain unchanged while team content is editable.", baselineSha: "fixture-baseline-unverified", allowedFiles: ["packages/atlas-graph/**", "packages/relay-room/**"], acceptanceCommands: ["npm run test:relay"], forbiddenActions: ["Do not upload an original transcript", "Do not disable room authorization"], approvedContext: ["Relay public DTOs", "Static redacted fixture"], createdBy: "member_owner_demo", createdAt: "2026-08-15T03:20:00.000Z" },
    ],
    devinRuns: [
      { id: "devin_demo", roomId: "room_static_demo", actionBriefId: "brief_demo", state: "not_configured", statusDetail: "Static fixture only: no Devin service is connected and no request was sent.", checksState: "unknown", providerHealth: "unknown", consecutiveFailures: 0, updatedAt: "2026-08-15T03:20:00.000Z" },
    ],
    lastActivitySeq: 21,
  };
}

export function createRelayFixturePresence(): PresenceMember[] {
  return [
    { roomId: "room_static_demo", userId: "member_owner_demo", displayName: "Mina", role: "owner", colorKey: "member-coral", activeNodeId: "n005", viewingVersionId: "version_static_demo", onlineAt: "2026-08-15T03:22:00.000Z" },
    { roomId: "room_static_demo", userId: "member_reviewer_demo", displayName: "Ari", role: "member", colorKey: "member-mint", activeNodeId: "n004", viewingVersionId: "version_static_demo", onlineAt: "2026-08-15T03:22:00.000Z" },
  ];
}
