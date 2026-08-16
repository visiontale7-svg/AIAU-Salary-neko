import type {
  ActionBrief,
  ActivityEvent,
  ConnectionState,
  DevinEvent,
  NodeStanceKind,
  PresenceMember,
  Proposal,
  ProposalDecision,
  PublicGraphNode,
  PublicPoint,
  RoomBundle,
  TeamEdgeItem,
  TeamNodeItem,
} from "@dialogue-atlas/relay-contract";
import type { AtlasSelection } from "@dialogue-atlas/atlas-graph";

export type RelayBootstrapPhase =
  | "anonymous_bootstrap"
  | "join_required"
  | "joining"
  | "loading_room"
  | "error";

export interface RelayBootstrapModel {
  phase: RelayBootstrapPhase;
  inviteToken?: string;
  message?: string;
  retryable?: boolean;
}

export interface RelayInviteDetails {
  shareUrl: string;
  expiresAt?: string;
  usesRemaining?: number;
}

export type OfflineDraftKind = "team_node" | "team_edge" | "stance" | "proposal" | "comment" | "layout" | "action_brief";

export interface OfflineDraft {
  id: string;
  kind: OfflineDraftKind;
  label: string;
  savedAt: string;
  status: "queued" | "conflict";
  expectedRevision?: number;
  serverRevision?: number;
}

export interface RelayOfflineState {
  drafts: readonly OfflineDraft[];
  lastSyncedAt?: string;
}

export interface RelayReadyRoomModel {
  phase: "ready";
  bundle: RoomBundle;
  connection: ConnectionState;
  presence: readonly PresenceMember[];
  selection: AtlasSelection;
  invite?: RelayInviteDetails;
  offline: RelayOfflineState;
  devinEvents: Readonly<Record<string, readonly DevinEvent[]>>;
  pendingMutation?: string;
  notice?: string;
  demoMode?: boolean;
  /** Ephemeral, non-authoritative collaboration hints. */
  typingTargetIds?: readonly string[];
  dragPreviews?: Readonly<Record<string, PublicPoint>>;
  /**
   * Durable activity hints observed while this client was already live and
   * confirmed by a subsequent RLS-protected room refresh. Initial load and
   * reconnect replay never enter this list.
   */
  confirmedLiveActivity?: readonly Pick<ActivityEvent, "seq" | "type" | "targetId">[];
}

export type RelayRoomModel = RelayBootstrapModel | RelayReadyRoomModel;

export interface TeamNodeDraft {
  id?: string;
  label: string;
  kind: PublicGraphNode["kind"];
  modeIds: string[];
  position?: PublicPoint;
  expectedRevision?: number;
}

export interface TeamEdgeDraft {
  id?: string;
  source: string;
  target: string;
  type: string;
  label: string;
  expectedRevision?: number;
}

export interface ProposalDraft {
  targetType: Proposal["targetType"];
  targetId: string;
  operation: Proposal["operation"];
  proposedValue: Record<string, unknown>;
  rationale: string;
}

export interface ActionBriefDraft {
  decisionId: string;
  title: string;
  objective: string;
  baselineSha: string;
  allowedFiles: string[];
  acceptanceCommands: string[];
  forbiddenActions: string[];
  approvedContext: string[];
}

export interface RelayRoomCallbacks {
  onJoin?(input: { inviteToken: string; displayName: string }): void;
  onRetry?(): void;
  onReconnect?(): void;
  onCopyInvite?(shareUrl: string): void;
  onCloseRoom?(): void | boolean | Promise<boolean>;
  onSelectionChange?(selection: AtlasSelection): void;
  onSaveNodePosition?(nodeId: string, position: PublicPoint): void | boolean | Promise<boolean>;
  onPreviewNodePosition?(nodeId: string, position: PublicPoint): void;
  onTyping?(targetId: string, typing: boolean): void;
  onCreateTeamNode?(draft: TeamNodeDraft): void | boolean | Promise<boolean>;
  onUpdateTeamNode?(draft: Required<Pick<TeamNodeDraft, "id" | "expectedRevision">> & TeamNodeDraft): void | boolean | Promise<boolean>;
  onCreateTeamEdge?(draft: TeamEdgeDraft): void | boolean | Promise<boolean>;
  onUpdateTeamEdge?(draft: Required<Pick<TeamEdgeDraft, "id" | "expectedRevision">> & TeamEdgeDraft): void | boolean | Promise<boolean>;
  onSetStance?(nodeId: string, stance: NodeStanceKind): void | boolean | Promise<boolean>;
  onSubmitProposal?(draft: ProposalDraft): void | boolean | Promise<boolean>;
  onAppendComment?(proposalId: string, body: string): void | boolean | Promise<boolean>;
  onDecideProposal?(proposalId: string, decision: ProposalDecision["decision"], rationale: string): void | boolean | Promise<boolean>;
  onCreateActionBrief?(draft: ActionBriefDraft): void | boolean | Promise<boolean>;
  onStartDevin?(actionBriefId: string, clientRequestId: string): void | boolean | Promise<boolean>;
  onSendDevinMessage?(runId: string, message: string, clientRequestId: string): void | DevinMessageOutcome | Promise<DevinMessageOutcome>;
  onResolveDraft?(draftId: string, strategy: "retry_local" | "accept_server"): void | boolean | Promise<boolean>;
  onDiscardDraft?(draftId: string): void;
}

export type DevinMessageOutcome = "accepted" | "rejected" | "unknown";

export interface RelayRoomProps {
  model: RelayRoomModel;
  callbacks?: RelayRoomCallbacks;
}

export interface NodeEditorState {
  mode: "create" | "edit";
  draft: TeamNodeDraft;
}

export interface EdgeEditorState {
  mode: "create" | "edit";
  draft: TeamEdgeDraft;
}

export type ReadyTeamNode = TeamNodeItem;
export type ReadyTeamEdge = TeamEdgeItem;
export type ReadyActionBrief = ActionBrief;
