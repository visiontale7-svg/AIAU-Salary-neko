import { describe, expect, it } from "vitest";
import type { ActivityEvent, RoomBundle } from "@dialogue-atlas/relay-contract";
import { createRelayFixtureBundle } from "../fixture";
import {
  deriveStaleDevinNodeTargets,
  mapConfirmedActivityToB2Motion,
  mapSelectionToB2Motion,
} from "./b2-activity-motion";

function hint(seq: number, type: string, targetId?: string): Pick<ActivityEvent, "seq" | "type" | "targetId"> {
  return { seq, type, ...(targetId ? { targetId } : {}) };
}

function withNewTeamNode(): { previous: RoomBundle; current: RoomBundle } {
  const previous = createRelayFixtureBundle();
  previous.teamItems = previous.teamItems.filter((item) => item.id !== "team_node_demo" && item.id !== "team_edge_demo");
  const current = createRelayFixtureBundle();
  return { previous, current };
}

describe("B2 ActivityMotionMapper", () => {
  it("maps only a newly persisted team node delivered during a live connection", () => {
    const { previous, current } = withNewTeamNode();
    expect(mapConfirmedActivityToB2Motion(hint(22, "team_graph_item_upserted", "team_node_demo"), {
      connection: "live", delivery: "live", previous, current,
    })).toEqual({
      eventKey: "activity:22",
      activitySeq: 22,
      sequence: "node-appearing",
      targetId: "team_node_demo",
      pathId: "team_edge_demo",
    });

    expect(mapConfirmedActivityToB2Motion(hint(22, "team_graph_item_upserted", "team_node_demo"), {
      connection: "live", delivery: "initial", previous, current,
    })).toBeNull();
    expect(mapConfirmedActivityToB2Motion(hint(22, "team_graph_item_upserted", "team_node_demo"), {
      connection: "live", delivery: "replay", previous, current,
    })).toBeNull();
    expect(mapConfirmedActivityToB2Motion(hint(22, "team_graph_item_upserted", "team_node_demo"), {
      connection: "live", delivery: "live", previous: current, current,
    })).toBeNull();
  });

  it("maps a confirmed Devin provider event back to the decision target", () => {
    const current = createRelayFixtureBundle();
    expect(mapConfirmedActivityToB2Motion(hint(23, "devin_events_appended", "devin_demo"), {
      connection: "live", delivery: "live", current,
    })).toEqual({
      eventKey: "devin-event:devin_demo:23",
      activitySeq: 23,
      sequence: "devin-event",
      targetId: "n005",
      pathId: "r004",
    });
  });

  it("requires explicit provider health and never infers stale from Relay connectivity", () => {
    const current = createRelayFixtureBundle();
    expect(mapConfirmedActivityToB2Motion(hint(24, "devin_provider_health_stale", "devin_demo"), {
      connection: "live", delivery: "live", current,
    })).toEqual({
      eventKey: "devin-stale:devin_demo:24",
      activitySeq: 24,
      sequence: "devin-stale",
      targetId: "n005",
    });
    for (const connection of ["connecting", "reconnecting", "offline"] as const) {
      expect(mapConfirmedActivityToB2Motion(hint(24, "devin_provider_health_stale", "devin_demo"), {
        connection, delivery: "live", current,
      })).toBeNull();
    }
    expect(mapConfirmedActivityToB2Motion(hint(24, "devin_run_updated", "devin_demo"), {
      connection: "live", delivery: "live", current,
    })).toBeNull();
  });

  it("derives stale decoration from durable provider health and never animates recovery", () => {
    const current = createRelayFixtureBundle();
    const stale = {
      ...current,
      devinRuns: current.devinRuns.map((run) => ({ ...run, providerHealth: "stale" as const })),
    };
    const recovered = hint(25, "devin_provider_health_recovered", "devin_demo");
    const context = { connection: "live" as const, delivery: "live" as const, current };
    expect([...deriveStaleDevinNodeTargets(stale)]).toEqual(["n005"]);
    expect([...deriveStaleDevinNodeTargets(current)]).toEqual([]);
    expect(mapConfirmedActivityToB2Motion(recovered, context)).toBeNull();
  });

  it("ignores malformed, unrelated, missing-target, and edge-only events", () => {
    const current = createRelayFixtureBundle();
    for (const event of [
      hint(-1, "team_graph_item_upserted", "team_node_demo"),
      hint(25, "proposal_submitted", "proposal_open_demo"),
      hint(26, "team_graph_item_upserted", "team_edge_demo"),
      hint(27, "devin_events_appended", "missing_run"),
      hint(28, "team_graph_item_upserted"),
    ]) {
      expect(mapConfirmedActivityToB2Motion(event, { connection: "live", delivery: "live", current })).toBeNull();
    }
  });

  it("creates stable local selection keys without moving the durable cursor", () => {
    expect(mapSelectionToB2Motion("n005", 3)).toEqual({ eventKey: "selection:n005:3", sequence: "selected-focus", targetId: "n005" });
    expect(mapSelectionToB2Motion("", 3)).toBeNull();
    expect(mapSelectionToB2Motion("n005", -1)).toBeNull();
  });
});
