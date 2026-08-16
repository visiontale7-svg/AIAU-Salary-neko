import type { B2MotionSequence } from "./b2-motion";

/**
 * The runtime only remembers a bounded tail of completed interaction keys.
 * Persistent Relay events remain protected after eviction by lastActivitySeq.
 */
export const B2_MOTION_PLAYED_KEY_LIMIT = 64;

export interface B2MotionTrigger {
  /** Stable event identity. Re-rendering the same event must reuse this key. */
  eventKey: string;
  sequence: B2MotionSequence;
  targetId: string;
  pathId?: string;
  /**
   * Database activity sequence for persistent events. User interactions such
   * as selected-focus deliberately omit it and never move the Relay cursor.
   */
  activitySeq?: number;
}

export interface B2MotionRuntimeState {
  /** Exactly zero or one sequence may be playing. */
  active: B2MotionTrigger | null;
  /** Accepted triggers in deterministic input order. */
  queue: readonly B2MotionTrigger[];
  /** Oldest to newest, bounded by B2_MOTION_PLAYED_KEY_LIMIT. */
  playedEventKeys: readonly string[];
  /** Highest accepted persistent activity sequence, or null before one exists. */
  lastActivitySeq: number | null;
}

export interface B2MotionRuntimeInit {
  /** Seed this from the room activity cursor when mounting a live room. */
  lastActivitySeq?: number | null;
  /** Optional persisted tail used when the owning UI intentionally remounts. */
  playedEventKeys?: readonly string[];
}

export type B2MotionEnqueueRejection =
  | "invalid-trigger"
  | "duplicate-event-key"
  | "stale-activity-seq";

export type B2MotionEnqueueResult =
  | {
      accepted: true;
      state: B2MotionRuntimeState;
      reason: null;
    }
  | {
      accepted: false;
      state: B2MotionRuntimeState;
      reason: B2MotionEnqueueRejection;
    };

const B2_MOTION_SEQUENCES = new Set<B2MotionSequence>([
  "selected-focus",
  "node-appearing",
  "devin-event",
  "devin-stale",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isActivitySeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTrigger(value: B2MotionTrigger): boolean {
  return isNonEmptyString(value.eventKey)
    && B2_MOTION_SEQUENCES.has(value.sequence)
    && isNonEmptyString(value.targetId)
    && (value.pathId === undefined || isNonEmptyString(value.pathId))
    && (value.activitySeq === undefined || isActivitySeq(value.activitySeq));
}

function boundedUniqueKeys(keys: readonly string[]): readonly string[] {
  const newestFirst: string[] = [];
  const seen = new Set<string>();

  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (!isNonEmptyString(key) || seen.has(key)) continue;
    seen.add(key);
    newestFirst.push(key);
    if (newestFirst.length === B2_MOTION_PLAYED_KEY_LIMIT) break;
  }

  return newestFirst.reverse();
}

function appendPlayedKey(
  playedEventKeys: readonly string[],
  eventKey: string,
): readonly string[] {
  if (playedEventKeys.includes(eventKey)) return playedEventKeys;
  return boundedUniqueKeys([...playedEventKeys, eventKey]);
}

function containsEventKey(state: B2MotionRuntimeState, eventKey: string): boolean {
  return state.active?.eventKey === eventKey
    || state.queue.some((trigger) => trigger.eventKey === eventKey)
    || state.playedEventKeys.includes(eventKey);
}

export function createB2MotionRuntimeState(
  init: B2MotionRuntimeInit = {},
): B2MotionRuntimeState {
  const { lastActivitySeq = null, playedEventKeys = [] } = init;
  if (lastActivitySeq !== null && !isActivitySeq(lastActivitySeq)) {
    throw new RangeError("lastActivitySeq must be a non-negative safe integer or null");
  }

  return {
    active: null,
    queue: [],
    playedEventKeys: boundedUniqueKeys(playedEventKeys),
    lastActivitySeq,
  };
}

/**
 * Accept one trigger without mutating the current state.
 *
 * Persistent events must arrive with strictly increasing activitySeq values.
 * That invariant makes their subsequence sorted while the full queue preserves
 * input order for interleaved local selected-focus interactions.
 */
export function enqueueB2MotionTrigger(
  state: B2MotionRuntimeState,
  trigger: B2MotionTrigger,
): B2MotionEnqueueResult {
  if (!isTrigger(trigger)) {
    return { accepted: false, state, reason: "invalid-trigger" };
  }
  if (containsEventKey(state, trigger.eventKey)) {
    return { accepted: false, state, reason: "duplicate-event-key" };
  }
  if (
    trigger.activitySeq !== undefined
    && state.lastActivitySeq !== null
    && trigger.activitySeq <= state.lastActivitySeq
  ) {
    return { accepted: false, state, reason: "stale-activity-seq" };
  }

  const lastActivitySeq = trigger.activitySeq ?? state.lastActivitySeq;
  const nextState: B2MotionRuntimeState = state.active === null
    ? { ...state, active: trigger, lastActivitySeq }
    : { ...state, queue: [...state.queue, trigger], lastActivitySeq };

  return { accepted: true, state: nextState, reason: null };
}

/**
 * Retire the current trigger and promote the oldest queued trigger. Passing an
 * expected key prevents a late animation callback from completing its newer
 * replacement.
 */
export function completeActiveB2MotionTrigger(
  state: B2MotionRuntimeState,
  expectedEventKey?: string,
): B2MotionRuntimeState {
  if (state.active === null) return state;
  if (expectedEventKey !== undefined && state.active.eventKey !== expectedEventKey) {
    return state;
  }

  const [nextActive, ...remainingQueue] = state.queue;
  return {
    ...state,
    active: nextActive ?? null,
    queue: remainingQueue,
    playedEventKeys: appendPlayedKey(state.playedEventKeys, state.active.eventKey),
  };
}

/**
 * Cancel is intentionally also terminal: the event key is remembered and
 * cannot be requeued by a render, tab switch, or stale callback.
 */
export function clearActiveB2MotionTrigger(
  state: B2MotionRuntimeState,
  expectedEventKey?: string,
): B2MotionRuntimeState {
  return completeActiveB2MotionTrigger(state, expectedEventKey);
}

/**
 * Drop all pending work while retaining every dropped key in the played tail.
 * This is suitable for leaving a visual surface without allowing its pending
 * events to replay when that surface renders again.
 */
export function clearB2MotionQueue(state: B2MotionRuntimeState): B2MotionRuntimeState {
  if (state.active === null && state.queue.length === 0) return state;
  const retiredKeys = [
    ...state.playedEventKeys,
    ...(state.active ? [state.active.eventKey] : []),
    ...state.queue.map((trigger) => trigger.eventKey),
  ];
  return {
    ...state,
    active: null,
    queue: [],
    playedEventKeys: boundedUniqueKeys(retiredKeys),
  };
}

/**
 * Start a genuinely new room/session runtime. Callers that only remount a tab
 * should retain the existing state (or hydrate its cursor and played key tail)
 * instead of resetting it.
 */
export function resetB2MotionRuntime(
  init: B2MotionRuntimeInit = {},
): B2MotionRuntimeState {
  return createB2MotionRuntimeState(init);
}

