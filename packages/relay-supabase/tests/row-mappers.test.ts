import { describe, expect, it } from "vitest";
import { mapDevinEvent, mapDevinRun } from "../src/row-mappers";

describe("Devin provider-health row mapping", () => {
  it("keeps provider health separate from lifecycle state", () => {
    expect(mapDevinRun({
      id: "run-1",
      room_id: "room-1",
      action_brief_id: "brief-1",
      state: "working",
      status_detail: null,
      external_session_id: "devin-session123",
      external_url: "https://app.devin.ai/sessions/devin-session123",
      pull_request_url: null,
      pull_request_state: null,
      checks_state: "unknown",
      provider_health: "delayed",
      last_successful_poll_at: "2026-08-16T03:00:00.000Z",
      last_provider_event_at: "2026-08-16T02:59:58.000Z",
      consecutive_failures: 2,
      retry_after_at: "2026-08-16T03:00:45.000Z",
      updated_at: "2026-08-16T03:00:01.000Z",
    })).toMatchObject({
      state: "working",
      providerHealth: "delayed",
      consecutiveFailures: 2,
      retryAfterAt: "2026-08-16T03:00:45.000Z",
    });
  });

  it("preserves stable provider event identity and provenance", () => {
    expect(mapDevinEvent({
      id: "event-1",
      run_id: "run-1",
      external_event_id: "provider-message-1",
      event_type: "provider_message",
      actor_type: "devin",
      created_at: "2026-08-16T03:00:00.000Z",
      text: "Checks completed",
    })).toEqual({
      id: "event-1",
      runId: "run-1",
      externalEventId: "provider-message-1",
      eventType: "provider_message",
      actorType: "devin",
      createdAt: "2026-08-16T03:00:00.000Z",
      text: "Checks completed",
    });
  });

  it("fails closed on invalid health counters or actor provenance", () => {
    expect(() => mapDevinRun({
      id: "run-1",
      room_id: "room-1",
      action_brief_id: "brief-1",
      state: "working",
      provider_health: "healthy",
      consecutive_failures: -1,
      updated_at: "2026-08-16T03:00:00.000Z",
    })).toThrow(/consecutive failures/i);
    expect(() => mapDevinEvent({
      id: "event-1",
      run_id: "run-1",
      external_event_id: null,
      event_type: "provider_message",
      actor_type: "browser",
      created_at: "2026-08-16T03:00:00.000Z",
      text: "Unsafe provenance",
    })).toThrow(/actor type/i);
  });
});
