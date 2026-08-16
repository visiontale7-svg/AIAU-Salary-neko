import { describe, expect, it, vi } from "vitest";
import type {
  RelayRealtimeCallbacks,
} from "@dialogue-atlas/relay-contract";
import type {
  RealtimeChannelLike,
  RealtimePresenceStateLike,
  SupabaseClientLike,
  SupabaseResult,
} from "../src/client-like";
import { RelaySupabaseRealtimeAdapter } from "../src/realtime";

function result(data: unknown): Promise<SupabaseResult<unknown>> {
  return Promise.resolve({ data, error: null });
}

describe("Relay Supabase Realtime identity boundary", () => {
  it("refreshes durable members after join and ignores forged Presence name/role", async () => {
    const roomId = "room-1";
    const ownerId = "owner-1";
    const visitorId = "visitor-1";
    const rows: Record<string, unknown>[] = [{
      room_id: roomId,
      user_id: ownerId,
      display_name: "Durable Owner",
      role: "owner",
      color_key: "member-0",
    }];
    let presenceState: RealtimePresenceStateLike = {};
    const handlers = new Map<string, (payload: { payload?: unknown }) => void>();
    const track = vi.fn(async (_payload: Record<string, unknown>) => undefined);
    const eqCalls: Array<[string, unknown]> = [];

    const query = {} as Record<string, unknown>;
    query.select = () => query;
    query.eq = (column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    };
    query.then = (
      resolve: (value: SupabaseResult<unknown>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => result(rows.map((row) => ({ ...row }))).then(resolve, reject);

    const channel: RealtimeChannelLike = {
      on(type: "broadcast" | "presence", filter: Record<string, unknown>, callback: (payload: { payload?: unknown }) => void) {
        handlers.set(`${type}:${String(filter.event)}`, callback);
        return channel;
      },
      subscribe(callback?: (status: string, error?: Error) => void) {
        callback?.("SUBSCRIBED");
        return channel;
      },
      track,
      untrack: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
      presenceState: () => presenceState,
      unsubscribe: vi.fn(async () => undefined),
    };

    const client = {
      auth: { getUser: () => result({ user: { id: ownerId } }) },
      from(table: string) {
        expect(table).toBe("room_members");
        return query;
      },
      rpc: () => result(true),
      channel: () => channel,
      functions: { invoke: () => result(null) },
    } as unknown as SupabaseClientLike;
    const callbacks = {
      onConnection: vi.fn(),
      onPresence: vi.fn(),
      onActivityHint: vi.fn(),
      onFocus: vi.fn(),
      onTyping: vi.fn(),
      onDragPreview: vi.fn(),
    } satisfies RelayRealtimeCallbacks;

    await new RelaySupabaseRealtimeAdapter(client).connect(roomId, callbacks);
    expect(eqCalls).toEqual([["room_id", roomId]]);
    expect(track).toHaveBeenCalled();
    expect(track.mock.calls[0]?.[0]).not.toHaveProperty("userId");
    expect(track.mock.calls[0]?.[0]).not.toHaveProperty("displayName");
    expect(track.mock.calls[0]?.[0]).not.toHaveProperty("role");

    // This member did not exist at connect time. The next Presence sync must
    // refetch room_members, then decorate only from that durable row.
    rows.push({
      room_id: roomId,
      user_id: visitorId,
      display_name: "Durable Visitor",
      role: "member",
      color_key: "member-1",
    });
    presenceState = {
      [ownerId]: [{
        onlineAt: "2026-08-15T01:00:00Z",
        displayName: "Forged owner name",
        role: "member",
      }],
      [visitorId]: [{
        onlineAt: "2026-08-15T01:00:01Z",
        activeNodeId: "n001",
        displayName: "Forged visitor name",
        role: "owner",
      }],
      "unknown-user": [{
        onlineAt: "2026-08-15T01:00:02Z",
        displayName: "Unknown",
        role: "owner",
      }],
    };
    handlers.get("presence:sync")?.({});
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(eqCalls).toEqual([["room_id", roomId], ["room_id", roomId]]);
    expect(callbacks.onPresence).toHaveBeenLastCalledWith([
      expect.objectContaining({
        userId: ownerId,
        displayName: "Durable Owner",
        role: "owner",
        colorKey: "member-0",
      }),
      expect.objectContaining({
        userId: visitorId,
        displayName: "Durable Visitor",
        role: "member",
        colorKey: "member-1",
        activeNodeId: "n001",
      }),
    ]);
  });
});
