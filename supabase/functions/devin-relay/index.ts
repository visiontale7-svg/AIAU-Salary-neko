import {
  CANONICAL_REPOSITORY,
  PolicyError,
  canonicalPullRequestUrl,
  parseRelayRequest,
  sanitizeActionBrief,
  type DevinRelayRequest,
} from "./policy.ts";
import {
  DevinProviderError,
  DevinV3Provider,
  readDevinProviderConfig,
  type DevinProviderConfig,
  type DevinProviderEvent,
  type DevinProviderSnapshot,
} from "./provider.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

interface CachedRun {
  expiresAt: number;
  run: Record<string, unknown>;
}

interface RunReservation {
  run: Record<string, unknown>;
  providerAuthorized: boolean;
  operatorMaxAcuLimit?: number;
  shouldStart: boolean;
}

interface FollowUpReservation {
  run: Record<string, unknown>;
  shouldSend: boolean;
  deliveryStatus: "pending" | "sent" | "rejected" | "unknown";
}

interface OwnerRunContext {
  run: Record<string, unknown>;
  providerMessageCursor?: string;
}

const STATUS_CACHE_MS = 5_000;
const MAX_STATUS_CACHE_ENTRIES = 256;
const statusCache = new Map<string, CachedRun>();

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) {
    super(message);
    this.name = "HttpError";
  }
}

function allowedOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("RELAY_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin") ?? undefined;
  if (!origin) return undefined;
  if (!allowedOrigins().has(origin)) throw new HttpError(403, "origin_not_allowed");
  return origin;
}

function responseHeaders(origin: string | undefined, cacheControl: string): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": cacheControl,
    vary: "origin, authorization",
    "x-content-type-options": "nosniff",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, apikey, content-type, x-client-info");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
  }
  return headers;
}

function json(status: number, body: unknown, origin?: string, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin, cacheControl),
  });
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    throw new HttpError(401, "authentication_required");
  }
  return authorization;
}

interface SupabaseConfiguration {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

function supabaseConfiguration(): SupabaseConfiguration {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || undefined;
  if (!url || !anonKey) throw new HttpError(503, "not_configured");
  return { url: url.replace(/\/$/, ""), anonKey, serviceRoleKey };
}

async function supabaseRequest(
  path: string,
  authorization: string,
  apiKey: string,
  init: RequestInit,
): Promise<unknown> {
  const config = supabaseConfiguration();
  const result = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      authorization,
      "content-type": "application/json",
      accept: "application/json",
      ...init.headers,
    },
  });
  const body = await result.json().catch(() => null) as unknown;
  if (!result.ok) {
    const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const message = typeof row.message === "string" ? row.message : "database_request_failed";
    if (message.includes("owner_required") || result.status === 401 || result.status === 403) {
      throw new HttpError(403, "owner_required");
    }
    if (message.includes("not_configured")) throw new HttpError(409, "not_configured");
    if (message.includes("devin_run_is_terminal")) throw new HttpError(409, "devin_run_is_terminal");
    throw new HttpError(502, "database_request_failed");
  }
  return body;
}

async function userRpc(
  name: string,
  authorization: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const config = supabaseConfiguration();
  return supabaseRequest(`rpc/${name}`, authorization, config.anonKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function serviceRequest(path: string, init: RequestInit): Promise<unknown> {
  const config = supabaseConfiguration();
  if (!config.serviceRoleKey) throw new HttpError(503, "not_configured");
  return supabaseRequest(path, `Bearer ${config.serviceRoleKey}`, config.serviceRoleKey, init);
}

async function serviceRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  return serviceRequest(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function object(value: unknown, code = "invalid_database_response"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(502, code);
  return value as Record<string, unknown>;
}

function runRecord(value: unknown): Record<string, unknown> {
  const row = object(value);
  for (const key of ["id", "roomId", "actionBriefId", "state", "providerHealth", "updatedAt"]) {
    if (typeof row[key] !== "string") throw new HttpError(502, "invalid_database_response");
  }
  if (!["healthy", "delayed", "stale", "unknown"].includes(row.providerHealth as string)
    || !Number.isSafeInteger(row.consecutiveFailures)
    || (row.consecutiveFailures as number) < 0) {
    throw new HttpError(502, "invalid_database_response");
  }
  const run: Record<string, unknown> = {
    id: row.id,
    roomId: row.roomId,
    actionBriefId: row.actionBriefId,
    state: row.state,
    providerHealth: row.providerHealth,
    consecutiveFailures: row.consecutiveFailures,
    updatedAt: row.updatedAt,
  };
  for (const key of [
    "externalSessionId",
    "externalUrl",
    "statusDetail",
    "pullRequestState",
    "checksState",
    "lastSuccessfulPollAt",
    "lastProviderEventAt",
    "retryAfterAt",
  ]) {
    if (typeof row[key] === "string") {
      if (key.endsWith("At") && !Number.isFinite(Date.parse(row[key] as string))) {
        throw new HttpError(502, "invalid_database_response");
      }
      run[key] = row[key];
    }
  }
  if (typeof row.pullRequestUrl === "string") {
    run.pullRequestUrl = canonicalPullRequestUrl(row.pullRequestUrl);
  }
  return run;
}

function retryAfterDeadline(run: Record<string, unknown>): number | undefined {
  if (typeof run.retryAfterAt !== "string") return undefined;
  const deadline = Date.parse(run.retryAfterAt);
  if (!Number.isFinite(deadline)) throw new HttpError(502, "invalid_database_response");
  return deadline;
}

function cacheExpiry(run: Record<string, unknown>, now: number): number {
  return Math.max(now + STATUS_CACHE_MS, retryAfterDeadline(run) ?? 0);
}

function providerRetryScheduled(run: Record<string, unknown>, now = Date.now()): boolean {
  return (retryAfterDeadline(run) ?? 0) > now;
}

function runReservation(value: unknown): RunReservation {
  const row = object(value);
  const providerAuthorized = row.providerAuthorized;
  if (typeof providerAuthorized !== "boolean") throw new HttpError(502, "invalid_database_response");
  if (typeof row.shouldStart !== "boolean") throw new HttpError(502, "invalid_database_response");
  const operatorMaxAcuLimit = row.operatorMaxAcuLimit;
  if (operatorMaxAcuLimit !== undefined
    && (!Number.isInteger(operatorMaxAcuLimit) || (operatorMaxAcuLimit as number) < 1)) {
    throw new HttpError(502, "invalid_database_response");
  }
  return {
    run: runRecord(row.run),
    providerAuthorized,
    operatorMaxAcuLimit: operatorMaxAcuLimit as number | undefined,
    shouldStart: row.shouldStart,
  };
}

function followUpReservation(value: unknown): FollowUpReservation {
  const row = object(value);
  if (typeof row.shouldSend !== "boolean") throw new HttpError(502, "invalid_database_response");
  if (!['pending', 'sent', 'rejected', 'unknown'].includes(String(row.deliveryStatus))) {
    throw new HttpError(502, "invalid_database_response");
  }
  return {
    run: runRecord(row.run),
    shouldSend: row.shouldSend,
    deliveryStatus: row.deliveryStatus as FollowUpReservation["deliveryStatus"],
  };
}

async function cacheKey(authorization: string, roomId: string, runId: string): Promise<string> {
  const bytes = new TextEncoder().encode(authorization);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const authHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${authHash}:${roomId}:${runId}`;
}

function pruneStatusCache(now: number): void {
  for (const [key, value] of statusCache) {
    if (value.expiresAt <= now) statusCache.delete(key);
  }
  while (statusCache.size >= MAX_STATUS_CACHE_ENTRIES) {
    const oldest = statusCache.keys().next().value as string | undefined;
    if (!oldest) break;
    statusCache.delete(oldest);
  }
}

async function loadOwnerRun(
  request: Extract<DevinRelayRequest, { operation: "status" | "follow_up" }>,
  authorization: string,
): Promise<OwnerRunContext> {
  const value = object(await userRpc("load_devin_run_for_owner", authorization, {
    p_room_id: request.roomId,
    p_run_id: request.runId,
  }));
  const providerMessageCursor = value.providerMessageCursor;
  if (providerMessageCursor !== undefined && typeof providerMessageCursor !== "string") {
    throw new HttpError(502, "invalid_database_response");
  }
  return { run: runRecord(value), providerMessageCursor };
}

function providerRuntime(): { provider: DevinV3Provider; config: DevinProviderConfig } | undefined {
  const config = readDevinProviderConfig((name) => Deno.env.get(name));
  if (!config || !supabaseConfiguration().serviceRoleKey) return undefined;
  return { provider: new DevinV3Provider(config), config };
}

function providerForReservation(
  runtime: { provider: DevinV3Provider; config: DevinProviderConfig },
  reservation: RunReservation,
): DevinV3Provider {
  if (!reservation.operatorMaxAcuLimit) throw new HttpError(502, "invalid_database_response");
  return new DevinV3Provider({
    ...runtime.config,
    maxAcuLimit: Math.min(runtime.config.maxAcuLimit, reservation.operatorMaxAcuLimit),
  });
}

async function updateRun(
  roomId: string,
  runId: string,
  snapshot: DevinProviderSnapshot,
  options: { pollSucceeded?: boolean } = {},
): Promise<Record<string, unknown>> {
  return runRecord(await serviceRpc("update_devin_run_snapshot", {
    p_room_id: roomId,
    p_run_id: runId,
    p_input: { ...snapshot, ...(options.pollSucceeded ? { pollSucceeded: true } : {}) },
  }));
}

async function recordProviderFailure(
  roomId: string,
  runId: string,
  error: DevinProviderError,
): Promise<Record<string, unknown>> {
  return runRecord(await serviceRpc("record_devin_provider_failure", {
    p_room_id: roomId,
    p_run_id: runId,
    p_error_code: error.code,
    p_retry_after_at: error.retryAfterAt ?? null,
  }));
}

async function appendProviderEvents(
  roomId: string,
  runId: string,
  events: DevinProviderEvent[],
  endCursor?: string,
): Promise<void> {
  if (events.length === 0 && !endCursor) return;
  await serviceRpc("append_devin_provider_events", {
    p_room_id: roomId,
    p_run_id: runId,
    p_events: events,
    p_end_cursor: endCursor ?? null,
  });
}

function asProviderHttpError(error: DevinProviderError): HttpError {
  const status = error.code === "provider_rate_limited" ? 429 : 502;
  return new HttpError(status, error.code);
}

async function startRun(
  request: Extract<DevinRelayRequest, { operation: "start" }>,
  authorization: string,
): Promise<Record<string, unknown>> {
  const runtime = providerRuntime();
  const reservation = runReservation(await userRpc("create_devin_run", authorization, {
    p_room_id: request.roomId,
    p_action_brief_id: request.actionBriefId,
    p_client_request_id: request.requestId,
    p_configured: runtime !== undefined,
  }));
  if (!runtime || !reservation.providerAuthorized) {
    return {
      ok: true,
      provider: "not_configured",
      repository: CANONICAL_REPOSITORY,
      run: reservation.run,
    };
  }
  if (typeof reservation.run.externalSessionId === "string") {
    return { ok: true, provider: "configured", repository: CANONICAL_REPOSITORY, run: reservation.run };
  }
  if (!reservation.shouldStart || reservation.run.state !== "queued") {
    // A blocked/failed/terminal reservation is a durable at-most-once result.
    // In particular, provider_result_unknown is never converted into a second
    // paid Session attempt by retrying this Edge request.
    return { ok: true, provider: "configured", repository: CANONICAL_REPOSITORY, run: reservation.run };
  }

  const rawBrief = await userRpc("load_action_brief_for_devin", authorization, {
    p_room_id: request.roomId,
    p_action_brief_id: request.actionBriefId,
  });
  const brief = sanitizeActionBrief(rawBrief);
  if (brief.roomId !== request.roomId || brief.id !== request.actionBriefId) {
    throw new HttpError(502, "invalid_database_response");
  }

  const provider = providerForReservation(runtime, reservation);
  const claimed = await serviceRpc("claim_devin_session_attempt", {
    p_room_id: request.roomId,
    p_run_id: reservation.run.id,
  });
  if (claimed !== true) {
    const current = await loadOwnerRun({
      operation: "status",
      roomId: request.roomId,
      runId: reservation.run.id as string,
    }, authorization);
    return {
      ok: true,
      provider: current.run.state === "not_configured" ? "not_configured" : "configured",
      repository: CANONICAL_REPOSITORY,
      run: current.run,
    };
  }
  try {
    const snapshot = await provider.createSession(brief, {
      roomId: request.roomId,
      clientRequestId: request.requestId,
    });
    const run = await updateRun(request.roomId, reservation.run.id as string, snapshot);
    statusCache.clear();
    return { ok: true, provider: "configured", repository: CANONICAL_REPOSITORY, run };
  } catch (error) {
    if (!(error instanceof DevinProviderError)) throw error;
    await recordProviderFailure(
      request.roomId,
      reservation.run.id as string,
      error,
    );
    await updateRun(request.roomId, reservation.run.id as string, {
      state: error.resultUnknown ? "blocked" : "failed",
      statusDetail: error.resultUnknown ? "provider_result_unknown" : "provider_request_rejected",
    }).catch(() => undefined);
    throw asProviderHttpError(error);
  }
}

async function refreshStatus(
  request: Extract<DevinRelayRequest, { operation: "status" }>,
  authorization: string,
): Promise<Record<string, unknown>> {
  const key = await cacheKey(authorization, request.roomId, request.runId);
  const now = Date.now();
  const cached = statusCache.get(key);
  if (cached && cached.expiresAt > now) return cached.run;
  pruneStatusCache(now);

  const context = await loadOwnerRun(request, authorization);
  const existing = context.run;
  const runtime = providerRuntime();
  if (!runtime || existing.state === "not_configured" || typeof existing.externalSessionId !== "string") {
    statusCache.set(key, { expiresAt: cacheExpiry(existing, now), run: existing });
    return existing;
  }
  if (providerRetryScheduled(existing, now)) {
    statusCache.set(key, { expiresAt: cacheExpiry(existing, now), run: existing });
    return existing;
  }

  try {
    const snapshot = await runtime.provider.getSession(existing.externalSessionId);
    await updateRun(request.roomId, request.runId, snapshot, { pollSucceeded: true });
    const page = await runtime.provider.getMessages(existing.externalSessionId, context.providerMessageCursor);
    await appendProviderEvents(request.roomId, request.runId, page.events, page.endCursor);
    const current = await loadOwnerRun(request, authorization);
    const run = current.run;
    statusCache.set(key, { expiresAt: cacheExpiry(run, now), run });
    return run;
  } catch (error) {
    if (error instanceof DevinProviderError) {
      const run = await recordProviderFailure(request.roomId, request.runId, error);
      statusCache.set(key, { expiresAt: cacheExpiry(run, now), run });
      return run;
    }
    throw error;
  }
}

async function sendFollowUp(
  request: Extract<DevinRelayRequest, { operation: "follow_up" }>,
  authorization: string,
): Promise<Record<string, unknown>> {
  // Authenticate the room owner before revealing provider configuration state.
  const ownerContext = await loadOwnerRun(request, authorization);
  const runtime = providerRuntime();
  if (!runtime) {
    // Do not reserve or acknowledge a durable follow-up when no provider can
    // actually deliver it. The client must retain the draft and retry only
    // after server configuration is restored, using the same request ID.
    throw new HttpError(503, "not_configured");
  }
  // The service-owned retry deadline (bounded backoff or provider Retry-After)
  // is checked before reserving a new at-most-once follow-up key.
  if (providerRetryScheduled(ownerContext.run)) {
    throw new HttpError(429, "provider_retry_scheduled");
  }
  // The owner-only RPC reserves the client request before the external side
  // effect. Retries are therefore at-most-once even if the provider times out.
  const reservation = followUpReservation(await userRpc("append_devin_follow_up", authorization, {
    p_room_id: request.roomId,
    p_run_id: request.runId,
    p_message: request.message,
    p_client_request_id: request.requestId,
  }));
  if (!reservation.shouldSend) {
    if (reservation.deliveryStatus === "sent") {
      return { ok: true, provider: "configured", repository: CANONICAL_REPOSITORY, run: reservation.run };
    }
    throw new HttpError(409, `follow_up_${reservation.deliveryStatus}`);
  }
  const externalSessionId = reservation.run.externalSessionId;
  if (typeof externalSessionId !== "string") throw new HttpError(409, "devin_session_not_started");
  try {
    await runtime.provider.sendMessage(externalSessionId, request.message, request.requestId);
    const run = runRecord(await serviceRpc("record_devin_follow_up_result", {
      p_room_id: request.roomId,
      p_run_id: request.runId,
      p_client_request_id: request.requestId,
      p_result: "sent",
    }));
    statusCache.clear();
    return { ok: true, provider: "configured", repository: CANONICAL_REPOSITORY, run };
  } catch (error) {
    if (error instanceof DevinProviderError) {
      await recordProviderFailure(request.roomId, request.runId, error);
      await serviceRpc("record_devin_follow_up_result", {
        p_room_id: request.roomId,
        p_run_id: request.runId,
        p_client_request_id: request.requestId,
        p_result: error.resultUnknown ? "unknown" : "rejected",
      }).catch(() => undefined);
      throw asProviderHttpError(error);
    }
    throw error;
  }
}

async function execute(request: DevinRelayRequest, authorization: string): Promise<Record<string, unknown>> {
  if (request.operation === "start") return startRun(request, authorization);
  if (request.operation === "follow_up") return sendFollowUp(request, authorization);
  return {
    ok: true,
    repository: CANONICAL_REPOSITORY,
    run: await refreshStatus(request, authorization),
  };
}

Deno.serve(async (request) => {
  let origin: string | undefined;
  try {
    origin = corsOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(origin, "no-store") });
    }
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") throw new HttpError(415, "json_required");
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(contentLength) || contentLength > 16_384) {
      throw new HttpError(413, "request_too_large");
    }
    const authorization = bearer(request);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
      throw new HttpError(413, "request_too_large");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new HttpError(400, "invalid_json");
    }
    const parsed = parseRelayRequest(body);
    const result = await execute(parsed, authorization);
    const cacheControl = parsed.operation === "status" ? "private, max-age=5" : "no-store";
    return json(200, result, origin, cacheControl);
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { ok: false, error: error.code }, origin);
    if (error instanceof PolicyError) return json(400, { ok: false, error: error.code }, origin);
    return json(500, { ok: false, error: "internal_error" }, origin);
  }
});
