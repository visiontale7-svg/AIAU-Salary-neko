import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  RelaySupabaseRealtimeAdapter,
  RelaySupabaseRepository,
  type SupabaseClientLike,
} from "@dialogue-atlas/relay-supabase";
import type { ActivityEvent, ConnectionState, PresenceMember } from "@dialogue-atlas/relay-contract";
import { describe, expect, it } from "vitest";
import { relayFixturePackage } from "./fixture";

const localEnabled = process.env.RELAY_LOCAL_SUPABASE_SMOKE === "1";
const linkedEnabled = process.env.RELAY_LINKED_SUPABASE_SMOKE === "1";
const enabled = localEnabled || linkedEnabled;
let anonymousClientSequence = 0;

interface AnonymousIdentity {
  client: SupabaseClient<any, "public", any>;
  repository: RelaySupabaseRepository;
  userId: string;
}

async function signInAnonymousForSmoke(client: SupabaseClient<any, "public", any>) {
  const deadline = Date.now() + (localEnabled ? 60_000 : 0);
  while (true) {
    const auth = await client.auth.signInAnonymously();
    if (!auth.error || !localEnabled
      || !/database error (?:creating anonymous user|saving new user)/i.test(auth.error.message)
      || Date.now() >= deadline) {
      return auth;
    }
    // A freshly reset local stack can briefly accept requests before GoTrue
    // observes the final Auth schema. Retry only this known local startup race;
    // hosted failures and every other Auth error remain fail-fast.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function publicConfig(): { url: string; publishableKey: string } {
  if (localEnabled === linkedEnabled) {
    throw new Error("Select exactly one Relay Supabase smoke environment");
  }
  const fileName = localEnabled ? ".env.local" : ".env.production.local";
  const file = path.resolve(import.meta.dirname, `../../../${fileName}`);
  const values = Object.fromEntries(readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
  const url = values.VITE_SUPABASE_URL;
  const publishableKey = values.VITE_SUPABASE_PUBLISHABLE_KEY;
  const parsed = new URL(url ?? "");
  const validOrigin = localEnabled
    ? parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"
    : parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
  if (!validOrigin || parsed.username || parsed.password || parsed.search || parsed.hash
    || !publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("Supabase public client configuration is missing or unsafe");
  }
  return { url, publishableKey };
}

describe.skipIf(!enabled)("Supabase integration", () => {
  it("authenticates anonymous owner/member identities and enforces room RLS", async () => {
    const { url, publishableKey } = publicConfig();
    const createAnonymousIdentity = async (): Promise<AnonymousIdentity> => {
      const client = createClient(url, publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `relay-smoke-${++anonymousClientSequence}`,
        },
      });
      const auth = await signInAnonymousForSmoke(client);
      if (auth.error || !auth.data.session || !auth.data.user) {
        throw new Error(auth.error?.message ?? "Anonymous authentication returned no session");
      }
      return {
        client,
        repository: new RelaySupabaseRepository(client as unknown as SupabaseClientLike),
        userId: auth.data.user.id,
      };
    };

    const owner = await createAnonymousIdentity();
    const suffix = Date.now().toString(36);
    const pkg = structuredClone(relayFixturePackage);
    pkg.packageId = `pkg_rls_smoke_${suffix}`;
    pkg.clientPublishId = `publish_rls_smoke_${suffix}`;
    pkg.title = "Relay RLS smoke room";
    pkg.publishedAt = new Date().toISOString();

    const created = await owner.repository.createRoomWithPackage(pkg, { maxUses: 2 });
    const member = await createAnonymousIdentity();
    await expect(member.repository.joinRoom(created.inviteToken, "Local reviewer"))
      .resolves.toEqual({ roomId: created.roomId });

    const ownerBundle = await owner.repository.fetchRoom(created.roomId);
    const memberBundle = await member.repository.fetchRoom(created.roomId);
    expect(ownerBundle.member.role).toBe("owner");
    expect(memberBundle.member.role).toBe("member");

    const outsider = await createAnonymousIdentity();
    await expect(outsider.repository.fetchRoom(created.roomId)).rejects.toThrow();
    const outsiderRooms = await outsider.client.from("rooms").select("id").eq("id", created.roomId);
    expect(outsiderRooms.error).toBeNull();
    expect(outsiderRooms.data).toEqual([]);
    const directWrite = await outsider.client.from("rooms").insert({ owner_id: outsider.userId, title: "forbidden" } as never);
    expect(directWrite.error?.message).toMatch(/permission denied/i);
    await expect(member.repository.createRoomInvite(created.roomId, { maxUses: 1 })).rejects.toThrow(/owner_required/i);

    const stanceInput = {
      roomId: created.roomId,
      nodeId: "n001",
      stance: "challenge" as const,
      clientMutationId: `stance-${suffix}`,
    };
    const firstStance = await member.repository.setNodeStance(stanceInput);
    const repeatedStance = await member.repository.setNodeStance(stanceInput);
    expect(repeatedStance).toEqual(firstStance);

    const layoutInput = {
      roomId: created.roomId,
      nodeId: "n001",
      x: 144,
      y: 233,
      expectedRevision: 0,
      clientMutationId: `layout-${suffix}`,
    };
    const firstLayout = await member.repository.saveLayoutItem(layoutInput);
    expect(await member.repository.saveLayoutItem(layoutInput)).toEqual(firstLayout);
    await expect(member.repository.saveLayoutItem({
      ...layoutInput,
      x: 155,
      clientMutationId: `layout-stale-${suffix}`,
    })).rejects.toThrow(/revision_conflict/i);

    const updatedOwnerBundle = await owner.repository.fetchRoom(created.roomId);
    expect(updatedOwnerBundle.stances).toContainEqual(expect.objectContaining({
      nodeId: "n001",
      userId: member.userId,
      stance: "challenge",
    }));
    expect(updatedOwnerBundle.layout).toContainEqual(expect.objectContaining({
      nodeId: "n001",
      x: 144,
      y: 233,
      revision: 1,
    }));

    const immutableSourceWrite = await owner.client
      .from("atlas_versions")
      .update({ package: { ...pkg, title: "forbidden source rewrite" } } as never)
      .eq("room_id", created.roomId);
    expect(immutableSourceWrite.error?.message).toMatch(/permission denied/i);

    await expect(owner.repository.closeRoom(created.roomId)).resolves.toEqual({ activitySeq: expect.any(Number) });
    const lateGuest = await createAnonymousIdentity();
    await expect(lateGuest.repository.joinRoom(created.inviteToken, "Too late")).rejects.toThrow(/invalid_or_expired_invite/i);
  });

  it("keeps private Presence and ephemeral events synchronized across two anonymous clients", async () => {
    const { url, publishableKey } = publicConfig();
    const createIdentity = async (): Promise<AnonymousIdentity> => {
      const client = createClient(url, publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `relay-smoke-${++anonymousClientSequence}`,
        },
      });
      const auth = await signInAnonymousForSmoke(client);
      if (auth.error || !auth.data.session || !auth.data.user) throw new Error(auth.error?.message ?? "anonymous auth failed");
      await client.realtime.setAuth(auth.data.session.access_token);
      return {
        client,
        repository: new RelaySupabaseRepository(client as unknown as SupabaseClientLike),
        userId: auth.data.user.id,
      };
    };
    const owner = await createIdentity();
    const suffix = `${Date.now().toString(36)}-realtime`;
    const pkg = structuredClone(relayFixturePackage);
    pkg.packageId = `pkg_${suffix}`;
    pkg.clientPublishId = `publish_${suffix}`;
    pkg.title = "Relay Realtime smoke room";
    pkg.publishedAt = new Date().toISOString();
    const created = await owner.repository.createRoomWithPackage(pkg, { maxUses: 2 });

    const outsider = await createIdentity();
    const outsiderStatuses: string[] = [];
    const outsiderChannel = outsider.client.channel(`room:${created.roomId}`, {
      config: { private: true, broadcast: { ack: true, self: false }, presence: { key: outsider.userId } },
    });
    outsiderChannel.subscribe((status) => outsiderStatuses.push(status));
    await waitUntil(
      () => outsiderStatuses.includes("CHANNEL_ERROR") || outsiderStatuses.includes("TIMED_OUT"),
      "non-member private-channel rejection",
    );
    expect(outsiderStatuses).not.toContain("SUBSCRIBED");
    await outsiderChannel.unsubscribe();

    const ownerConnections: ConnectionState[] = [];
    let ownerPresence: PresenceMember[] = [];
    const ownerFocus: Array<{ userId: string; nodeId?: string }> = [];
    const ownerDrags: Array<{ userId: string; nodeId: string; x: number; y: number }> = [];
    const ownerActivities: Array<Pick<ActivityEvent, "seq" | "type" | "targetId">> = [];
    const ownerRealtime = new RelaySupabaseRealtimeAdapter(owner.client as unknown as SupabaseClientLike);
    const ownerSession = await ownerRealtime.connect(created.roomId, {
      onConnection: (state) => ownerConnections.push(state),
      onPresence: (members) => { ownerPresence = members; },
      onActivityHint: (event) => ownerActivities.push(event),
      onFocus: (event) => ownerFocus.push(event),
      onTyping: () => undefined,
      onDragPreview: (event) => ownerDrags.push(event),
    });
    await waitUntil(() => ownerConnections.includes("live"), "owner private channel subscription");

    const member = await createIdentity();
    await member.repository.joinRoom(created.inviteToken, "Realtime reviewer");
    const memberConnections: ConnectionState[] = [];
    const memberFocus: Array<{ userId: string; nodeId?: string }> = [];
    const memberRealtime = new RelaySupabaseRealtimeAdapter(member.client as unknown as SupabaseClientLike);
    const memberSession = await memberRealtime.connect(created.roomId, {
      onConnection: (state) => memberConnections.push(state),
      onPresence: () => undefined,
      onActivityHint: () => undefined,
      onFocus: (event) => memberFocus.push(event),
      onTyping: () => undefined,
      onDragPreview: () => undefined,
    });
    await waitUntil(() => memberConnections.includes("live"), "member private channel subscription");
    await memberSession.setPresence({ activeNodeId: "n002", viewingVersionId: pkg.packageId });
    await waitUntil(() => ownerPresence.some((presence) => presence.userId === member.userId && presence.activeNodeId === "n002"), "late-joining member Presence");

    const forgedIdentity = await member.client.rpc("broadcast_relay_ephemeral", {
      p_room_id: created.roomId,
      p_event: "focus",
      p_payload: { nodeId: "n001", userId: owner.userId },
    });
    expect(forgedIdentity.error?.message).toMatch(/(?:unexpected|unsupported) keys/i);

    await ownerSession.broadcastFocus("n001");
    await waitUntil(() => memberFocus.some((event) => event.userId === owner.userId && event.nodeId === "n001"), "authenticated focus broadcast");
    await memberSession.broadcastDragPreview("n002", 321, 234);
    await waitUntil(() => ownerDrags.some((event) => event.userId === member.userId && event.x === 321 && event.y === 234), "authenticated drag preview");

    await member.repository.setNodeStance({
      roomId: created.roomId,
      nodeId: "n002",
      stance: "confirm",
      clientMutationId: `realtime-stance-${suffix}`,
    });
    await waitUntil(() => ownerActivities.some((event) => event.type === "node_stance_set" && event.targetId === "n002"), "durable activity hint");
    const replayed = await owner.repository.loadActivity(created.roomId, 0);
    expect(replayed.some((event) => event.type === "node_stance_set" && event.targetId === "n002")).toBe(true);

    await memberSession.close();
    await ownerSession.close();
  }, 25_000);
});
