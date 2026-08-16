import type {
  ActivityEvent,
  ConnectionState,
  RoomBundle,
  TeamNodeItem,
} from "@dialogue-atlas/relay-contract";
import type { B2MotionTrigger } from "../b2-visual/b2-motion-runtime";

export type B2ActivityDelivery = "live" | "initial" | "replay";

export interface B2ActivityMotionContext {
  connection: ConnectionState;
  delivery: B2ActivityDelivery;
  current: RoomBundle;
  previous?: RoomBundle;
}

type ConfirmedActivityHint = Pick<ActivityEvent, "seq" | "type" | "targetId">;

function isNewTeamNode(event: ConfirmedActivityHint, context: B2ActivityMotionContext): event is ConfirmedActivityHint & { targetId: string } {
  if (event.type !== "team_graph_item_upserted" || !event.targetId) return false;
  const current = context.current.teamItems.find((item): item is TeamNodeItem => item.itemType === "node" && item.id === event.targetId);
  if (!current) return false;
  return !context.previous?.teamItems.some((item) => item.itemType === "node" && item.id === event.targetId);
}

export function resolveDevinRunNodeTarget(bundle: RoomBundle, runId?: string): string | undefined {
  if (!runId) return undefined;
  const run = bundle.devinRuns.find((item) => item.id === runId);
  const brief = run ? bundle.actionBriefs.find((item) => item.id === run.actionBriefId) : undefined;
  const decision = brief ? bundle.decisions.find((item) => item.id === brief.decisionId) : undefined;
  const proposal = decision ? bundle.proposals.find((item) => item.id === decision.proposalId) : undefined;
  if (!proposal || !proposal.targetType.endsWith("_node")) return undefined;
  const exists = bundle.atlas.graph.nodes.some((node) => node.id === proposal.targetId)
    || bundle.teamItems.some((item) => item.itemType === "node" && item.id === proposal.targetId);
  return exists ? proposal.targetId : undefined;
}

export function deriveStaleDevinNodeTargets(bundle: RoomBundle): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const run of bundle.devinRuns) {
    if (run.providerHealth !== "stale") continue;
    const targetId = resolveDevinRunNodeTarget(bundle, run.id);
    if (targetId) targets.add(targetId);
  }
  return targets;
}

function inboundPathId(bundle: RoomBundle, targetId: string): string | undefined {
  const team = bundle.teamItems.find((item) => item.itemType === "edge" && item.target === targetId);
  if (team) return team.id;
  return bundle.atlas.graph.edges.find((edge) => edge.target === targetId)?.id;
}

/**
 * Converts only newly confirmed, live-delivered room activity into motion.
 * Initial hydration and reconnect replay always resolve to the final static
 * room state without replaying historical effects.
 */
export function mapConfirmedActivityToB2Motion(
  event: ConfirmedActivityHint,
  context: B2ActivityMotionContext,
): B2MotionTrigger | null {
  if (context.connection !== "live" || context.delivery !== "live") return null;
  if (!Number.isSafeInteger(event.seq) || event.seq < 0) return null;

  if (isNewTeamNode(event, context)) {
    return {
      eventKey: `activity:${event.seq}`,
      activitySeq: event.seq,
      sequence: "node-appearing",
      targetId: event.targetId,
      pathId: inboundPathId(context.current, event.targetId),
    };
  }

  if (event.type === "devin_events_appended") {
    const targetId = resolveDevinRunNodeTarget(context.current, event.targetId);
    if (!targetId) return null;
    return {
      eventKey: `devin-event:${event.targetId}:${event.seq}`,
      activitySeq: event.seq,
      sequence: "devin-event",
      targetId,
      pathId: inboundPathId(context.current, targetId),
    };
  }

  // Provider health is intentionally distinct from run lifecycle and Relay
  // connectivity. Only an explicit durable provider-health event may stale a
  // Devin star; reconnecting/offline states never enter this mapper.
  if (event.type === "devin_provider_health_stale") {
    const targetId = resolveDevinRunNodeTarget(context.current, event.targetId);
    if (!targetId) return null;
    return {
      eventKey: `devin-stale:${event.targetId}:${event.seq}`,
      activitySeq: event.seq,
      sequence: "devin-stale",
      targetId,
    };
  }

  return null;
}

export function mapSelectionToB2Motion(targetId: string, revision: number): B2MotionTrigger | null {
  if (!targetId.trim() || !Number.isSafeInteger(revision) || revision < 0) return null;
  return {
    eventKey: `selection:${targetId}:${revision}`,
    sequence: "selected-focus",
    targetId,
  };
}
