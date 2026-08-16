import { useEffect, useRef, useState } from "react";
import type { AtlasSelection } from "@dialogue-atlas/atlas-graph";
import type {
  ActionBrief,
  ActivityEvent,
  ConnectionState,
  DevinEvent,
  DevinRun,
  NodeStance,
  PresenceMember,
  Proposal,
  ProposalComment,
  ProposalDecision,
  PublicPoint,
  RelayRealtimeAdapter,
  RelayRealtimeSession,
  RelayRoomRepository,
  RoomBundle,
  SharedLayoutItem,
  TeamEdgeItem,
  TeamNodeItem,
} from "@dialogue-atlas/relay-contract";
import type {
  ActionBriefDraft,
  OfflineDraft,
  OfflineDraftKind,
  ProposalDraft,
  RelayBootstrapModel,
  RelayRoomCallbacks,
  RelayRoomModel,
  TeamEdgeDraft,
  TeamNodeDraft,
} from "./types";

type StoredMutationPayload =
  | { operation: "team_node"; payload: TeamNodeDraft }
  | { operation: "team_edge"; payload: TeamEdgeDraft }
  | { operation: "layout"; payload: { nodeId: string; position: PublicPoint; expectedRevision: number } }
  | { operation: "stance"; payload: { nodeId: string; stance: NodeStance["stance"] } }
  | { operation: "proposal"; payload: ProposalDraft }
  | { operation: "comment"; payload: { proposalId: string; body: string } }
  | { operation: "decision"; payload: { proposalId: string; decision: ProposalDecision["decision"]; rationale: string; expectedRoomRevision: number } }
  | { operation: "action_brief"; payload: ActionBriefDraft };

type StoredMutation = OfflineDraft & { roomId: string } & StoredMutationPayload;

export interface RelayRoomControllerOptions {
  repository?: RelayRoomRepository;
  realtime?: RelayRealtimeAdapter;
  initialRoomId?: string;
  initialInviteToken?: string;
  storage?: Storage | null;
  initialBundle?: RoomBundle;
  initialPresence?: PresenceMember[];
  initialSelection?: AtlasSelection;
  invite?: import("./types").RelayInviteDetails;
  demoMode?: boolean;
  /** Lets a web host remove a redeemed invite token from its URL immediately. */
  onInviteRedeemed?(roomId: string): void;
}

export interface RelayRoomController {
  model: RelayRoomModel;
  callbacks: RelayRoomCallbacks;
}

export interface ActivityMergeResult {
  events: ActivityEvent[];
  lastSeq: number;
}

/** De-duplicates and orders the append-only replay stream without trusting broadcast payload data. */
export function mergeActivityEvents(afterSeq: number, input: readonly ActivityEvent[]): ActivityMergeResult {
  const eventsBySeq = new Map<number, ActivityEvent>();
  for (const event of input) {
    if (!Number.isSafeInteger(event.seq) || event.seq <= afterSeq || eventsBySeq.has(event.seq)) continue;
    eventsBySeq.set(event.seq, event);
  }
  const events = [...eventsBySeq.values()].sort((left, right) => left.seq - right.seq);
  return { events, lastSeq: events.at(-1)?.seq ?? afterSeq };
}

let localIdCounter = 0;

function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${localIdCounter.toString(36)}`;
}

function storageKey(roomId: string): string {
  return `dialogue-atlas-relay:drafts:${roomId}`;
}

function devinStartStorageKey(roomId: string, actionBriefId: string): string {
  return `dialogue-atlas-relay:devin-start:${roomId}:${actionBriefId}`;
}

function retainDevinStartId(storage: Storage | null | undefined, roomId: string, actionBriefId: string, proposed: string): string {
  if (!storage) return proposed;
  const key = devinStartStorageKey(roomId, actionBriefId);
  try {
    const retained = storage.getItem(key);
    if (retained && retained.length >= 8 && retained.length <= 160) return retained;
    storage.setItem(key, proposed);
  } catch {
    // The in-memory form id remains stable for this mounted attempt.
  }
  return proposed;
}

function clearDevinStartId(storage: Storage | null | undefined, roomId: string, actionBriefId: string): void {
  try {
    storage?.removeItem(devinStartStorageKey(roomId, actionBriefId));
  } catch {
    // A confirmed server response remains authoritative even if storage is unavailable.
  }
}

function readStoredDrafts(storage: Storage | null | undefined, roomId: string): StoredMutation[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(storageKey(roomId)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StoredMutation => Boolean(
      item && typeof item === "object"
      && typeof (item as { id?: unknown }).id === "string"
      && typeof (item as { operation?: unknown }).operation === "string"
      && (item as { roomId?: unknown }).roomId === roomId,
    ));
  } catch {
    return [];
  }
}

function writeStoredDrafts(storage: Storage | null | undefined, roomId: string, drafts: readonly StoredMutation[]): void {
  if (!storage) return;
  try {
    if (drafts.length === 0) storage.removeItem(storageKey(roomId));
    else storage.setItem(storageKey(roomId), JSON.stringify(drafts));
  } catch {
    // Storage quotas/private modes must not make the room unusable. The in-memory queue remains visible.
  }
}

function publicDraft(draft: StoredMutation): OfflineDraft {
  return {
    id: draft.id,
    kind: draft.kind,
    label: draft.label,
    savedAt: draft.savedAt,
    status: draft.status,
    expectedRevision: draft.expectedRevision,
    serverRevision: draft.serverRevision,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown room mutation error";
}

function conflictError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown };
  const text = `${String(value?.code ?? "")} ${String(value?.message ?? "")}`.toLowerCase();
  return text.includes("revision") || text.includes("conflict") || text.includes("40001") || text.includes("409");
}

function businessRejection(error: unknown): boolean {
  const value = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = String(value?.code ?? "");
  const status = Number(value?.status);
  const text = `${code} ${String(value?.message ?? "")}`.toLowerCase();
  if (Number.isFinite(status) && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) return true;
  if (/^(22|23|42)/.test(code)) return true;
  return ["permission", "forbidden", "owner_required", "invalid_", "room_closed", "not_found", "immutable", "required"].some((marker) => text.includes(marker));
}

function nextRevision(current: number | undefined): number {
  return Math.max(1, (current ?? 0) + 1);
}

function staticMutation(bundle: RoomBundle, mutation: StoredMutation): RoomBundle {
  const now = new Date().toISOString();
  const actor = bundle.member.userId;
  let next = bundle;

  switch (mutation.operation) {
    case "team_node": {
      const draft = mutation.payload;
      const id = draft.id ?? localId("team_node");
      const item: TeamNodeItem = {
        itemType: "node",
        id,
        roomId: bundle.room.id,
        label: draft.label,
        kind: draft.kind,
        modeIds: draft.modeIds,
        revision: nextRevision(draft.expectedRevision),
        createdBy: actor,
      };
      const teamItems = [...bundle.teamItems.filter((entry) => entry.id !== id), item];
      const layout = draft.position
        ? [...bundle.layout.filter((entry) => entry.nodeId !== id), { roomId: bundle.room.id, nodeId: id, ...draft.position, revision: 1, updatedBy: actor }]
        : bundle.layout;
      next = { ...bundle, teamItems, layout };
      break;
    }
    case "team_edge": {
      const draft = mutation.payload;
      const id = draft.id ?? localId("team_edge");
      const item: TeamEdgeItem = {
        itemType: "edge",
        id,
        roomId: bundle.room.id,
        source: draft.source,
        target: draft.target,
        type: draft.type,
        label: draft.label,
        revision: nextRevision(draft.expectedRevision),
        createdBy: actor,
      };
      next = { ...bundle, teamItems: [...bundle.teamItems.filter((entry) => entry.id !== id), item] };
      break;
    }
    case "layout": {
      const { nodeId, position, expectedRevision } = mutation.payload;
      const item: SharedLayoutItem = { roomId: bundle.room.id, nodeId, ...position, revision: nextRevision(expectedRevision), updatedBy: actor };
      next = { ...bundle, layout: [...bundle.layout.filter((entry) => entry.nodeId !== nodeId), item] };
      break;
    }
    case "stance": {
      const item: NodeStance = { roomId: bundle.room.id, nodeId: mutation.payload.nodeId, userId: actor, stance: mutation.payload.stance, updatedAt: now };
      next = { ...bundle, stances: [...bundle.stances.filter((entry) => !(entry.nodeId === item.nodeId && entry.userId === actor)), item] };
      break;
    }
    case "proposal": {
      const draft = mutation.payload;
      const item: Proposal = { ...draft, id: localId("proposal"), roomId: bundle.room.id, status: "open", revision: 1, createdBy: actor, createdAt: now };
      next = { ...bundle, proposals: [...bundle.proposals, item] };
      break;
    }
    case "comment": {
      const item: ProposalComment = { id: localId("comment"), roomId: bundle.room.id, proposalId: mutation.payload.proposalId, body: mutation.payload.body, createdBy: actor, createdAt: now, clientMutationId: mutation.id };
      next = { ...bundle, comments: [...bundle.comments, item] };
      break;
    }
    case "decision": {
      const item: ProposalDecision = { id: localId("decision"), roomId: bundle.room.id, proposalId: mutation.payload.proposalId, decision: mutation.payload.decision, rationale: mutation.payload.rationale, decidedBy: actor, decidedAt: now };
      next = {
        ...bundle,
        room: { ...bundle.room, revision: bundle.room.revision + 1 },
        proposals: bundle.proposals.map((proposal) => proposal.id === item.proposalId ? { ...proposal, status: item.decision } : proposal),
        decisions: [...bundle.decisions, item],
      };
      break;
    }
    case "action_brief": {
      const draft = mutation.payload;
      const item: ActionBrief = { ...draft, id: localId("brief"), roomId: bundle.room.id, createdBy: actor, createdAt: now };
      next = { ...bundle, actionBriefs: [...bundle.actionBriefs, item] };
      break;
    }
  }

  return { ...next, lastActivitySeq: bundle.lastActivitySeq + 1 };
}

const ACTIVE_DEVIN_STATES = new Set(["queued", "working", "needs_input", "approval_needed"]);
export const DEVIN_POLL_INTERVAL_MS = 5_000;

export function isDevinPollDue(run: Pick<DevinRun, "state" | "retryAfterAt">, nowMs = Date.now()): boolean {
  if (!ACTIVE_DEVIN_STATES.has(run.state)) return false;
  if (!run.retryAfterAt) return true;
  const retryAt = Date.parse(run.retryAfterAt);
  return Number.isFinite(retryAt) && retryAt <= nowMs;
}

export function useRelayRoomController({
  repository,
  realtime,
  initialRoomId,
  initialInviteToken,
  storage,
  initialBundle,
  initialPresence = [],
  initialSelection = null,
  invite,
  demoMode = false,
  onInviteRedeemed,
}: RelayRoomControllerOptions = {}): RelayRoomController {
  const localMode = !repository && Boolean(initialBundle);
  const invitePending = Boolean(repository && initialInviteToken);
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>(invitePending ? undefined : initialRoomId);
  const activeRoomIdRef = useRef(activeRoomId);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [bundle, setBundle] = useState<RoomBundle | null>(initialBundle ?? null);
  const bundleRef = useRef<RoomBundle | null>(bundle);
  const [bootstrap, setBootstrap] = useState<RelayBootstrapModel>(
    localMode
      ? { phase: "loading_room", message: "Preparing the supplied Relay package." }
      : invitePending
        ? { phase: "join_required", inviteToken: initialInviteToken }
        : initialRoomId
          ? { phase: "loading_room" }
          : { phase: "anonymous_bootstrap" },
  );
  const [connection, setConnection] = useState<ConnectionState>(localMode ? "live" : "connecting");
  const connectionRef = useRef(connection);
  const [presence, setPresence] = useState<PresenceMember[]>(initialPresence);
  const presenceRef = useRef<PresenceMember[]>(initialPresence);
  const [selection, setSelection] = useState<AtlasSelection>(initialSelection);
  const [storedDrafts, setStoredDrafts] = useState<StoredMutation[]>([]);
  const storedDraftsRef = useRef<StoredMutation[]>([]);
  const draftRoomRef = useRef<string | undefined>(undefined);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(initialBundle?.atlas.publishedAt);
  const [devinEvents, setDevinEvents] = useState<Record<string, readonly DevinEvent[]>>({});
  const [pendingMutation, setPendingMutation] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [typingTargetIds, setTypingTargetIds] = useState<string[]>([]);
  const [dragPreviews, setDragPreviews] = useState<Record<string, PublicPoint>>({});
  const [confirmedLiveActivity, setConfirmedLiveActivity] = useState<Array<Pick<ActivityEvent, "seq" | "type" | "targetId">>>([]);
  const pendingLiveActivityRef = useRef<Array<Pick<ActivityEvent, "seq" | "type" | "targetId">>>([]);
  const realtimeSession = useRef<RelayRealtimeSession | null>(null);
  const lastSeqRef = useRef(initialBundle?.lastActivitySeq ?? 0);
  const hintedSeqRef = useRef(initialBundle?.lastActivitySeq ?? 0);
  const syncTaskRef = useRef<Promise<boolean> | null>(null);
  const syncRoomRef = useRef<string | undefined>(undefined);
  const syncRequestedRef = useRef(false);
  const dragBroadcastAtRef = useRef(0);
  const dragPreviewTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const devinPollingRef = useRef(false);
  const externalRequestInFlightRef = useRef(new Set<string>());

  useEffect(() => { bundleRef.current = bundle; }, [bundle]);
  useEffect(() => { connectionRef.current = connection; }, [connection]);
  useEffect(() => { presenceRef.current = presence; }, [presence]);
  useEffect(() => { storedDraftsRef.current = storedDrafts; }, [storedDrafts]);
  useEffect(() => { activeRoomIdRef.current = activeRoomId; }, [activeRoomId]);

  function updateConnection(next: ConnectionState): void {
    if (next !== "live") pendingLiveActivityRef.current = [];
    connectionRef.current = next;
    setConnection(next);
  }

  function updateDrafts(update: (current: StoredMutation[]) => StoredMutation[]): void {
    setStoredDrafts((current) => {
      const next = update(current);
      storedDraftsRef.current = next;
      return next;
    });
  }

  async function fetchDevinEventMap(nextBundle: RoomBundle): Promise<Record<string, readonly DevinEvent[]>> {
    if (!repository || nextBundle.devinRuns.length === 0) return {};
    const entries = await Promise.all(nextBundle.devinRuns.map(async (run) => {
      try {
        return [run.id, await repository.fetchDevinEvents(nextBundle.room.id, run.id)] as const;
      } catch {
        return [run.id, []] as const;
      }
    }));
    return Object.fromEntries(entries);
  }

  async function commitBundle(next: RoomBundle, durableLiveEvents: readonly ActivityEvent[] = []): Promise<void> {
    if (repository && activeRoomIdRef.current !== next.room.id) return;
    lastSeqRef.current = next.lastActivitySeq;
    hintedSeqRef.current = Math.max(hintedSeqRef.current, next.lastActivitySeq);
    bundleRef.current = next;
    setBundle(next);
    setSelection((current) => current && (
      next.atlas.graph.nodes.some((node) => node.id === current.id)
      || next.atlas.graph.edges.some((edge) => edge.id === current.id)
      || next.teamItems.some((item) => item.id === current.id)
    ) ? current : next.atlas.graph.nodes[0] ? { kind: "node", id: next.atlas.graph.nodes[0].id } : null);
    setPresence((current) => {
      const inRoom = current.filter((member) => member.roomId === next.room.id);
      const members = inRoom.length ? inRoom : [{ ...next.member, onlineAt: new Date().toISOString(), viewingVersionId: next.room.currentVersionId }];
      presenceRef.current = members;
      return members;
    });
    if (draftRoomRef.current !== next.room.id) {
      draftRoomRef.current = next.room.id;
      const drafts = readStoredDrafts(storage, next.room.id);
      storedDraftsRef.current = drafts;
      setStoredDrafts(drafts);
    }
    setLastSyncedAt(new Date().toISOString());
    const eventMap = await fetchDevinEventMap(next);
    if (!repository || activeRoomIdRef.current === next.room.id) setDevinEvents(eventMap);
    const durableBySeq = new Map(durableLiveEvents.map((event) => [event.seq, event]));
    const confirmed = pendingLiveActivityRef.current
      .map((event) => durableBySeq.get(event.seq))
      .filter((event): event is ActivityEvent => Boolean(event));
    const confirmedSeqs = new Set(confirmed.map((event) => event.seq));
    pendingLiveActivityRef.current = pendingLiveActivityRef.current.filter((event) => !confirmedSeqs.has(event.seq));
    if (confirmed.length) {
      setConfirmedLiveActivity((current) => {
        const bySeq = new Map(current.map((event) => [event.seq, event]));
        for (const event of confirmed) bySeq.set(event.seq, event);
        return [...bySeq.values()].sort((left, right) => left.seq - right.seq).slice(-64);
      });
    }
  }

  async function synchronizeRoom(
    roomId: string,
    options: { showLoading?: boolean; refresh?: boolean } = {},
  ): Promise<boolean> {
    if (!repository) return false;
    if (syncTaskRef.current) {
      if (syncRoomRef.current === roomId) {
        syncRequestedRef.current = true;
        return syncTaskRef.current;
      }
      await syncTaskRef.current;
    }

    if (options.showLoading) {
      bundleRef.current = null;
      setBundle(null);
      setBootstrap({ phase: "loading_room" });
    }

    syncRoomRef.current = roomId;
    const task = (async () => {
      try {
        let snapshot = !options.showLoading && bundleRef.current?.room.id === roomId ? bundleRef.current : null;
        if (!snapshot || options.refresh) snapshot = await repository.fetchRoom(roomId);
        let cursor = snapshot.lastActivitySeq;

        // A live subscription is established before this initial fetch. Replaying from
        // the fetched cursor closes the remaining fetch/commit race without trusting
        // broadcast contents; broadcasts are only a reason to query durable events.
        for (let round = 0; round < 8; round += 1) {
          const replay = mergeActivityEvents(cursor, await repository.loadActivity(roomId, cursor));
          const observedSeq = Math.max(replay.lastSeq, hintedSeqRef.current);
          if (observedSeq <= cursor) break;
          snapshot = await repository.fetchRoom(roomId);
          cursor = Math.max(observedSeq, snapshot.lastActivitySeq);
        }
        snapshot = { ...snapshot, lastActivitySeq: Math.max(snapshot.lastActivitySeq, cursor) };
        const pending = pendingLiveActivityRef.current;
        const durableLiveEvents = pending.length
          ? await repository.loadActivity(roomId, Math.max(0, Math.min(...pending.map((event) => event.seq)) - 1))
          : [];
        if (activeRoomIdRef.current !== roomId) return false;
        await commitBundle(snapshot, durableLiveEvents);
        return true;
      } catch (error) {
        if (activeRoomIdRef.current !== roomId) return false;
        if (options.showLoading || !bundleRef.current) {
          setBootstrap({ phase: "error", message: errorText(error), retryable: true });
        } else {
          updateConnection("offline");
          setNotice("The latest room revision could not be loaded. Existing content and local drafts remain visible.");
        }
        return false;
      }
    })();
    syncTaskRef.current = task;
    const succeeded = await task;
    syncTaskRef.current = null;
    syncRoomRef.current = undefined;
    const shouldRepeat = syncRequestedRef.current || hintedSeqRef.current > lastSeqRef.current;
    syncRequestedRef.current = false;
    if (shouldRepeat && activeRoomIdRef.current === roomId) void synchronizeRoom(roomId);
    return succeeded;
  }

  async function executeMutation(mutation: StoredMutation): Promise<number> {
    if (!repository) return 0;
    const clientMutationId = mutation.id;
    switch (mutation.operation) {
      case "team_node": {
        const draft = mutation.payload;
        const id = draft.id ?? localId("team_node");
        const input = {
          itemType: "node",
          id,
          roomId: mutation.roomId,
          label: draft.label,
          kind: draft.kind,
          modeIds: draft.modeIds,
          expectedRevision: draft.expectedRevision ?? 0,
          clientMutationId,
        } as Parameters<RelayRoomRepository["upsertTeamGraphItem"]>[0];
        const result = await repository.upsertTeamGraphItem(input);
        let activitySeq = result.activitySeq;
        if (draft.position) {
          const layout = await repository.saveLayoutItem({ roomId: mutation.roomId, nodeId: result.value.id, ...draft.position, expectedRevision: 0, clientMutationId: `${clientMutationId}_layout` });
          activitySeq = Math.max(activitySeq, layout.activitySeq);
        }
        return activitySeq;
      }
      case "team_edge": {
        const draft = mutation.payload;
        const input = {
          itemType: "edge",
          id: draft.id ?? localId("team_edge"),
          roomId: mutation.roomId,
          source: draft.source,
          target: draft.target,
          type: draft.type,
          label: draft.label,
          expectedRevision: draft.expectedRevision ?? 0,
          clientMutationId,
        } as Parameters<RelayRoomRepository["upsertTeamGraphItem"]>[0];
        return (await repository.upsertTeamGraphItem(input)).activitySeq;
      }
      case "layout":
        return (await repository.saveLayoutItem({ roomId: mutation.roomId, nodeId: mutation.payload.nodeId, ...mutation.payload.position, expectedRevision: mutation.payload.expectedRevision, clientMutationId })).activitySeq;
      case "stance":
        return (await repository.setNodeStance({ roomId: mutation.roomId, ...mutation.payload, clientMutationId })).activitySeq;
      case "proposal":
        return (await repository.submitProposal({ roomId: mutation.roomId, ...mutation.payload, clientMutationId })).activitySeq;
      case "comment":
        return (await repository.appendProposalComment({ roomId: mutation.roomId, ...mutation.payload, clientMutationId })).activitySeq;
      case "decision":
        return (await repository.decideProposal({ roomId: mutation.roomId, ...mutation.payload, clientMutationId })).activitySeq;
      case "action_brief":
        return (await repository.createActionBrief({ roomId: mutation.roomId, ...mutation.payload, clientMutationId })).activitySeq;
    }
  }

  async function runMutation(mutation: StoredMutation, retrying = false, allowDuringRecovery = false): Promise<boolean> {
    if (!repository) {
      setBundle((current) => {
        const next = current ? staticMutation(current, mutation) : current;
        bundleRef.current = next;
        return next;
      });
      setNotice("Static fixture updated in memory. No network request was made.");
      return true;
    }
    if (!allowDuringRecovery && connectionRef.current !== "live") {
      setNotice("Editing is paused while Relay reconnects. Your text remains in the open form.");
      return false;
    }
    setPendingMutation(mutation.label);
    try {
      const activitySeq = await executeMutation(mutation);
      hintedSeqRef.current = Math.max(hintedSeqRef.current, activitySeq);
      const synchronized = await synchronizeRoom(mutation.roomId, { refresh: true });
      if (!synchronized) throw new Error("The mutation committed but its durable room snapshot could not be confirmed");
      updateDrafts((drafts) => drafts.filter((draft) => draft.id !== mutation.id));
      setNotice(retrying ? "The retained draft was applied to the latest room revision." : undefined);
      return true;
    } catch (error) {
      const isConflict = conflictError(error);
      if (!isConflict && businessRejection(error)) {
        updateDrafts((drafts) => drafts.filter((draft) => draft.id !== mutation.id));
        setNotice(`The room rejected this change: ${errorText(error)}. Your form remains open.`);
        return false;
      }
      const queued: StoredMutation = {
        ...mutation,
        status: isConflict ? "conflict" : "queued",
        savedAt: new Date().toISOString(),
        serverRevision: isConflict ? bundleRef.current?.room.revision : mutation.serverRevision,
      };
      updateDrafts((drafts) => [...drafts.filter((draft) => draft.id !== queued.id), queued]);
      if (!isConflict) updateConnection("offline");
      setNotice(isConflict
        ? "A newer room revision conflicts with this draft. Choose whether to retry the local change or keep the room version."
        : "The change is retained on this device and can be replayed after reconnecting.");
      return false;
    } finally {
      setPendingMutation(undefined);
    }
  }

  function mutation<K extends OfflineDraftKind>(kind: K, label: string, payload: StoredMutationPayload): StoredMutation {
    const roomId = bundleRef.current?.room.id ?? "";
    return {
      id: localId("mutation"),
      roomId,
      kind,
      label,
      savedAt: new Date().toISOString(),
      status: "queued",
      ...payload,
    } as StoredMutation;
  }

  async function replayQueuedDrafts(roomId: string): Promise<boolean> {
    const queued = [...storedDraftsRef.current].filter((draft) => draft.roomId === roomId && draft.status === "queued");
    for (const draft of queued) {
      if (!await runMutation(draft, true, true)) return false;
    }
    return true;
  }

  async function joinRoom(inviteToken: string, displayName: string): Promise<void> {
    if (!repository) return;
    setBootstrap({ phase: "joining" });
    try {
      const joined = await repository.joinRoom(inviteToken, displayName);
      if (initialRoomId && joined.roomId !== initialRoomId) {
        setBootstrap({ phase: "join_required", inviteToken, message: "This invite does not match the requested room." });
        return;
      }
      onInviteRedeemed?.(joined.roomId);
      hintedSeqRef.current = 0;
      lastSeqRef.current = 0;
      activeRoomIdRef.current = joined.roomId;
      setActiveRoomId(joined.roomId);
      setBootstrap({ phase: "loading_room" });
    } catch (error) {
      if (initialRoomId) {
        try {
          // A single-use invite may have committed membership before its response
          // was lost. RLS-protected fetch success is the reconciliation proof.
          await repository.fetchRoom(initialRoomId);
          onInviteRedeemed?.(initialRoomId);
          hintedSeqRef.current = 0;
          lastSeqRef.current = 0;
          activeRoomIdRef.current = initialRoomId;
          setActiveRoomId(initialRoomId);
          setBootstrap({ phase: "loading_room" });
          return;
        } catch {
          // Preserve the original redeem failure when membership is not visible.
        }
      }
      setBootstrap({ phase: "join_required", inviteToken, message: errorText(error) });
    }
  }

  useEffect(() => {
    if (!repository || !activeRoomId) return;
    const roomId = activeRoomId;
    let cancelled = false;
    let ownedSession: RelayRealtimeSession | null = null;
    let liveCycle: Promise<void> | null = null;
    setConfirmedLiveActivity([]);
    pendingLiveActivityRef.current = [];
    hintedSeqRef.current = Math.max(hintedSeqRef.current, bundleRef.current?.room.id === roomId ? bundleRef.current.lastActivitySeq : 0);

    const publishPresence = async (): Promise<void> => {
      const session = ownedSession ?? realtimeSession.current;
      if (!session || connectionRef.current !== "live") return;
      try {
        await session.setPresence({
          viewingVersionId: bundleRef.current?.room.currentVersionId,
          activeNodeId: selection?.kind === "node" ? selection.id : undefined,
        });
      } catch {
        // A later channel status/reconnect owns recovery; presence is never durable authority.
      }
    };

    const runLiveCycle = (): void => {
      if (liveCycle) return;
      liveCycle = (async () => {
        const hasSnapshot = bundleRef.current?.room.id === roomId;
        updateConnection(hasSnapshot ? "reconnecting" : "connecting");
        const synchronized = await synchronizeRoom(roomId, { showLoading: !hasSnapshot, refresh: hasSnapshot });
        if (cancelled || !synchronized) return;
        const replayed = await replayQueuedDrafts(roomId);
        if (cancelled || !replayed) return;
        updateConnection("live");
        setNotice(undefined);
        await publishPresence();
      })().finally(() => { liveCycle = null; });
    };

    const loadWithoutRealtime = async (): Promise<void> => {
      const hasSnapshot = bundleRef.current?.room.id === roomId;
      updateConnection(hasSnapshot ? "reconnecting" : "connecting");
      const synchronized = await synchronizeRoom(roomId, { showLoading: !hasSnapshot, refresh: hasSnapshot });
      if (cancelled || !synchronized) return;
      const replayed = await replayQueuedDrafts(roomId);
      if (!cancelled && replayed) updateConnection("live");
    };

    if (!realtime) {
      void loadWithoutRealtime();
      return () => { cancelled = true; };
    }

    updateConnection(bundleRef.current?.room.id === roomId ? "reconnecting" : "connecting");
    void realtime.connect(roomId, {
      onConnection: (state) => {
        if (cancelled) return;
        if (state === "live") runLiveCycle();
        else {
          updateConnection(state);
          if (state === "offline" && bundleRef.current?.room.id !== roomId) {
            void synchronizeRoom(roomId, { showLoading: true });
          }
        }
      },
      onPresence: (members) => {
        if (cancelled) return;
        const unique = new Map(members.filter((member) => member.roomId === roomId).map((member) => [member.userId, member]));
        const next = [...unique.values()];
        presenceRef.current = next;
        setPresence(next);
      },
      onActivityHint: (event) => {
        if (cancelled || !Number.isSafeInteger(event.seq)) return;
        if (connectionRef.current === "live" && event.seq > lastSeqRef.current) {
          const pending = pendingLiveActivityRef.current;
          if (!pending.some((item) => item.seq === event.seq)) pendingLiveActivityRef.current = [...pending, event];
        }
        hintedSeqRef.current = Math.max(hintedSeqRef.current, event.seq);
        if (event.targetId) {
          setDragPreviews((current) => {
            if (!(event.targetId! in current)) return current;
            const next = { ...current };
            delete next[event.targetId!];
            return next;
          });
        }
        if (connectionRef.current === "live") void synchronizeRoom(roomId);
      },
      // Broadcast actor ids are not durable authority. These hints only decorate
      // the UI and are accepted when the claimed actor is in the live presence set.
      onFocus: () => undefined,
      onTyping: (event) => {
        if (cancelled || !presenceRef.current.some((member) => member.userId === event.userId)) return;
        setTypingTargetIds((current) => event.typing
          ? current.includes(event.targetId) ? current : [...current, event.targetId]
          : current.filter((targetId) => targetId !== event.targetId));
      },
      onDragPreview: (event) => {
        if (cancelled
          || !presenceRef.current.some((member) => member.userId === event.userId)
          || !Number.isFinite(event.x)
          || !Number.isFinite(event.y)
          || !bundleRef.current?.atlas.graph.nodes.some((node) => node.id === event.nodeId)
            && !bundleRef.current?.teamItems.some((item) => item.itemType === "node" && item.id === event.nodeId)) return;
        setDragPreviews((current) => ({ ...current, [event.nodeId]: { x: event.x, y: event.y } }));
        const prior = dragPreviewTimersRef.current.get(event.nodeId);
        if (prior) clearTimeout(prior);
        dragPreviewTimersRef.current.set(event.nodeId, setTimeout(() => {
          setDragPreviews((current) => {
            const next = { ...current };
            delete next[event.nodeId];
            return next;
          });
          dragPreviewTimersRef.current.delete(event.nodeId);
        }, 900));
      },
    }).then((session) => {
      if (cancelled) {
        void session.close();
        return;
      }
      ownedSession = session;
      realtimeSession.current = session;
      if (connectionRef.current === "live") void publishPresence();
    }).catch(() => {
      if (cancelled) return;
      updateConnection("offline");
      const hasSnapshot = bundleRef.current?.room.id === roomId;
      void synchronizeRoom(roomId, { showLoading: !hasSnapshot, refresh: hasSnapshot });
    });

    return () => {
      cancelled = true;
      if (realtimeSession.current === ownedSession) realtimeSession.current = null;
      if (ownedSession) void ownedSession.close();
      setTypingTargetIds([]);
      setDragPreviews({});
      for (const timer of dragPreviewTimersRef.current.values()) clearTimeout(timer);
      dragPreviewTimersRef.current.clear();
    };
    // The injected adapter identity and initial route are stable for one host mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, realtime, activeRoomId, connectionAttempt]);

  useEffect(() => {
    const roomId = bundle?.room.id;
    if (roomId) writeStoredDrafts(storage, roomId, storedDrafts);
  }, [bundle?.room.id, storage, storedDrafts]);

  useEffect(() => {
    if (!repository
      || connection !== "live"
      || bundle?.member.role !== "owner"
      || !bundle.devinRuns.some((run) => ACTIVE_DEVIN_STATES.has(run.state))) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      if (cancelled || devinPollingRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const current = bundleRef.current;
      if (!current || current.member.role !== "owner" || connectionRef.current !== "live") return;
      const now = Date.now();
      const activeRuns = current.devinRuns.filter((run) => isDevinPollDue(run, now));
      if (activeRuns.length === 0) return;
      devinPollingRef.current = true;
      try {
        await Promise.all(activeRuns.map((run) => repository.refreshDevinRun({ roomId: current.room.id, runId: run.id })));
        if (!cancelled) await synchronizeRoom(current.room.id, { refresh: true });
      } catch (error) {
        if (!cancelled) setNotice(`Devin status could not be refreshed: ${errorText(error)}`);
      } finally {
        devinPollingRef.current = false;
      }
    };
    const timer = setInterval(() => { void poll(); }, DEVIN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Bundle changes replace the timer so terminal runs stop without another tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, connection, bundle?.room.id, bundle?.member.role, bundle?.devinRuns]);

  const persistenceReady = (localMode || connection === "live") && bundle?.room.status === "open";
  const isOwner = bundle?.member.role === "owner";
  const callbacks: RelayRoomCallbacks = {
    onJoin: ({ inviteToken, displayName }) => { void joinRoom(inviteToken, displayName); },
    onRetry: () => {
      if (initialInviteToken && !activeRoomIdRef.current) {
        setBootstrap({ phase: "join_required", inviteToken: initialInviteToken });
      } else if (activeRoomIdRef.current ?? initialRoomId) {
        setConnectionAttempt((attempt) => attempt + 1);
      }
    },
    onReconnect: () => {
      updateConnection("reconnecting");
      setConnectionAttempt((attempt) => attempt + 1);
    },
    onCopyInvite: (shareUrl) => {
      const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (clipboard) void clipboard.writeText(shareUrl).then(() => setNotice("Invite copied."), () => setNotice("The browser could not copy the invite. Use the current room link instead."));
      else setNotice("Clipboard access is unavailable in this host.");
    },
    onSelectionChange: (next) => {
      setSelection(next);
      const nodeId = next?.kind === "node" ? next.id : undefined;
      if (connectionRef.current === "live" && realtimeSession.current) {
        void realtimeSession.current.broadcastFocus(nodeId);
        void realtimeSession.current.setPresence({ activeNodeId: nodeId, viewingVersionId: bundleRef.current?.room.currentVersionId });
      }
    },
    onDiscardDraft: (draftId) => {
      updateDrafts((drafts) => drafts.filter((draft) => draft.id !== draftId));
      setNotice("The retained local draft was discarded.");
    },
    onResolveDraft: async (draftId, strategy) => {
      const draft = storedDraftsRef.current.find((item) => item.id === draftId);
      if (!draft) return false;
      if (strategy === "retry_local") {
        if (connectionRef.current !== "live") {
          setNotice("Reconnect before retrying this retained draft.");
          return false;
        }
        return runMutation({ ...draft, status: "queued" }, true);
      }
      updateDrafts((items) => items.filter((item) => item.id !== draftId));
      setNotice("The retained local draft was discarded in favor of the room revision.");
      return true;
    },
    ...(persistenceReady ? {
      onSaveNodePosition: (nodeId: string, position: PublicPoint) => {
        const existing = bundleRef.current?.layout.filter((item) => item.nodeId === nodeId).sort((a, b) => b.revision - a.revision)[0];
        const item = mutation("layout", `position for ${nodeId}`, { operation: "layout", payload: { nodeId, position, expectedRevision: existing?.revision ?? 0 } });
        item.expectedRevision = existing?.revision ?? 0;
        return runMutation(item);
      },
      onPreviewNodePosition: (nodeId: string, position: PublicPoint) => {
        const now = Date.now();
        if (now - dragBroadcastAtRef.current < 50) return;
        dragBroadcastAtRef.current = now;
        void realtimeSession.current?.broadcastDragPreview(nodeId, position.x, position.y);
      },
      onCreateTeamNode: (draft: TeamNodeDraft) => runMutation(mutation("team_node", draft.label || "new team node", { operation: "team_node", payload: { ...draft, id: draft.id ?? localId("team_node") } })),
      onUpdateTeamNode: (draft: Required<Pick<TeamNodeDraft, "id" | "expectedRevision">> & TeamNodeDraft) => runMutation(mutation("team_node", draft.label, { operation: "team_node", payload: draft })),
      onCreateTeamEdge: (draft: TeamEdgeDraft) => runMutation(mutation("team_edge", draft.label || "new team relationship", { operation: "team_edge", payload: { ...draft, id: draft.id ?? localId("team_edge") } })),
      onUpdateTeamEdge: (draft: Required<Pick<TeamEdgeDraft, "id" | "expectedRevision">> & TeamEdgeDraft) => runMutation(mutation("team_edge", draft.label, { operation: "team_edge", payload: draft })),
      onSetStance: (nodeId: string, stance: NodeStance["stance"]) => runMutation(mutation("stance", `${stance.replaceAll("_", " ")} on ${nodeId}`, { operation: "stance", payload: { nodeId, stance } })),
      onSubmitProposal: (draft: ProposalDraft) => runMutation(mutation("proposal", `proposal for ${draft.targetId}`, { operation: "proposal", payload: draft })),
      onAppendComment: (proposalId: string, body: string) => runMutation(mutation("comment", "proposal comment", { operation: "comment", payload: { proposalId, body } })),
      onTyping: (targetId: string, typing: boolean) => { void realtimeSession.current?.broadcastTyping(targetId, typing); },
      ...(isOwner ? {
        ...(repository ? {
          onCloseRoom: async () => {
            const current = bundleRef.current;
            if (!current || current.member.role !== "owner" || current.room.status !== "open") return false;
            setPendingMutation("close room");
            try {
              await repository.closeRoom(current.room.id);
              await synchronizeRoom(current.room.id, { refresh: true });
              setNotice("The room is closed. Its history remains readable, but new collaboration and invites are disabled.");
              return true;
            } catch (error) {
              setNotice(`The room could not be closed: ${errorText(error)}`);
              return false;
            } finally {
              setPendingMutation(undefined);
            }
          },
        } : {}),
        onDecideProposal: (proposalId: string, decision: ProposalDecision["decision"], rationale: string) => {
          const revision = bundleRef.current?.room.revision ?? 0;
          const item = mutation("proposal", `${decision} proposal`, { operation: "decision", payload: { proposalId, decision, rationale, expectedRoomRevision: revision } });
          item.expectedRevision = revision;
          return runMutation(item);
        },
        onCreateActionBrief: (draft: ActionBriefDraft) => runMutation(mutation("action_brief", draft.title, { operation: "action_brief", payload: draft })),
        onStartDevin: async (actionBriefId: string, proposedRequestId: string) => {
          const current = bundleRef.current;
          if (!current) return false;
          if (!repository) {
            const already = current.devinRuns.some((run) => run.actionBriefId === actionBriefId);
            if (!already) {
              const next = { ...current, devinRuns: [...current.devinRuns, { id: localId("devin"), roomId: current.room.id, actionBriefId, state: "not_configured" as const, statusDetail: "Static fixture only: no Devin request was sent.", checksState: "unknown" as const, providerHealth: "unknown" as const, consecutiveFailures: 0, updatedAt: new Date().toISOString() }] };
              bundleRef.current = next;
              setBundle(next);
            }
            setNotice("Static fixture only: no Devin request was sent.");
            return true;
          }
          if (proposedRequestId.length < 8 || proposedRequestId.length > 160) return false;
          const clientRequestId = retainDevinStartId(storage, current.room.id, actionBriefId, proposedRequestId);
          if (externalRequestInFlightRef.current.has(clientRequestId)) return false;
          externalRequestInFlightRef.current.add(clientRequestId);
          const beforeRunIds = new Set(current.devinRuns.map((run) => run.id));
          setPendingMutation("Devin request");
          try {
            const created = await repository.createDevinRun({ roomId: current.room.id, actionBriefId, clientRequestId });
            clearDevinStartId(storage, current.room.id, actionBriefId);
            setBundle((value) => {
              if (!value || value.room.id !== current.room.id) return value;
              const next = { ...value, devinRuns: [created, ...value.devinRuns.filter((run) => run.id !== created.id)] };
              bundleRef.current = next;
              return next;
            });
            void synchronizeRoom(current.room.id, { refresh: true });
            return true;
          } catch (error) {
            const reconciled = await synchronizeRoom(current.room.id, { refresh: true });
            const durableRun = bundleRef.current?.devinRuns.some((run) => run.actionBriefId === actionBriefId && !beforeRunIds.has(run.id));
            if (durableRun) clearDevinStartId(storage, current.room.id, actionBriefId);
            setNotice(durableRun
              ? "The Devin request was found during reconciliation. No second request was created."
              : `The Devin request outcome is unconfirmed: ${errorText(error)}. Any retry uses the same request identity.`);
            if (!reconciled) updateConnection("offline");
            if (durableRun) return true;
            return false;
          } finally {
            externalRequestInFlightRef.current.delete(clientRequestId);
            setPendingMutation(undefined);
          }
        },
        onSendDevinMessage: async (runId: string, message: string, clientRequestId: string) => {
          const current = bundleRef.current;
          if (!current || !repository) {
            setNotice("Static fixture only: the message was not sent.");
            return "unknown" as const;
          }
          if (!clientRequestId.trim()) return "unknown" as const;
          if (externalRequestInFlightRef.current.has(clientRequestId)) return "unknown" as const;
          externalRequestInFlightRef.current.add(clientRequestId);
          const activityCursor = current.lastActivitySeq;
          setPendingMutation("Devin message");
          try {
            const updated = await repository.sendDevinMessage({ roomId: current.room.id, runId, message, clientRequestId });
            setBundle((value) => {
              if (!value || value.room.id !== current.room.id) return value;
              const next = { ...value, devinRuns: value.devinRuns.map((run) => run.id === updated.id ? updated : run) };
              bundleRef.current = next;
              return next;
            });
            void synchronizeRoom(current.room.id, { refresh: true });
            return "accepted" as const;
          } catch (error) {
            let definitiveRejection = false;
            try {
              const events = await repository.loadActivity(current.room.id, activityCursor);
              definitiveRejection = events.some((event) => (
                event.type === "devin_follow_up_rejected"
                && event.targetId === runId
                && event.clientMutationId === clientRequestId
              ));
            } catch {
              // A failed reconciliation read leaves the provider outcome unknown.
            }
            const reconciled = await synchronizeRoom(current.room.id, { refresh: true });
            setNotice(definitiveRejection
              ? `The message was rejected: ${errorText(error)}. Its text is preserved and the next attempt will use a new request identity.`
              : `The message outcome is unconfirmed: ${errorText(error)}. The unchanged text will reuse the same request identity.`);
            if (!reconciled) updateConnection("offline");
            return definitiveRejection ? "rejected" as const : "unknown" as const;
          } finally {
            externalRequestInFlightRef.current.delete(clientRequestId);
            setPendingMutation(undefined);
          }
        },
      } : {}),
    } : {}),
  };

  const model: RelayRoomModel = bundle ? {
    phase: "ready",
    bundle,
    connection,
    presence,
    selection,
    invite,
    offline: { drafts: storedDrafts.map(publicDraft), lastSyncedAt },
    devinEvents,
    pendingMutation,
    notice,
    demoMode,
    typingTargetIds,
    dragPreviews,
    confirmedLiveActivity,
  } : bootstrap;

  return { model, callbacks };
}
