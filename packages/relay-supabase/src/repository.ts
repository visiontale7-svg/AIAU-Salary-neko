import type {
  ActionBrief,
  ActivityEvent,
  DevinEvent,
  DevinRun,
  MutationResult,
  NodeStance,
  Proposal,
  ProposalComment,
  ProposalDecision,
  RelayPackageV1,
  RelayRoomRepository,
  RoomBundle,
  SharedLayoutItem,
  TeamGraphItem,
} from "@dialogue-atlas/relay-contract";
import type { SupabaseClientLike, SupabaseResult } from "./client-like";
import { requireArray, requireData, requireObject } from "./errors";
import {
  mapActionBrief,
  mapActivity,
  mapComment,
  mapDecision,
  mapDevinEvent,
  mapDevinRun,
  mapLayout,
  mapMember,
  mapMutationResult,
  mapPackage,
  mapProposal,
  mapRoom,
  mapStance,
  mapTeamItem,
  numberField,
  type Row,
} from "./row-mappers";

function objectField(input: Row, key: string, operation: string): Row {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation}: ${key} must be an object`);
  }
  return value as Row;
}

function rowsField(input: Row, key: string, operation: string): Row[] {
  const value = input[key];
  if (!Array.isArray(value)
    || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`${operation}: ${key} must be an array of rows`);
  }
  return value as Row[];
}

function edgeRun(result: SupabaseResult<unknown>, operation: string): DevinRun {
  const payload = requireObject(operation, result);
  const value = payload.run ?? payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation}: response is missing run`);
  }
  const run = value as Record<string, unknown>;
  const required = ["id", "roomId", "actionBriefId", "state", "providerHealth", "updatedAt"];
  if (required.some((key) => typeof run[key] !== "string")) {
    throw new Error(`${operation}: response run is invalid`);
  }
  if (!["healthy", "delayed", "stale", "unknown"].includes(run.providerHealth as string)
    || !Number.isSafeInteger(run.consecutiveFailures)
    || (run.consecutiveFailures as number) < 0) {
    throw new Error(`${operation}: response run provider health is invalid`);
  }
  for (const key of ["lastSuccessfulPollAt", "lastProviderEventAt", "retryAfterAt"]) {
    if (run[key] !== undefined
      && (typeof run[key] !== "string" || !Number.isFinite(Date.parse(run[key] as string)))) {
      throw new Error(`${operation}: response run ${key} is invalid`);
    }
  }
  return run as unknown as DevinRun;
}

export class RelaySupabaseRepository implements RelayRoomRepository {
  constructor(private readonly client: SupabaseClientLike) {}

  async createRoomWithPackage(
    pkg: RelayPackageV1,
    inviteConfig: { expiresAt?: string; maxUses?: number },
  ): Promise<{ roomId: string; inviteToken: string }> {
    const result = await this.client.rpc("create_room_with_package", {
      p_package: pkg,
      p_invite_config: inviteConfig,
    });
    const data = requireObject("create Relay room", result);
    if (typeof data.roomId !== "string" || typeof data.inviteToken !== "string") {
      throw new Error("create Relay room: invalid RPC response");
    }
    return { roomId: data.roomId, inviteToken: data.inviteToken };
  }

  async joinRoom(inviteToken: string, displayName: string): Promise<{ roomId: string }> {
    const result = await this.client.rpc("join_room", {
      p_invite_token: inviteToken,
      p_display_name: displayName,
    });
    const data = requireObject("join Relay room", result);
    if (typeof data.roomId !== "string") throw new Error("join Relay room: invalid RPC response");
    return { roomId: data.roomId };
  }

  async publishAtlasVersion(
    roomId: string,
    pkg: RelayPackageV1,
  ): Promise<{ atlasVersionId: string; version: number; activitySeq: number }> {
    const data = requireObject("publish Relay atlas version", await this.client.rpc("publish_atlas_version", {
      p_room_id: roomId,
      p_package: pkg,
    }));
    if (typeof data.atlasVersionId !== "string"
      || typeof data.version !== "number"
      || typeof data.activitySeq !== "number") {
      throw new Error("publish Relay atlas version: invalid RPC response");
    }
    return {
      atlasVersionId: data.atlasVersionId,
      version: data.version,
      activitySeq: data.activitySeq,
    };
  }

  async createRoomInvite(
    roomId: string,
    config: { expiresAt?: string; maxUses?: number },
  ): Promise<{ inviteToken: string }> {
    const data = requireObject("create Relay room invite", await this.client.rpc("create_room_invite", {
      p_room_id: roomId,
      p_invite_config: config,
    }));
    if (typeof data.inviteToken !== "string") {
      throw new Error("create Relay room invite: invalid RPC response");
    }
    return { inviteToken: data.inviteToken };
  }

  async closeRoom(roomId: string): Promise<{ activitySeq: number }> {
    const data = requireObject("close Relay room", await this.client.rpc("close_room", {
      p_room_id: roomId,
    }));
    if (typeof data.activitySeq !== "number" || !Number.isSafeInteger(data.activitySeq)) {
      throw new Error("close Relay room: invalid RPC response");
    }
    return { activitySeq: data.activitySeq };
  }

  async fetchRoom(roomId: string): Promise<RoomBundle> {
    const operation = "load atomic Relay room bundle";
    const bundle = requireObject(operation, await this.client.rpc("get_room_bundle", {
      p_room_id: roomId,
    }));
    const room = mapRoom(objectField(bundle, "room", operation));
    const member = mapMember(objectField(bundle, "member", operation));
    const members = rowsField(bundle, "members", operation).map(mapMember);
    if (!members.some((candidate) => candidate.userId === member.userId
      && candidate.roomId === member.roomId
      && candidate.colorKey === member.colorKey)) {
      throw new Error(`${operation}: current member is missing from durable member directory`);
    }
    const atlas = mapPackage({ package: objectField(bundle, "atlas", operation) });
    const persistedLayout = rowsField(bundle, "layout", operation).map(mapLayout);
    const layoutByNode = new Map(persistedLayout.map((item) => [item.nodeId, item]));
    for (const [nodeId, point] of Object.entries(atlas.graph.layout)) {
      if (!layoutByNode.has(nodeId)) {
        layoutByNode.set(nodeId, {
          roomId,
          nodeId,
          x: point.x,
          y: point.y,
          revision: 0,
          updatedBy: room.ownerId,
        });
      }
    }
    const proposals = rowsField(bundle, "proposals", operation).map(mapProposal);
    const comments = rowsField(bundle, "comments", operation).map(mapComment);
    const decisions = rowsField(bundle, "decisions", operation).map(mapDecision);
    const actionBriefs = rowsField(bundle, "actionBriefs", operation).map(mapActionBrief);
    const devinRuns = rowsField(bundle, "devinRuns", operation).map(mapDevinRun);
    const lastActivitySeq = numberField(bundle, "lastActivitySeq");
    if (!Number.isSafeInteger(lastActivitySeq) || lastActivitySeq < 0) {
      throw new Error(`${operation}: lastActivitySeq must be a non-negative safe integer`);
    }

    return {
      room,
      member,
      members,
      atlas,
      layout: [...layoutByNode.values()],
      teamItems: rowsField(bundle, "teamItems", operation).map(mapTeamItem),
      stances: rowsField(bundle, "stances", operation).map(mapStance),
      proposals,
      comments,
      decisions,
      actionBriefs,
      devinRuns,
      lastActivitySeq,
    };
  }

  async loadActivity(roomId: string, afterSeq: number): Promise<ActivityEvent[]> {
    const result = await this.client
      .from("activity_events")
      .select("*")
      .eq("room_id", roomId)
      .gt("seq", afterSeq)
      .order("seq", { ascending: true });
    return requireArray("replay Relay activity", result).map(mapActivity);
  }

  async upsertTeamGraphItem(
    item: Omit<TeamGraphItem, "createdBy" | "revision"> & {
      expectedRevision: number;
      clientMutationId: string;
    },
  ): Promise<MutationResult<TeamGraphItem>> {
    const { expectedRevision, ...input } = item;
    const result = await this.client.rpc("upsert_team_graph_item", {
      p_input: input,
      p_expected_revision: expectedRevision,
    });
    return mapMutationResult<TeamGraphItem>(requireData("upsert Relay team item", result));
  }

  async saveLayoutItem(
    item: Pick<SharedLayoutItem, "roomId" | "nodeId" | "x" | "y"> & {
      expectedRevision: number;
      clientMutationId: string;
    },
  ): Promise<MutationResult<SharedLayoutItem>> {
    const { expectedRevision, ...input } = item;
    const result = await this.client.rpc("save_layout_item", {
      p_input: input,
      p_expected_revision: expectedRevision,
    });
    return mapMutationResult<SharedLayoutItem>(requireData("save Relay layout", result));
  }

  async setNodeStance(input: {
    roomId: string;
    nodeId: string;
    stance: NodeStance["stance"];
    clientMutationId: string;
  }): Promise<MutationResult<NodeStance>> {
    const result = await this.client.rpc("set_node_stance", {
      p_input: input,
    });
    return mapMutationResult<NodeStance>(requireData("set Relay node stance", result));
  }

  async submitProposal(
    input: Omit<Proposal, "id" | "status" | "revision" | "createdBy" | "createdAt"> & {
      clientMutationId: string;
    },
  ): Promise<MutationResult<Proposal>> {
    const result = await this.client.rpc("submit_proposal", { p_input: input });
    return mapMutationResult<Proposal>(requireData("submit Relay proposal", result));
  }

  async appendProposalComment(input: {
    roomId: string;
    proposalId: string;
    body: string;
    clientMutationId: string;
  }): Promise<MutationResult<ProposalComment>> {
    const { clientMutationId, ...comment } = input;
    const result = await this.client.rpc("append_proposal_comment", {
      p_input: comment,
      p_client_mutation_id: clientMutationId,
    });
    return mapMutationResult<ProposalComment>(requireData("append Relay proposal comment", result));
  }

  async decideProposal(input: {
    roomId: string;
    proposalId: string;
    decision: ProposalDecision["decision"];
    rationale: string;
    expectedRoomRevision: number;
    clientMutationId: string;
  }): Promise<MutationResult<ProposalDecision>> {
    const { expectedRoomRevision, ...decision } = input;
    const result = await this.client.rpc("decide_proposal", {
      p_input: decision,
      p_expected_room_revision: expectedRoomRevision,
    });
    return mapMutationResult<ProposalDecision>(requireData("decide Relay proposal", result));
  }

  async createActionBrief(
    input: Omit<ActionBrief, "id" | "createdBy" | "createdAt"> & { clientMutationId: string },
  ): Promise<MutationResult<ActionBrief>> {
    const { decisionId, ...brief } = input;
    const result = await this.client.rpc("create_action_brief", {
      p_decision_id: decisionId,
      p_input: brief,
    });
    return mapMutationResult<ActionBrief>(requireData("create Relay action brief", result));
  }

  async createDevinRun(input: {
    roomId: string;
    actionBriefId: string;
    clientRequestId: string;
  }): Promise<DevinRun> {
    const result = await this.client.functions.invoke("devin-relay", {
      body: {
        operation: "start",
        roomId: input.roomId,
        actionBriefId: input.actionBriefId,
        requestId: input.clientRequestId,
      },
    });
    return edgeRun(result, "request Relay Devin run");
  }

  async sendDevinMessage(input: {
    roomId: string;
    runId: string;
    message: string;
    clientRequestId: string;
  }): Promise<DevinRun> {
    const result = await this.client.functions.invoke("devin-relay", {
      body: {
        operation: "follow_up",
        roomId: input.roomId,
        runId: input.runId,
        message: input.message,
        requestId: input.clientRequestId,
      },
    });
    return edgeRun(result, "send Relay Devin follow-up");
  }

  async refreshDevinRun(input: { roomId: string; runId: string }): Promise<DevinRun> {
    const result = await this.client.functions.invoke("devin-relay", {
      body: {
        operation: "status",
        roomId: input.roomId,
        runId: input.runId,
      },
    });
    return edgeRun(result, "refresh Relay Devin run");
  }

  async fetchDevinEvents(roomId: string, runId: string, after?: string): Promise<DevinEvent[]> {
    let query = this.client
      .from("devin_events")
      .select("*")
      .eq("room_id", roomId)
      .eq("run_id", runId);
    if (after) query = query.gt("created_at", after);
    const result = await query.order("created_at", { ascending: true });
    return requireArray("load Relay Devin events", result).map(mapDevinEvent);
  }
}

export function createRelaySupabaseRepository(client: SupabaseClientLike): RelayRoomRepository {
  return new RelaySupabaseRepository(client);
}
