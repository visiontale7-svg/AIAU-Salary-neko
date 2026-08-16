import { describe, expect, it } from "vitest";
import {
  B2_MOTION_PLAYED_KEY_LIMIT,
  clearActiveB2MotionTrigger,
  clearB2MotionQueue,
  completeActiveB2MotionTrigger,
  createB2MotionRuntimeState,
  enqueueB2MotionTrigger,
  resetB2MotionRuntime,
  type B2MotionRuntimeState,
  type B2MotionTrigger,
} from "./b2-motion-runtime";

function trigger(
  eventKey: string,
  sequence: B2MotionTrigger["sequence"] = "node-appearing",
  activitySeq?: number,
): B2MotionTrigger {
  return {
    eventKey,
    sequence,
    targetId: `target-${eventKey}`,
    pathId: sequence === "selected-focus" ? undefined : `path-${eventKey}`,
    activitySeq,
  };
}

function accept(
  state: B2MotionRuntimeState,
  nextTrigger: B2MotionTrigger,
): B2MotionRuntimeState {
  const result = enqueueB2MotionTrigger(state, nextTrigger);
  expect(result.accepted).toBe(true);
  return result.state;
}

describe("B2 motion trigger runtime", () => {
  it("serializes accepted triggers with at most one active item", () => {
    let state = createB2MotionRuntimeState();
    state = accept(state, trigger("event-1", "node-appearing", 1));
    state = accept(state, trigger("selection-1", "selected-focus"));
    state = accept(state, trigger("event-2", "devin-event", 2));

    expect(state.active?.eventKey).toBe("event-1");
    expect(state.queue.map(({ eventKey }) => eventKey)).toEqual([
      "selection-1",
      "event-2",
    ]);
    expect(state.lastActivitySeq).toBe(2);
  });

  it("completes the active trigger, records its key and promotes FIFO", () => {
    let state = createB2MotionRuntimeState();
    state = accept(state, trigger("event-1"));
    state = accept(state, trigger("event-2"));

    state = completeActiveB2MotionTrigger(state, "event-1");
    expect(state.active?.eventKey).toBe("event-2");
    expect(state.queue).toEqual([]);
    expect(state.playedEventKeys).toEqual(["event-1"]);

    state = completeActiveB2MotionTrigger(state, "event-2");
    expect(state.active).toBeNull();
    expect(state.playedEventKeys).toEqual(["event-1", "event-2"]);
  });

  it("ignores an empty completion and a late callback for an older event", () => {
    const empty = createB2MotionRuntimeState();
    expect(completeActiveB2MotionTrigger(empty)).toBe(empty);

    let state = accept(empty, trigger("current"));
    const unchanged = completeActiveB2MotionTrigger(state, "previous");
    expect(unchanged).toBe(state);
    expect(unchanged.active?.eventKey).toBe("current");
  });

  it("deduplicates active, queued and played event keys", () => {
    let state = createB2MotionRuntimeState();
    state = accept(state, trigger("same", "node-appearing", 1));

    let duplicate = enqueueB2MotionTrigger(state, trigger("same", "devin-event", 2));
    expect(duplicate).toEqual({
      accepted: false,
      state,
      reason: "duplicate-event-key",
    });

    state = accept(state, trigger("queued", "devin-event", 2));
    duplicate = enqueueB2MotionTrigger(state, trigger("queued", "devin-stale", 3));
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toBe("duplicate-event-key");

    state = completeActiveB2MotionTrigger(state, "same");
    duplicate = enqueueB2MotionTrigger(state, trigger("same", "node-appearing", 3));
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toBe("duplicate-event-key");
  });

  it("rejects stale and out-of-order persistent activity sequences", () => {
    let state = createB2MotionRuntimeState({ lastActivitySeq: 40 });
    state = accept(state, trigger("activity-41", "node-appearing", 41));
    state = accept(state, trigger("activity-43", "devin-event", 43));

    const stale = enqueueB2MotionTrigger(state, trigger("activity-42", "devin-event", 42));
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toBe("stale-activity-seq");
    expect(stale.state).toBe(state);

    const duplicateSeq = enqueueB2MotionTrigger(state, trigger("another-43", "devin-event", 43));
    expect(duplicateSeq.accepted).toBe(false);
    expect(duplicateSeq.reason).toBe("stale-activity-seq");
    expect(state.queue.map(({ activitySeq }) => activitySeq)).toEqual([43]);
  });

  it("does not advance the persistent cursor for a rejected duplicate key", () => {
    let state = createB2MotionRuntimeState();
    state = accept(state, trigger("stable-key", "node-appearing", 10));

    const duplicate = enqueueB2MotionTrigger(state, trigger("stable-key", "devin-event", 99));
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.state.lastActivitySeq).toBe(10);

    const next = enqueueB2MotionTrigger(state, trigger("next-key", "devin-event", 11));
    expect(next.accepted).toBe(true);
    expect(next.state.lastActivitySeq).toBe(11);
  });

  it("keeps unsequenced selected-focus interactions out of the Relay cursor", () => {
    let state = createB2MotionRuntimeState({ lastActivitySeq: 25 });
    state = accept(state, trigger("select-node-a", "selected-focus"));
    state = accept(state, trigger("select-node-b", "selected-focus"));

    expect(state.lastActivitySeq).toBe(25);
    expect(state.active?.sequence).toBe("selected-focus");
    expect(state.queue[0]?.sequence).toBe("selected-focus");

    const stale = enqueueB2MotionTrigger(state, trigger("relay-offline-is-not-stale", "devin-stale", 24));
    expect(stale.accepted).toBe(false);
    expect(stale.reason).toBe("stale-activity-seq");
  });

  it("makes render and tab re-enqueues no-ops for the same stable key", () => {
    let state = createB2MotionRuntimeState();
    state = accept(state, trigger("render-stable", "selected-focus"));

    const whileActive = enqueueB2MotionTrigger(state, trigger("render-stable", "selected-focus"));
    expect(whileActive.state).toBe(state);

    state = clearActiveB2MotionTrigger(state, "render-stable");
    const afterTabReturn = enqueueB2MotionTrigger(state, trigger("render-stable", "selected-focus"));
    expect(afterTabReturn.accepted).toBe(false);
    expect(afterTabReturn.reason).toBe("duplicate-event-key");
    expect(afterTabReturn.state).toBe(state);
  });

  it("clears active work terminally and promotes the next trigger", () => {
    let state = createB2MotionRuntimeState();
    state = accept(state, trigger("cancelled"));
    state = accept(state, trigger("next"));

    state = clearActiveB2MotionTrigger(state, "cancelled");
    expect(state.active?.eventKey).toBe("next");
    expect(state.playedEventKeys).toContain("cancelled");
  });

  it("clears all pending work without allowing it to replay on remount", () => {
    let state = createB2MotionRuntimeState({ lastActivitySeq: 6 });
    state = accept(state, trigger("active", "node-appearing", 7));
    state = accept(state, trigger("queued", "devin-event", 8));
    state = clearB2MotionQueue(state);

    expect(state.active).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.playedEventKeys).toEqual(["active", "queued"]);
    expect(state.lastActivitySeq).toBe(8);
    expect(enqueueB2MotionTrigger(state, trigger("queued", "devin-event", 9)).reason)
      .toBe("duplicate-event-key");
  });

  it("bounds completed key history to the newest 64 keys", () => {
    let state = createB2MotionRuntimeState();
    for (let index = 0; index < B2_MOTION_PLAYED_KEY_LIMIT + 6; index += 1) {
      const eventKey = `event-${String(index).padStart(2, "0")}`;
      state = accept(state, trigger(eventKey, "node-appearing", index));
      state = completeActiveB2MotionTrigger(state, eventKey);
    }

    expect(state.playedEventKeys).toHaveLength(B2_MOTION_PLAYED_KEY_LIMIT);
    expect(state.playedEventKeys[0]).toBe("event-06");
    expect(state.playedEventKeys.at(-1)).toBe("event-69");

    const oldPersistentEvent = enqueueB2MotionTrigger(
      state,
      trigger("event-00", "node-appearing", 0),
    );
    expect(oldPersistentEvent.accepted).toBe(false);
    expect(oldPersistentEvent.reason).toBe("stale-activity-seq");
  });

  it("sanitizes hydrated played keys and rejects invalid initial cursors", () => {
    const keys = Array.from(
      { length: B2_MOTION_PLAYED_KEY_LIMIT + 2 },
      (_, index) => `key-${index}`,
    );
    const state = createB2MotionRuntimeState({
      playedEventKeys: [" ", "key-0", ...keys, "key-2"],
    });
    expect(state.playedEventKeys).toHaveLength(B2_MOTION_PLAYED_KEY_LIMIT);
    expect(new Set(state.playedEventKeys).size).toBe(B2_MOTION_PLAYED_KEY_LIMIT);
    expect(() => createB2MotionRuntimeState({ lastActivitySeq: -1 })).toThrow(RangeError);
    expect(() => createB2MotionRuntimeState({ lastActivitySeq: 1.5 })).toThrow(RangeError);
  });

  it("rejects malformed runtime trigger data without changing state", () => {
    const state = createB2MotionRuntimeState();
    const malformed: B2MotionTrigger[] = [
      { ...trigger("valid"), eventKey: " " },
      { ...trigger("valid"), targetId: "" },
      { ...trigger("valid"), pathId: "  " },
      { ...trigger("valid"), activitySeq: -1 },
      { ...trigger("valid"), activitySeq: 1.2 },
      { ...trigger("valid"), sequence: "unknown" as B2MotionTrigger["sequence"] },
    ];

    for (const item of malformed) {
      expect(enqueueB2MotionTrigger(state, item)).toEqual({
        accepted: false,
        state,
        reason: "invalid-trigger",
      });
    }
  });

  it("only resets dedupe state when explicitly starting a new runtime", () => {
    let state = accept(createB2MotionRuntimeState(), trigger("old"));
    state = completeActiveB2MotionTrigger(state, "old");

    const reset = resetB2MotionRuntime({ lastActivitySeq: 100 });
    expect(reset).toEqual({
      active: null,
      queue: [],
      playedEventKeys: [],
      lastActivitySeq: 100,
    });
    expect(enqueueB2MotionTrigger(reset, trigger("old", "selected-focus")).accepted).toBe(true);
  });
});
