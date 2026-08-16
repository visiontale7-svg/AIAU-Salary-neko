import type {
  ConnectionState,
  PresenceMember,
  RelayRealtimeAdapter,
  RelayRealtimeCallbacks,
  RelayRealtimeSession,
  RoomMember,
} from "@dialogue-atlas/relay-contract";
import type {
  RealtimeChannelLike,
  RealtimePresenceMetaLike,
  SupabaseClientLike,
} from "./client-like";
import { requireArray, requireData } from "./errors";
import { mapMember } from "./row-mappers";

function connectionState(status: string): ConnectionState | undefined {
  switch (status) {
    case "SUBSCRIBED":
      return "live";
    case "CHANNEL_ERROR":
    case "TIMED_OUT":
      return "reconnecting";
    case "CLOSED":
      return "offline";
    default:
      return undefined;
  }
}

function payloadObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapPresenceMeta(
  roomId: string,
  member: RoomMember,
  value: RealtimePresenceMetaLike,
): PresenceMember | undefined {
  const onlineAt = optionalString(value.onlineAt);
  if (!onlineAt) return undefined;
  return {
    roomId,
    userId: member.userId,
    displayName: member.displayName,
    role: member.role,
    colorKey: member.colorKey,
    onlineAt,
    activeNodeId: optionalString(value.activeNodeId),
    editingNodeId: optionalString(value.editingNodeId),
    viewingVersionId: optionalString(value.viewingVersionId),
  };
}

class SupabaseRealtimeSession implements RelayRealtimeSession {
  private closed = false;
  private presence: Record<string, unknown>;

  constructor(
    private readonly client: SupabaseClientLike,
    private readonly roomId: string,
    private readonly channel: RealtimeChannelLike,
    private readonly callbacks: RelayRealtimeCallbacks,
  ) {
    this.presence = {
      onlineAt: new Date().toISOString(),
    };
  }

  async setPresence(input: {
    activeNodeId?: string;
    editingNodeId?: string;
    viewingVersionId?: string;
  }): Promise<void> {
    if (this.closed) throw new Error("Relay Realtime session is closed");
    this.presence = {
      ...this.presence,
      activeNodeId: input.activeNodeId,
      editingNodeId: input.editingNodeId,
      viewingVersionId: input.viewingVersionId,
      onlineAt: new Date().toISOString(),
    };
    await this.channel.track(this.presence);
  }

  async broadcastFocus(nodeId?: string): Promise<void> {
    await this.broadcast("focus", { nodeId });
  }

  async broadcastTyping(targetId: string, typing: boolean): Promise<void> {
    await this.broadcast("typing", { targetId, typing });
  }

  async broadcastDragPreview(nodeId: string, x: number, y: number): Promise<void> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("Relay drag preview coordinates must be finite");
    }
    await this.broadcast("drag_preview", { nodeId, x, y });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.channel.untrack();
    } finally {
      await this.channel.unsubscribe();
      this.callbacks.onConnection("offline");
    }
  }

  async trackInitial(): Promise<void> {
    if (!this.closed) await this.channel.track(this.presence);
  }

  private async broadcast(event: string, payload: Record<string, unknown>): Promise<void> {
    if (this.closed) throw new Error("Relay Realtime session is closed");
    requireData("broadcast Relay ephemeral event", await this.client.rpc("broadcast_relay_ephemeral", {
      p_room_id: this.roomId,
      p_event: event,
      p_payload: payload,
    }));
  }
}

export class RelaySupabaseRealtimeAdapter implements RelayRealtimeAdapter {
  constructor(private readonly client: SupabaseClientLike) {}

  async connect(roomId: string, callbacks: RelayRealtimeCallbacks): Promise<RelayRealtimeSession> {
    callbacks.onConnection("connecting");
    const userResult = await this.client.auth.getUser();
    const user = requireData("get Relay Realtime user", userResult).user;
    if (!user) throw new Error("get Relay Realtime user: authentication required");
    const memberByUserId = new Map<string, RoomMember>();
    let memberRefresh: Promise<void> | undefined;
    let lastUnknownMemberRefreshAt = 0;
    const refreshDurableMembers = (): Promise<void> => {
      if (memberRefresh) return memberRefresh;
      memberRefresh = (async () => {
        const result = await this.client
          .from("room_members")
          .select("*")
          .eq("room_id", roomId);
        const durableMembers = requireArray("load Relay Realtime members", result).map(mapMember);
        memberByUserId.clear();
        for (const member of durableMembers) memberByUserId.set(member.userId, member);
      })().finally(() => {
        memberRefresh = undefined;
      });
      return memberRefresh;
    };
    const refreshUnknownDurableMembers = async (): Promise<void> => {
      const now = Date.now();
      if (now - lastUnknownMemberRefreshAt < 1_000) return;
      lastUnknownMemberRefreshAt = now;
      try {
        await refreshDurableMembers();
      } catch (error) {
        // A later Presence sync or member_joined activity hint may retry. Keep
        // the subscribed channel live and continue rendering already-known
        // durable identities meanwhile.
        lastUnknownMemberRefreshAt = 0;
        throw error;
      }
    };
    await refreshDurableMembers();
    if (!memberByUserId.has(user.id)) {
      throw new Error("load Relay Realtime members: current user is not a room member");
    }

    const channel = this.client.channel(`room:${roomId}`, {
      config: {
        private: true,
        broadcast: { ack: true, self: false },
        presence: { key: user.id },
      },
    });
    const session = new SupabaseRealtimeSession(this.client, roomId, channel, callbacks);

    const emitPresence = async (): Promise<void> => {
      let state = channel.presenceState();
      if (Object.keys(state).some((presenceKey) => !memberByUserId.has(presenceKey))) {
        // A member can redeem an invitation after this channel connected. Load
        // the new durable membership before displaying their Presence, while
        // serializing concurrent sync refreshes.
        await refreshUnknownDurableMembers().catch(() => undefined);
        state = channel.presenceState();
      }
      const members = Object.entries(state)
        .flatMap(([presenceKey, metas]) => {
          const durableMember = memberByUserId.get(presenceKey);
          return durableMember
            ? metas.map((meta) => mapPresenceMeta(roomId, durableMember, meta))
            : [];
        })
        .filter((value): value is PresenceMember => value !== undefined);
      const unique = new Map(members.map((presence) => [presence.userId, presence]));
      callbacks.onPresence([...unique.values()]);
    };

    channel
      .on("presence", { event: "sync" }, () => {
        void emitPresence().catch(() => undefined);
      })
      .on("broadcast", { event: "activity" }, ({ payload }) => {
        const event = payloadObject(payload);
        if (!event || typeof event.seq !== "number" || typeof event.type !== "string") return;
        if (event.type === "member_joined") {
          void refreshUnknownDurableMembers()
            .then(emitPresence)
            .catch(() => undefined);
        }
        callbacks.onActivityHint({
          seq: event.seq,
          type: event.type,
          targetId: optionalString(event.targetId),
        });
      })
      .on("broadcast", { event: "focus" }, ({ payload }) => {
        const event = payloadObject(payload);
        if (!event || typeof event.userId !== "string") return;
        callbacks.onFocus({ userId: event.userId, nodeId: optionalString(event.nodeId) });
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const event = payloadObject(payload);
        if (!event
          || typeof event.userId !== "string"
          || typeof event.targetId !== "string"
          || typeof event.typing !== "boolean") return;
        callbacks.onTyping({ userId: event.userId, targetId: event.targetId, typing: event.typing });
      })
      .on("broadcast", { event: "drag_preview" }, ({ payload }) => {
        const event = payloadObject(payload);
        if (!event
          || typeof event.userId !== "string"
          || typeof event.nodeId !== "string"
          || typeof event.x !== "number"
          || typeof event.y !== "number"
          || !Number.isFinite(event.x)
          || !Number.isFinite(event.y)) return;
        callbacks.onDragPreview({
          userId: event.userId,
          nodeId: event.nodeId,
          x: event.x,
          y: event.y,
        });
      })
      .subscribe((status) => {
        const state = connectionState(status);
        if (state) callbacks.onConnection(state);
        if (status === "SUBSCRIBED") void session.trackInitial();
      });

    return session;
  }
}

export function createRelaySupabaseRealtimeAdapter(client: SupabaseClientLike): RelayRealtimeAdapter {
  return new RelaySupabaseRealtimeAdapter(client);
}
