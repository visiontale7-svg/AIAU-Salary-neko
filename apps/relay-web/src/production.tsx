import { useEffect, useMemo, useState } from "react";
import { RelayRoom } from "@dialogue-atlas/relay-room";
import type { SupabaseClientLike } from "@dialogue-atlas/relay-supabase";
import { RelayWebApp } from "./App";
import { createRelayWebAdapters, type RelayWebAdapters } from "./supabase-adapters";

export interface RelayProductionConfig {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

export interface RelayRoute {
  roomId?: string;
  inviteToken?: string;
}

export interface RelayLocationLike {
  pathname: string;
  search: string;
  hash?: string;
}

export interface RelayHistoryLike {
  state?: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface RelayProductionAppProps {
  config?: RelayProductionConfig;
  location?: RelayLocationLike;
  history?: RelayHistoryLike;
  storage?: Storage | null;
  allowLoopbackHttp?: boolean;
}

interface RelayAuthResult<T> {
  data: T;
  error: { message: string } | null;
}

export type RelayAnonymousClient = SupabaseClientLike & {
  auth: SupabaseClientLike["auth"] & {
    getSession(): PromiseLike<RelayAuthResult<{ session: unknown | null }>>;
    signInAnonymously(): PromiseLike<RelayAuthResult<{ session: unknown | null }>>;
  };
};

export type RelayAnonymousClientFactory = (url: string, publishableKey: string) => Promise<RelayAnonymousClient> | RelayAnonymousClient;

export function parseRelayRoute(location: RelayLocationLike): RelayRoute {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams((location.hash ?? "").replace(/^#/, ""));
  const pathMatch = /^\/room\/([^/]+)\/?$/.exec(location.pathname);
  let roomId: string | undefined;
  if (pathMatch?.[1]) {
    try {
      roomId = decodeURIComponent(pathMatch[1]);
    } catch {
      roomId = undefined;
    }
  }
  return {
    roomId: roomId || query.get("room") || undefined,
    inviteToken: fragment.get("invite") || undefined,
  };
}

export function canonicalRelayRoomPath(roomId: string): string {
  return `/room/${encodeURIComponent(roomId)}`;
}

export function sanitizeRedeemedInviteRoute(roomId: string, history: RelayHistoryLike): string {
  const path = canonicalRelayRoomPath(roomId);
  history.replaceState(history.state ?? null, "", path);
  return path;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function validateRelayProductionConfig(
  config: RelayProductionConfig,
  allowLoopbackHttp = false,
): string | undefined {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return "Relay is not configured on this deployment. The public Supabase URL and publishable key are required.";
  }
  try {
    const url = new URL(config.supabaseUrl);
    const permittedLoopback = allowLoopbackHttp
      && url.protocol === "http:"
      && isLoopbackHost(url.hostname);
    if (url.protocol !== "https:" && !permittedLoopback) {
      return "Relay configuration requires an HTTPS Supabase URL.";
    }
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      return "Relay configuration requires a bare Supabase HTTPS origin without credentials, path, query, or fragment.";
    }
  } catch {
    return "Relay configuration contains an invalid Supabase URL.";
  }
  return undefined;
}

export async function bootstrapRelayAnonymousClient(
  config: Required<RelayProductionConfig>,
  factory?: RelayAnonymousClientFactory,
  allowLoopbackHttp = false,
): Promise<SupabaseClientLike> {
  const configError = validateRelayProductionConfig(config, allowLoopbackHttp);
  if (configError) throw new Error(configError);
  const create = factory ?? (async (url: string, key: string) => {
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }) as unknown as RelayAnonymousClient;
  });
  const client = await create(config.supabaseUrl, config.supabasePublishableKey);
  const current = await client.auth.getSession();
  if (current.error) throw new Error(current.error.message);
  if (!current.data.session) {
    const signedIn = await client.auth.signInAnonymously();
    if (signedIn.error || !signedIn.data.session) {
      throw new Error(signedIn.error?.message ?? "Anonymous authentication returned no session");
    }
  }
  return client;
}

export function RelayProductionApp({
  config,
  location,
  history,
  storage,
  allowLoopbackHttp = false,
}: RelayProductionAppProps) {
  const effectiveConfig = config ?? {
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  const effectiveLocation = location ?? (typeof window !== "undefined" ? window.location : { pathname: "/", search: "", hash: "" });
  const route = useMemo(
    () => parseRelayRoute(effectiveLocation),
    [effectiveLocation.hash, effectiveLocation.pathname, effectiveLocation.search],
  );
  const configError = validateRelayProductionConfig(effectiveConfig, allowLoopbackHttp);
  const routeError = !route.roomId && !route.inviteToken
    ? "Open a Relay room URL such as /room/:id or use an invite link. No public room listing is exposed."
    : undefined;
  const [adapters, setAdapters] = useState<RelayWebAdapters | null>(null);
  const [authError, setAuthError] = useState<string | undefined>();

  useEffect(() => {
    if (configError || routeError || !effectiveConfig.supabaseUrl || !effectiveConfig.supabasePublishableKey) return;
    let cancelled = false;
    void (async () => {
      const client = await bootstrapRelayAnonymousClient({
        supabaseUrl: effectiveConfig.supabaseUrl!,
        supabasePublishableKey: effectiveConfig.supabasePublishableKey!,
      }, undefined, allowLoopbackHttp);
      if (!cancelled) {
        setAdapters(createRelayWebAdapters(client));
      }
    })().catch(() => {
      if (!cancelled) setAuthError("Anonymous room access could not start. Confirm Anonymous Auth and public client configuration, then try again.");
    });

    return () => { cancelled = true; };
  }, [allowLoopbackHttp, configError, routeError, effectiveConfig.supabasePublishableKey, effectiveConfig.supabaseUrl]);

  const error = configError ?? routeError ?? authError;
  if (error) {
    return <RelayRoom model={{ phase: "error", message: error, retryable: false }} />;
  }
  if (!adapters) {
    return <RelayRoom model={{ phase: "anonymous_bootstrap", message: "Starting anonymous room access with the configured public client." }} />;
  }
  return (
    <RelayWebApp
      repository={adapters.repository}
      realtime={adapters.realtime}
      initialRoomId={route.roomId}
      initialInviteToken={route.inviteToken}
      storage={storage}
      readyView="b2"
      onInviteRedeemed={(roomId) => {
        const targetHistory = history ?? (typeof window !== "undefined" ? window.history : undefined);
        if (targetHistory) sanitizeRedeemedInviteRoute(roomId, targetHistory);
      }}
    />
  );
}
