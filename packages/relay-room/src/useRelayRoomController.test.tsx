import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ActivityEvent,
  RelayRealtimeAdapter,
  RelayRealtimeCallbacks,
  RelayRoomRepository,
  RoomBundle,
} from "@dialogue-atlas/relay-contract";
import { RelayRoomRuntime } from "./RelayRoomRuntime";
import { testBundle } from "./test-fixture";
import { isDevinPollDue, mergeActivityEvents, useRelayRoomController } from "./useRelayRoomController";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function repository(bundle: RoomBundle, overrides: Partial<RelayRoomRepository> = {}): RelayRoomRepository {
  return {
    createRoomWithPackage: vi.fn(async () => ({ roomId: bundle.room.id, inviteToken: "invite_test" })),
    publishAtlasVersion: vi.fn(async () => ({ atlasVersionId: "version_next", version: 2, activitySeq: bundle.lastActivitySeq + 1 })),
    createRoomInvite: vi.fn(async () => ({ inviteToken: "invite_next" })),
    closeRoom: vi.fn(async () => ({ activitySeq: bundle.lastActivitySeq + 1 })),
    joinRoom: vi.fn(async () => ({ roomId: bundle.room.id })),
    fetchRoom: vi.fn(async () => bundle),
    loadActivity: vi.fn(async () => []),
    upsertTeamGraphItem: vi.fn(async () => ({ value: bundle.teamItems[0]!, activitySeq: bundle.lastActivitySeq + 1 })),
    saveLayoutItem: vi.fn(async () => ({ value: bundle.layout[0]!, activitySeq: bundle.lastActivitySeq + 1 })),
    setNodeStance: vi.fn(async ({ roomId, nodeId, stance }) => ({ value: { roomId, nodeId, stance, userId: bundle.member.userId, updatedAt: "2026-08-15T04:00:00.000Z" }, activitySeq: bundle.lastActivitySeq + 1 })),
    submitProposal: vi.fn(async (input) => ({ value: { ...input, id: "proposal_new", status: "open", revision: 1, createdBy: bundle.member.userId, createdAt: "2026-08-15T04:00:00.000Z" }, activitySeq: bundle.lastActivitySeq + 1 })),
    appendProposalComment: vi.fn(async ({ roomId, proposalId, body, clientMutationId }) => ({ value: { id: "comment_new", roomId, proposalId, body, clientMutationId, createdBy: bundle.member.userId, createdAt: "2026-08-15T04:00:00.000Z" }, activitySeq: bundle.lastActivitySeq + 1 })),
    decideProposal: vi.fn(async ({ roomId, proposalId, decision, rationale }) => ({ value: { id: "decision_new", roomId, proposalId, decision, rationale, decidedBy: bundle.member.userId, decidedAt: "2026-08-15T04:00:00.000Z" }, activitySeq: bundle.lastActivitySeq + 1 })),
    createActionBrief: vi.fn(async (input) => ({ value: { ...input, id: "brief_new", createdBy: bundle.member.userId, createdAt: "2026-08-15T04:00:00.000Z" }, activitySeq: bundle.lastActivitySeq + 1 })),
    createDevinRun: vi.fn(async ({ roomId, actionBriefId }) => ({ id: "devin_new", roomId, actionBriefId, state: "queued" as const, providerHealth: "unknown" as const, consecutiveFailures: 0, updatedAt: "2026-08-15T04:00:00.000Z" })),
    refreshDevinRun: vi.fn(async ({ roomId, runId }) => ({ id: runId, roomId, actionBriefId: "brief_1", state: "working" as const, providerHealth: "healthy" as const, consecutiveFailures: 0, lastSuccessfulPollAt: "2026-08-15T04:00:00.000Z", updatedAt: "2026-08-15T04:00:00.000Z" })),
    sendDevinMessage: vi.fn(async ({ roomId, runId }) => ({ id: runId, roomId, actionBriefId: "brief_1", state: "working" as const, providerHealth: "healthy" as const, consecutiveFailures: 0, lastSuccessfulPollAt: "2026-08-15T04:00:00.000Z", updatedAt: "2026-08-15T04:00:00.000Z" })),
    fetchDevinEvents: vi.fn(async () => []),
    ...overrides,
  };
}

function realtime(calls: string[], receive: (callbacks: RelayRealtimeCallbacks) => void): RelayRealtimeAdapter {
  return {
    connect: vi.fn(async (_roomId, callbacks) => {
      calls.push("subscribe");
      receive(callbacks);
      callbacks.onConnection("live");
      return {
        setPresence: vi.fn(async () => undefined),
        broadcastFocus: vi.fn(async () => undefined),
        broadcastTyping: vi.fn(async () => undefined),
        broadcastDragPreview: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      };
    }),
  };
}

describe("Relay room activity sequencing", () => {
  it("does not poll a provider run before its durable retry deadline", () => {
    const now = Date.parse("2026-08-16T04:00:00.000Z");
    expect(isDevinPollDue({ state: "working", retryAfterAt: "2026-08-16T04:00:30.000Z" }, now)).toBe(false);
    expect(isDevinPollDue({ state: "working", retryAfterAt: "2026-08-16T03:59:59.000Z" }, now)).toBe(true);
    expect(isDevinPollDue({ state: "completed", retryAfterAt: "2026-08-16T03:59:59.000Z" }, now)).toBe(false);
  });

  it("de-duplicates durable events in sequence order", () => {
    const event = (seq: number): ActivityEvent => ({ roomId: "room_test", seq, type: "changed", createdAt: "2026-08-15T04:00:00.000Z" });
    expect(mergeActivityEvents(18, [event(20), event(17), event(19), event(20)])).toEqual({
      events: [event(19), event(20)],
      lastSeq: 20,
    });
  });

  it("subscribes before its first fetch, replays after the snapshot cursor, and refreshes hinted activity", async () => {
    const calls: string[] = [];
    let handlers: RelayRealtimeCallbacks | undefined;
    const replayed: ActivityEvent = { roomId: testBundle.room.id, seq: 19, type: "team_graph_item_upserted", targetId: "team_node_1", createdAt: "2026-08-15T04:00:00.000Z" };
    const updated = { ...testBundle, room: { ...testBundle.room, title: "Relay activity caught up" }, lastActivitySeq: 19 };
    const fetchRoom = vi.fn(async () => {
      calls.push("fetch");
      return fetchRoom.mock.calls.length === 1 ? testBundle : updated;
    });
    const loadActivity = vi.fn(async (_roomId: string, afterSeq: number) => {
      calls.push(`replay:${afterSeq}`);
      return loadActivity.mock.calls.length === 1 ? [] : afterSeq < 19 ? [replayed] : [];
    });
    const adapter = repository(testBundle, { fetchRoom, loadActivity });

    render(<RelayRoomRuntime repository={adapter} realtime={realtime(calls, (value) => { handlers = value; })} initialRoomId={testBundle.room.id} storage={null} />);
    await screen.findByRole("heading", { name: testBundle.room.title });
    await waitFor(() => expect(screen.getByText("Live collaboration")).toBeInTheDocument());
    expect(calls.indexOf("subscribe")).toBeLessThan(calls.indexOf("fetch"));
    expect(loadActivity).toHaveBeenCalledWith(testBundle.room.id, 18);

    await act(async () => { handlers?.onActivityHint({ seq: 19, type: replayed.type, targetId: replayed.targetId }); });
    await screen.findByRole("heading", { name: "Relay activity caught up" });
    expect(fetchRoom).toHaveBeenCalledTimes(2);
    expect(loadActivity.mock.calls.some(([, afterSeq]) => afterSeq === 18)).toBe(true);
    expect(loadActivity.mock.calls.some(([, afterSeq]) => afterSeq === 19)).toBe(true);
  });

  it("exposes only durable activity confirmed while already live, never initial or reconnect replay", async () => {
    const calls: string[] = [];
    let handlers: RelayRealtimeCallbacks | undefined;
    let current = testBundle;
    const durableLiveEvent: ActivityEvent = {
      roomId: testBundle.room.id,
      seq: 19,
      type: "team_graph_item_upserted",
      targetId: "durable_team_node",
      createdAt: "2026-08-15T04:00:00.000Z",
    };
    const adapter = repository(testBundle, {
      fetchRoom: vi.fn(async () => current),
      loadActivity: vi.fn(async (_roomId, afterSeq) => current.lastActivitySeq >= 19 && afterSeq < 19 ? [durableLiveEvent] : []),
    });
    const realtimeAdapter = realtime(calls, (value) => { handlers = value; });

    function Probe() {
      const controller = useRelayRoomController({ repository: adapter, realtime: realtimeAdapter, initialRoomId: testBundle.room.id, storage: null });
      const events = controller.model.phase === "ready" ? controller.model.confirmedLiveActivity ?? [] : [];
      return <output aria-label="confirmed live activity">{JSON.stringify(events)}</output>;
    }

    render(<Probe />);
    await waitFor(() => expect(handlers).toBeDefined());
    await waitFor(() => expect(screen.getByLabelText("confirmed live activity")).toHaveTextContent("[]"));

    current = { ...testBundle, lastActivitySeq: 19 };
    await act(async () => { handlers?.onActivityHint({ seq: 19, type: "forged_hint_type", targetId: "forged_hint_target" }); });
    await waitFor(() => expect(screen.getByLabelText("confirmed live activity")).toHaveTextContent('"seq":19'));
    expect(screen.getByLabelText("confirmed live activity")).toHaveTextContent('"type":"team_graph_item_upserted"');
    expect(screen.getByLabelText("confirmed live activity")).toHaveTextContent('"targetId":"durable_team_node"');
    expect(screen.getByLabelText("confirmed live activity")).not.toHaveTextContent("forged_hint");

    await act(async () => { handlers?.onConnection("reconnecting"); });
    current = { ...current, lastActivitySeq: 20 };
    await act(async () => { handlers?.onActivityHint({ seq: 20, type: "team_graph_item_upserted", targetId: "team_node_2" }); });
    await act(async () => { handlers?.onConnection("live"); });
    await waitFor(() => expect(screen.getByLabelText("confirmed live activity")).not.toHaveTextContent('"seq":20'));
  });

  it("reuses the same Devin request identity after an unconfirmed response", async () => {
    const withoutRun: RoomBundle = { ...testBundle, devinRuns: [] };
    const createDevinRun = vi.fn(async (_input: Parameters<RelayRoomRepository["createDevinRun"]>[0]) => { throw new Error("provider response timeout"); });
    const adapter = repository(withoutRun, { createDevinRun });
    const storage = memoryStorage();
    const firstMount = render(<RelayRoomRuntime repository={adapter} initialRoomId={withoutRun.room.id} storage={storage} />);
    await screen.findByRole("heading", { name: withoutRun.room.title });
    await waitFor(() => expect(screen.getByText("Live collaboration")).toBeInTheDocument());
    act(() => { screen.getByRole("tab", { name: "Handoff" }).click(); });

    act(() => { screen.getByRole("button", { name: "Request Devin run" }).click(); });
    await screen.findByText(/outcome is unconfirmed/i);
    firstMount.unmount();

    render(<RelayRoomRuntime repository={adapter} initialRoomId={withoutRun.room.id} storage={storage} />);
    await screen.findByRole("heading", { name: withoutRun.room.title });
    await waitFor(() => expect(screen.getByText("Live collaboration")).toBeInTheDocument());
    act(() => { screen.getByRole("tab", { name: "Handoff" }).click(); });
    act(() => { screen.getByRole("button", { name: "Request Devin run" }).click(); });
    await waitFor(() => expect(createDevinRun).toHaveBeenCalledTimes(2));
    expect(createDevinRun.mock.calls[0]?.[0].clientRequestId).toBe(createDevinRun.mock.calls[1]?.[0].clientRequestId);
  });

  it("classifies a durable Devin follow-up rejection so the form can rotate its request id", async () => {
    const sendDevinMessage = vi.fn(async (_input: Parameters<RelayRoomRepository["sendDevinMessage"]>[0]) => {
      throw new Error("provider rejected follow-up");
    });
    const loadActivity = vi.fn(async (_roomId: string, _afterSeq: number): Promise<ActivityEvent[]> => {
      const request = sendDevinMessage.mock.calls.at(-1)?.[0];
      if (!request) return [];
      return [{
        roomId: testBundle.room.id,
        seq: testBundle.lastActivitySeq + 1,
        type: "devin_follow_up_rejected",
        targetId: request.runId,
        clientMutationId: request.clientRequestId,
        createdAt: "2026-08-15T04:10:00.000Z",
      }];
    });
    const adapter = repository(testBundle, { sendDevinMessage, loadActivity });

    render(<RelayRoomRuntime repository={adapter} initialRoomId={testBundle.room.id} storage={null} />);
    await screen.findByRole("heading", { name: testBundle.room.title });
    await waitFor(() => expect(screen.getByText("Live collaboration")).toBeInTheDocument());
    act(() => { screen.getByRole("tab", { name: "Handoff" }).click(); });
    const message = screen.getByLabelText("Message to the approved run");
    fireEvent.change(message, { target: { value: "Retry after policy adjustment." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText(/message was rejected/i);
    expect(message).toHaveValue("Retry after policy adjustment.");
  });
});
