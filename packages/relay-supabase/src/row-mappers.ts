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
  RelayRoom,
  RoomMember,
  SharedLayoutItem,
  TeamGraphItem,
} from "@dialogue-atlas/relay-contract";

export type Row = Record<string, unknown>;

function field(row: Row, key: string): unknown {
  if (!(key in row)) throw new Error(`Relay row is missing ${key}`);
  return row[key];
}

export function stringField(row: Row, key: string): string {
  const value = field(row, key);
  if (typeof value !== "string") throw new Error(`Relay row ${key} must be a string`);
  return value;
}

function optionalStringField(row: Row, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Relay row ${key} must be a string`);
  return value;
}

function optionalTimestampField(row: Row, key: string): string | undefined {
  const value = optionalStringField(row, key);
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new Error(`Relay row ${key} must be a timestamp`);
  }
  return value;
}

export function numberField(row: Row, key: string): number {
  const value = field(row, key);
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Relay row ${key} must be finite`);
  return parsed;
}

function stringArrayField(row: Row, key: string): string[] {
  const value = field(row, key);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Relay row ${key} must be a string array`);
  }
  return value;
}

function objectField(row: Row, key: string): Row {
  const value = field(row, key);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Relay row ${key} must be an object`);
  }
  return value as Row;
}

export function mapRoom(row: Row): RelayRoom {
  const status = stringField(row, "status");
  if (status !== "open" && status !== "closed") throw new Error("Relay room status is invalid");
  return {
    id: stringField(row, "id"),
    title: stringField(row, "title"),
    ownerId: stringField(row, "owner_id"),
    status,
    currentVersionId: stringField(row, "current_version_id"),
    revision: numberField(row, "revision"),
  };
}

export function mapMember(row: Row): RoomMember {
  const role = stringField(row, "role");
  if (role !== "owner" && role !== "member") throw new Error("Relay member role is invalid");
  return {
    roomId: stringField(row, "room_id"),
    userId: stringField(row, "user_id"),
    displayName: stringField(row, "display_name"),
    role,
    colorKey: stringField(row, "color_key"),
  };
}

export function mapPackage(row: Row): RelayPackageV1 {
  const value = objectField(row, "package");
  if (value.schemaVersion !== "relay-v1") throw new Error("Relay atlas package schema is unsupported");
  return value as unknown as RelayPackageV1;
}

export function mapLayout(row: Row): SharedLayoutItem {
  return {
    roomId: stringField(row, "room_id"),
    nodeId: stringField(row, "node_id"),
    x: numberField(row, "x"),
    y: numberField(row, "y"),
    revision: numberField(row, "revision"),
    updatedBy: stringField(row, "updated_by"),
  };
}

export function mapTeamItem(row: Row): TeamGraphItem {
  const base = {
    id: stringField(row, "item_id"),
    roomId: stringField(row, "room_id"),
    revision: numberField(row, "revision"),
    createdBy: stringField(row, "created_by"),
  };
  const payload = objectField(row, "payload");
  const itemType = stringField(row, "item_type");
  if (itemType === "node") {
    const kind = stringField(payload, "kind") as TeamGraphItem extends { kind: infer Kind } ? Kind : never;
    return {
      ...base,
      itemType,
      label: stringField(payload, "label"),
      kind,
      modeIds: stringArrayField(payload, "modeIds"),
    } as TeamGraphItem;
  }
  if (itemType === "edge") {
    return {
      ...base,
      itemType,
      source: stringField(payload, "source"),
      target: stringField(payload, "target"),
      type: stringField(payload, "type"),
      label: stringField(payload, "label"),
    };
  }
  throw new Error("Relay team item type is invalid");
}

export function mapStance(row: Row): NodeStance {
  const stance = stringField(row, "stance");
  if (stance !== "confirm" && stance !== "challenge" && stance !== "needs_evidence") {
    throw new Error("Relay node stance is invalid");
  }
  return {
    roomId: stringField(row, "room_id"),
    nodeId: stringField(row, "node_id"),
    userId: stringField(row, "user_id"),
    stance,
    updatedAt: stringField(row, "updated_at"),
  };
}

export function mapProposal(row: Row): Proposal {
  return {
    id: stringField(row, "id"),
    roomId: stringField(row, "room_id"),
    targetType: stringField(row, "target_type") as Proposal["targetType"],
    targetId: stringField(row, "target_id"),
    operation: stringField(row, "operation") as Proposal["operation"],
    proposedValue: objectField(row, "proposed_value"),
    rationale: stringField(row, "rationale"),
    status: stringField(row, "status") as Proposal["status"],
    revision: numberField(row, "revision"),
    createdBy: stringField(row, "created_by"),
    createdAt: stringField(row, "created_at"),
  };
}

export function mapComment(row: Row): ProposalComment {
  return {
    id: stringField(row, "id"),
    roomId: stringField(row, "room_id"),
    proposalId: stringField(row, "proposal_id"),
    body: stringField(row, "body"),
    createdBy: stringField(row, "created_by"),
    createdAt: stringField(row, "created_at"),
    clientMutationId: stringField(row, "client_mutation_id"),
  };
}

export function mapDecision(row: Row): ProposalDecision {
  return {
    id: stringField(row, "id"),
    roomId: stringField(row, "room_id"),
    proposalId: stringField(row, "proposal_id"),
    decision: stringField(row, "decision") as ProposalDecision["decision"],
    rationale: stringField(row, "rationale"),
    decidedBy: stringField(row, "decided_by"),
    decidedAt: stringField(row, "decided_at"),
  };
}

export function mapActivity(row: Row): ActivityEvent {
  return {
    roomId: stringField(row, "room_id"),
    seq: numberField(row, "seq"),
    type: stringField(row, "event_type"),
    targetId: optionalStringField(row, "target_id"),
    actorId: optionalStringField(row, "actor_id"),
    clientMutationId: optionalStringField(row, "client_mutation_id"),
    createdAt: stringField(row, "created_at"),
  };
}

export function mapActionBrief(row: Row): ActionBrief {
  return {
    id: stringField(row, "id"),
    roomId: stringField(row, "room_id"),
    decisionId: stringField(row, "decision_id"),
    title: stringField(row, "title"),
    objective: stringField(row, "objective"),
    baselineSha: stringField(row, "baseline_sha"),
    allowedFiles: stringArrayField(row, "allowed_files"),
    acceptanceCommands: stringArrayField(row, "acceptance_commands"),
    forbiddenActions: stringArrayField(row, "forbidden_actions"),
    approvedContext: stringArrayField(row, "approved_context"),
    createdBy: stringField(row, "created_by"),
    createdAt: stringField(row, "created_at"),
  };
}

export function mapDevinRun(row: Row): DevinRun {
  const providerHealth = stringField(row, "provider_health");
  if (!["healthy", "delayed", "stale", "unknown"].includes(providerHealth)) {
    throw new Error("Relay Devin provider health is invalid");
  }
  const consecutiveFailures = numberField(row, "consecutive_failures");
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) {
    throw new Error("Relay Devin consecutive failures must be a non-negative safe integer");
  }
  return {
    id: stringField(row, "id"),
    roomId: stringField(row, "room_id"),
    actionBriefId: stringField(row, "action_brief_id"),
    externalSessionId: optionalStringField(row, "external_session_id"),
    externalUrl: optionalStringField(row, "external_url"),
    state: stringField(row, "state") as DevinRun["state"],
    statusDetail: optionalStringField(row, "status_detail"),
    pullRequestUrl: optionalStringField(row, "pull_request_url"),
    pullRequestState: optionalStringField(row, "pull_request_state"),
    checksState: optionalStringField(row, "checks_state") as DevinRun["checksState"],
    providerHealth: providerHealth as DevinRun["providerHealth"],
    lastSuccessfulPollAt: optionalTimestampField(row, "last_successful_poll_at"),
    lastProviderEventAt: optionalTimestampField(row, "last_provider_event_at"),
    consecutiveFailures,
    retryAfterAt: optionalTimestampField(row, "retry_after_at"),
    updatedAt: stringField(row, "updated_at"),
  };
}

export function mapDevinEvent(row: Row): DevinEvent {
  const actorType = stringField(row, "actor_type");
  if (actorType !== "devin" && actorType !== "owner" && actorType !== "system") {
    throw new Error("Relay Devin event actor type is invalid");
  }
  return {
    id: stringField(row, "id"),
    runId: stringField(row, "run_id"),
    externalEventId: optionalStringField(row, "external_event_id"),
    eventType: stringField(row, "event_type"),
    actorType,
    createdAt: stringField(row, "created_at"),
    text: stringField(row, "text"),
  };
}

export function mapMutationResult<T>(value: unknown): MutationResult<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay mutation result must be an object");
  }
  const row = value as Row;
  if (!("value" in row)) throw new Error("Relay mutation result is missing value");
  return { value: row.value as T, activitySeq: numberField(row, "activitySeq") };
}
