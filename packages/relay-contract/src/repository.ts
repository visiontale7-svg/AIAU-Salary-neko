import type {
  ActionBrief,
  ActivityEvent,
  ConnectionState,
  DevinEvent,
  DevinRun,
  NodeStance,
  NodeStanceKind,
  PresenceMember,
  Proposal,
  ProposalComment,
  ProposalDecision,
  RelayPackageV1,
  RoomBundle,
  SharedLayoutItem,
  TeamGraphItem,
} from "./relay-v1";

export interface MutationResult<T> {
  value: T;
  activitySeq: number;
}

export interface RelayRoomRepository {
  createRoomWithPackage(pkg: RelayPackageV1, inviteConfig: { expiresAt?: string; maxUses?: number }): Promise<{ roomId: string; inviteToken: string }>;
  publishAtlasVersion(roomId: string, pkg: RelayPackageV1): Promise<{ atlasVersionId: string; version: number; activitySeq: number }>;
  createRoomInvite(roomId: string, inviteConfig: { expiresAt?: string; maxUses?: number }): Promise<{ inviteToken: string }>;
  closeRoom(roomId: string): Promise<{ activitySeq: number }>;
  joinRoom(inviteToken: string, displayName: string): Promise<{ roomId: string }>;
  fetchRoom(roomId: string): Promise<RoomBundle>;
  loadActivity(roomId: string, afterSeq: number): Promise<ActivityEvent[]>;
  upsertTeamGraphItem(item: Omit<TeamGraphItem, "createdBy" | "revision"> & { expectedRevision: number; clientMutationId: string }): Promise<MutationResult<TeamGraphItem>>;
  saveLayoutItem(item: Pick<SharedLayoutItem, "roomId" | "nodeId" | "x" | "y"> & { expectedRevision: number; clientMutationId: string }): Promise<MutationResult<SharedLayoutItem>>;
  setNodeStance(input: { roomId: string; nodeId: string; stance: NodeStanceKind; clientMutationId: string }): Promise<MutationResult<NodeStance>>;
  submitProposal(input: Omit<Proposal, "id" | "status" | "revision" | "createdBy" | "createdAt"> & { clientMutationId: string }): Promise<MutationResult<Proposal>>;
  appendProposalComment(input: { roomId: string; proposalId: string; body: string; clientMutationId: string }): Promise<MutationResult<ProposalComment>>;
  decideProposal(input: { roomId: string; proposalId: string; decision: ProposalDecision["decision"]; rationale: string; expectedRoomRevision: number; clientMutationId: string }): Promise<MutationResult<ProposalDecision>>;
  createActionBrief(input: Omit<ActionBrief, "id" | "createdBy" | "createdAt"> & { clientMutationId: string }): Promise<MutationResult<ActionBrief>>;
  createDevinRun(input: { roomId: string; actionBriefId: string; clientRequestId: string }): Promise<DevinRun>;
  refreshDevinRun(input: { roomId: string; runId: string }): Promise<DevinRun>;
  sendDevinMessage(input: { roomId: string; runId: string; message: string; clientRequestId: string }): Promise<DevinRun>;
  fetchDevinEvents(roomId: string, runId: string, after?: string): Promise<DevinEvent[]>;
}

export interface RelayRealtimeCallbacks {
  onConnection(state: ConnectionState): void;
  onPresence(members: PresenceMember[]): void;
  onActivityHint(event: Pick<ActivityEvent, "seq" | "type" | "targetId">): void;
  onFocus(event: { userId: string; nodeId?: string }): void;
  onTyping(event: { userId: string; targetId: string; typing: boolean }): void;
  onDragPreview(event: { userId: string; nodeId: string; x: number; y: number }): void;
}

export interface RelayRealtimeSession {
  setPresence(input: { activeNodeId?: string; editingNodeId?: string; viewingVersionId?: string }): Promise<void>;
  broadcastFocus(nodeId?: string): Promise<void>;
  broadcastTyping(targetId: string, typing: boolean): Promise<void>;
  broadcastDragPreview(nodeId: string, x: number, y: number): Promise<void>;
  close(): Promise<void>;
}

export interface RelayRealtimeAdapter {
  connect(roomId: string, callbacks: RelayRealtimeCallbacks): Promise<RelayRealtimeSession>;
}
