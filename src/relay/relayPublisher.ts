import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RelayPackageV1, ShareReceipt } from "@dialogue-atlas/relay-contract";
import {
  createRelaySupabaseRealtimeAdapter,
  createRelaySupabaseRepository,
  type SupabaseClientLike,
} from "@dialogue-atlas/relay-supabase";
import type { RelayRealtimeAdapter, RelayRoomRepository } from "@dialogue-atlas/relay-contract";

interface RelayRuntimeConfig {
  supabaseUrl: string;
  publishableKey: string;
  relayWebUrl: string;
}

export interface PublishedRelayPackage {
  receipt: ShareReceipt;
  inviteUrl: string;
}

let cachedClient: SupabaseClient | undefined;

function envValue(name: string): string {
  const environment = import.meta.env as Record<string, unknown>;
  return typeof environment[name] === "string" ? environment[name].trim() : "";
}

export function validateRelayServiceUrl(value: string, label: string, allowLoopbackHttp = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL`);
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(allowLoopbackHttp && url.protocol === "http:" && loopback)) {
    throw new Error(`${label} 必须使用 HTTPS；显式本地联调只允许本机回环地址`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} 不能包含账号、查询参数或片段`);
  }
  return url.toString().replace(/\/$/, "");
}

export function relayRuntimeConfig(): RelayRuntimeConfig | null {
  const supabaseUrl = envValue("VITE_SUPABASE_URL");
  const publishableKey = envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  const relayWebUrl = envValue("VITE_RELAY_WEB_URL");
  if (!supabaseUrl || !publishableKey || !relayWebUrl) return null;
  // Vite production builds are also used for local debug app bundles. Keep
  // loopback HTTP behind an explicit build-time flag; normal development and
  // every unflagged production build remain HTTPS-only.
  const allowLoopbackHttp = import.meta.env.DEV || envValue("VITE_RELAY_LOCAL_INTEGRATION") === "1";
  return {
    supabaseUrl: validateRelayServiceUrl(supabaseUrl, "Supabase URL", allowLoopbackHttp),
    publishableKey,
    relayWebUrl: validateRelayServiceUrl(relayWebUrl, "Relay Web URL", allowLoopbackHttp),
  };
}

function clientFor(config: RelayRuntimeConfig): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(config.supabaseUrl, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "dialogue-atlas-relay-owner-v1",
      },
    });
  }
  return cachedClient;
}

async function ensureAnonymousSession(client: SupabaseClient): Promise<void> {
  const session = await client.auth.getSession();
  if (session.error) throw new Error(`无法读取 Relay 匿名身份：${session.error.message}`);
  if (session.data.session) return;
  const signedIn = await client.auth.signInAnonymously();
  if (signedIn.error || !signedIn.data.user) {
    throw new Error(`无法创建 Relay 匿名身份：${signedIn.error?.message ?? "服务未返回用户"}`);
  }
}

export async function relayRuntimeAdapters(): Promise<{
  repository: RelayRoomRepository;
  realtime: RelayRealtimeAdapter;
}> {
  const config = relayRuntimeConfig();
  if (!config) throw new Error("Relay 尚未配置");
  const client = clientFor(config);
  await ensureAnonymousSession(client);
  const compatible = client as unknown as SupabaseClientLike;
  return {
    repository: createRelaySupabaseRepository(compatible),
    realtime: createRelaySupabaseRealtimeAdapter(compatible),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function opaqueReceiptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `publication_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function relayRoomUrl(config: RelayRuntimeConfig, roomId: string): URL {
  return new URL(`/room/${encodeURIComponent(roomId)}`, `${config.relayWebUrl}/`);
}

function relayInviteUrl(config: RelayRuntimeConfig, roomId: string, inviteToken: string): string {
  const url = relayRoomUrl(config, roomId);
  // Keep the bearer invite out of Vercel request logs and HTTP referrers. The
  // Relay Web reads the fragment locally, redeems it, then removes it from the
  // browser history.
  url.hash = new URLSearchParams({ invite: inviteToken }).toString();
  return url.toString();
}

function inviteExpiry(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
}

export async function createRelayInvite(roomId: string): Promise<string> {
  const config = relayRuntimeConfig();
  if (!config) throw new Error("Relay 尚未配置");
  const client = clientFor(config);
  await ensureAnonymousSession(client);
  const repository = createRelaySupabaseRepository(client as unknown as SupabaseClientLike);
  const invite = await repository.createRoomInvite(roomId, {
    expiresAt: inviteExpiry(),
    maxUses: 20,
  });
  return relayInviteUrl(config, roomId, invite.inviteToken);
}

export async function publishRelayPackage(
  snapshotId: string,
  pkg: RelayPackageV1,
  targetRoomId?: string,
): Promise<PublishedRelayPackage> {
  const config = relayRuntimeConfig();
  if (!config) {
    throw new Error("Relay 尚未配置。请在构建环境设置 VITE_SUPABASE_URL、VITE_SUPABASE_PUBLISHABLE_KEY 和 VITE_RELAY_WEB_URL。");
  }
  const client = clientFor(config);
  await ensureAnonymousSession(client);
  const repository = createRelaySupabaseRepository(client as unknown as SupabaseClientLike);
  let roomId: string;
  let atlasVersionId: string;
  let inviteToken: string;
  if (targetRoomId) {
    const published = await repository.publishAtlasVersion(targetRoomId, pkg);
    const invite = await repository.createRoomInvite(targetRoomId, {
      expiresAt: inviteExpiry(),
      maxUses: 20,
    });
    roomId = targetRoomId;
    atlasVersionId = published.atlasVersionId;
    inviteToken = invite.inviteToken;
  } else {
    const created = await repository.createRoomWithPackage(pkg, {
      expiresAt: inviteExpiry(),
      maxUses: 20,
    });
    const room = await repository.fetchRoom(created.roomId);
    roomId = created.roomId;
    atlasVersionId = room.room.currentVersionId;
    inviteToken = created.inviteToken;
  }
  const relayUrl = relayRoomUrl(config, roomId).toString();
  return {
    receipt: {
      publicationId: opaqueReceiptId(),
      snapshotId,
      packageId: pkg.packageId,
      clientPublishId: pkg.clientPublishId,
      roomId,
      atlasVersionId,
      packageSha256: await sha256Hex(JSON.stringify(pkg)),
      relayUrl,
      publishedAt: pkg.publishedAt,
    },
    inviteUrl: relayInviteUrl(config, roomId, inviteToken),
  };
}
