export const RELAY_SCHEMA_VERSION = "relay-v1" as const;

export type PublicSpeaker = "user" | "assistant";
export type PublicNodeOrigin = "source" | "team";
export type PublicEdgeOrigin = "source" | "team" | "accepted_proposal";

export interface PublicPoint {
  x: number;
  y: number;
}

export interface PublicViewport extends PublicPoint {
  zoom: number;
}

export interface PublicGraphNode {
  id: string;
  origin: PublicNodeOrigin;
  label: string;
  kind: "anchor" | "claim" | "evidence" | "decision" | "action" | "note";
  speaker?: PublicSpeaker;
  acts: string[];
  modeIds: string[];
  evidenceIds: string[];
  importance: number;
  primary: boolean;
}

export interface PublicGraphEdge {
  id: string;
  origin: PublicEdgeOrigin;
  source: string;
  target: string;
  type: string;
  label: string;
  evidenceIds: string[];
}

export interface PublicGraphMode {
  id: string;
  kind: string;
  label: string;
  color: string;
  memberNodeIds: string[];
}

export interface PublicEvidence {
  excerpt: string;
  speaker?: PublicSpeaker;
}

export interface RelayPackageV1 {
  schemaVersion: typeof RELAY_SCHEMA_VERSION;
  packageId: string;
  clientPublishId: string;
  title: string;
  publishedAt: string;
  graph: {
    nodes: PublicGraphNode[];
    edges: PublicGraphEdge[];
    modes: PublicGraphMode[];
    layout: Record<string, PublicPoint>;
    viewport?: PublicViewport;
  };
  evidence: Record<string, PublicEvidence>;
}

export interface ShareDraftNode {
  draftItemId: string;
  label: string;
  kind: PublicGraphNode["kind"];
  speaker?: PublicSpeaker;
  primary: boolean;
  selectedByDefault: boolean;
  evidence: Array<{
    draftEvidenceId: string;
    excerpt: string;
    speaker?: PublicSpeaker;
    ownerKind: "node" | "edge";
    ownerLabel: string;
    selectedByDefault: false;
  }>;
}

export interface ShareDraft {
  draftId: string;
  snapshotId: string;
  title: string;
  expiresAt: string;
  nodes: ShareDraftNode[];
  warnings: string[];
}

export interface ShareApprovals {
  nodeDraftIds: string[];
  evidenceDraftIds: string[];
  title?: string;
}

export interface ShareReceipt {
  publicationId: string;
  snapshotId: string;
  packageId: string;
  clientPublishId: string;
  roomId: string;
  atlasVersionId: string;
  packageSha256: string;
  /** Canonical token-free room URL. Invite bearers are transient and never persisted. */
  relayUrl: string;
  publishedAt: string;
}

export type RoomRole = "owner" | "member";
export type RoomStatus = "open" | "closed";
export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";
export type NodeStanceKind = "confirm" | "challenge" | "needs_evidence";
export type ProposalStatus = "open" | "accepted" | "rejected" | "deferred";

export interface RelayRoom {
  id: string;
  title: string;
  ownerId: string;
  status: RoomStatus;
  currentVersionId: string;
  revision: number;
}

export interface RoomMember {
  roomId: string;
  userId: string;
  displayName: string;
  role: RoomRole;
  /** Server-assigned stable palette identity for this room membership. */
  colorKey: string;
}

export interface PresenceMember extends RoomMember {
  activeNodeId?: string;
  editingNodeId?: string;
  viewingVersionId?: string;
  onlineAt: string;
}

export interface SharedLayoutItem extends PublicPoint {
  roomId: string;
  nodeId: string;
  revision: number;
  updatedBy: string;
}

export interface TeamNodeItem {
  itemType: "node";
  id: string;
  roomId: string;
  label: string;
  kind: PublicGraphNode["kind"];
  modeIds: string[];
  revision: number;
  createdBy: string;
}

export interface TeamEdgeItem {
  itemType: "edge";
  id: string;
  roomId: string;
  source: string;
  target: string;
  type: string;
  label: string;
  revision: number;
  createdBy: string;
}

export type TeamGraphItem = TeamNodeItem | TeamEdgeItem;

export interface NodeStance {
  roomId: string;
  nodeId: string;
  userId: string;
  stance: NodeStanceKind;
  updatedAt: string;
}

export interface Proposal {
  id: string;
  roomId: string;
  targetType: "source_node" | "source_edge" | "team_node" | "team_edge";
  targetId: string;
  operation: "replace_label" | "replace_relation" | "remove" | "reclassify";
  proposedValue: Record<string, unknown>;
  rationale: string;
  status: ProposalStatus;
  revision: number;
  createdBy: string;
  createdAt: string;
}

export interface ProposalComment {
  id: string;
  roomId: string;
  proposalId: string;
  body: string;
  createdBy: string;
  createdAt: string;
  clientMutationId: string;
}

export interface ProposalDecision {
  id: string;
  roomId: string;
  proposalId: string;
  decision: Exclude<ProposalStatus, "open">;
  rationale: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ActivityEvent {
  roomId: string;
  seq: number;
  type: string;
  targetId?: string;
  actorId?: string;
  clientMutationId?: string;
  createdAt: string;
}

export interface ActionBrief {
  id: string;
  roomId: string;
  decisionId: string;
  title: string;
  objective: string;
  baselineSha: string;
  allowedFiles: string[];
  acceptanceCommands: string[];
  forbiddenActions: string[];
  approvedContext: string[];
  createdBy: string;
  createdAt: string;
}

export type DevinRunState =
  | "not_configured"
  | "queued"
  | "working"
  | "needs_input"
  | "approval_needed"
  | "completed"
  | "failed"
  | "blocked";

export type DevinProviderHealth = "healthy" | "delayed" | "stale" | "unknown";
export type DevinEventActorType = "devin" | "owner" | "system";

export interface DevinRun {
  id: string;
  roomId: string;
  actionBriefId: string;
  externalSessionId?: string;
  externalUrl?: string;
  state: DevinRunState;
  statusDetail?: string;
  pullRequestUrl?: string;
  pullRequestState?: string;
  checksState?: "unknown" | "pending" | "passing" | "failing";
  providerHealth: DevinProviderHealth;
  lastSuccessfulPollAt?: string;
  lastProviderEventAt?: string;
  consecutiveFailures: number;
  retryAfterAt?: string;
  updatedAt: string;
}

export interface DevinEvent {
  id: string;
  runId: string;
  externalEventId?: string;
  eventType: string;
  actorType: DevinEventActorType;
  createdAt: string;
  text: string;
}

export interface RoomBundle {
  room: RelayRoom;
  member: RoomMember;
  /** Durable member directory used to resolve authors while collaborators are offline. */
  members: RoomMember[];
  atlas: RelayPackageV1;
  layout: SharedLayoutItem[];
  teamItems: TeamGraphItem[];
  stances: NodeStance[];
  proposals: Proposal[];
  comments: ProposalComment[];
  decisions: ProposalDecision[];
  actionBriefs: ActionBrief[];
  devinRuns: DevinRun[];
  lastActivitySeq: number;
}
