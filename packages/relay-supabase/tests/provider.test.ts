import { describe, expect, it, vi } from "vitest";
import {
  DevinProviderError,
  DevinV3Provider,
  readDevinProviderConfig,
  type DevinProviderConfig,
} from "../../../supabase/functions/devin-relay/provider";
import {
  CANONICAL_REPOSITORY,
  sanitizeActionBrief,
} from "../../../supabase/functions/devin-relay/policy";

const ROOM_ID = "01890f47-5fac-7d92-a456-426614174000";
const BRIEF_ID = "223e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "323e4567-e89b-42d3-a456-426614174000";
const config: DevinProviderConfig = {
  apiKey: ["cog", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  orgId: "org-dialogue-atlas",
  repo: CANONICAL_REPOSITORY,
  maxAcuLimit: 7,
};
const brief = sanitizeActionBrief({
  id: BRIEF_ID,
  roomId: ROOM_ID,
  decisionId: DECISION_ID,
  title: "Implement Relay tests",
  objective: "Add deterministic offline checks.",
  baselineSha: "dbee0babc7480f25205783a00d2fe96cb65d350d",
  allowedFiles: ["supabase/tests/**"],
  acceptanceCommands: ["npm test"],
  forbiddenActions: ["Do not change product source"],
  approvedContext: ["Relay contract"],
  createdBy: ROOM_ID,
  createdAt: "2026-08-15T00:00:00Z",
});

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

describe("Devin v3 provider adapter", () => {
  it("fails closed unless every exact environment value is valid", () => {
    const values: Record<string, string> = {
      DEVIN_API_KEY: config.apiKey,
      DEVIN_ORG_ID: config.orgId,
      DEVIN_REPO: config.repo,
      DEVIN_MAX_ACU_LIMIT: "7",
    };
    expect(readDevinProviderConfig((name) => values[name])).toEqual(config);
    expect(readDevinProviderConfig((name) => name === "DEVIN_ORG_ID" ? "demo" : values[name])).toBeUndefined();
    expect(readDevinProviderConfig((name) => name === "DEVIN_REPO" ? "attacker/repo" : values[name])).toBeUndefined();
    expect(readDevinProviderConfig((name) => name === "DEVIN_MAX_ACU_LIMIT" ? "0" : values[name])).toBeUndefined();
    expect(readDevinProviderConfig((name) => name === "DEVIN_API_KEY" ? "token" : values[name])).toBeUndefined();
  });

  it("creates a v3 Session with only the pinned repository, bounded ACU, and approved brief", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      session_id: "devin-session123",
      url: "https://app.devin.ai/sessions/devin-session123",
      status: "new",
    }));
    const provider = new DevinV3Provider(config, fetchMock as unknown as typeof fetch);
    const snapshot = await provider.createSession(brief, {
      roomId: ROOM_ID,
      clientRequestId: "request_demo_001",
    });
    expect(snapshot).toMatchObject({
      externalSessionId: "devin-session123",
      state: "queued",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.devin.ai/v3/organizations/org-dialogue-atlas/sessions");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${config.apiKey}`);
    expect(new Headers(init.headers).get("idempotency-key")).toBe("request_demo_001");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["max_acu_limit", "prompt", "repos", "tags", "title"]);
    expect(body.repos).toEqual([CANONICAL_REPOSITORY]);
    expect(body.max_acu_limit).toBe(7);
    expect(body.prompt).toContain(brief.baselineSha);
    expect(body.prompt).toContain(JSON.stringify(brief.allowedFiles));
    expect(String(body.prompt)).not.toContain(config.apiKey);
  });

  it.each([
    ["running", "working", "working"],
    ["running", "waiting_for_user", "needs_input"],
    ["running", "waiting_for_approval", "approval_needed"],
    ["running", "finished", "completed"],
    ["resuming", "working", "working"],
    ["exit", "finished", "completed"],
    ["error", "provider error", "failed"],
    ["suspended", "waiting_for_user", "needs_input"],
  ])("maps status %s/%s to %s", async (status, statusDetail, expected) => {
    const provider = new DevinV3Provider(config, (async () => jsonResponse({
      status,
      status_detail: statusDetail,
    })) as typeof fetch);
    await expect(provider.getSession("devin-session123")).resolves.toMatchObject({ state: expected });
  });

  it("accepts PR data only from the canonical repository", async () => {
    const good = new DevinV3Provider(config, (async () => jsonResponse({
      status: "exit",
      pull_requests: [{
        pr_url: "https://github.com/visiontale7-svg/AIAU-Salary-neko/pull/42",
        pr_state: "open",
        checks_state: "success",
      }],
    })) as typeof fetch);
    await expect(good.getSession("devin-session123")).resolves.toMatchObject({
      pullRequestUrl: "https://github.com/visiontale7-svg/AIAU-Salary-neko/pull/42",
      pullRequestState: "open",
      checksState: "unknown",
    });

    const bad = new DevinV3Provider(config, (async () => jsonResponse({
      status: "exit",
      pull_requests: [{ pr_url: "https://github.com/attacker/repo/pull/1" }],
    })) as typeof fetch);
    await expect(bad.getSession("devin-session123")).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
  });

  it("paginates the official items cursor and redacts text before persistence", async () => {
    const jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiJzeW50aGV0aWMifQ",
      "synthetic_signature_123456",
    ].join(".");
    const opaqueBearer = ["synthetic", "opaque", "credential"].join("_");
    const basicCredential = ["c3ludGhldGlj", "Y3JlZGVudGlhbA=="].join("");
    const privateKeyBody = ["synthetic", "private", "material", "12345678"].join("_");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          event_id: "event-1",
          created_at: 1_765_756_800,
          message: [
            "Contact user@example.com at /srv/private/file with token=abcdefghijklmnop",
            `Authorization: Bearer ${jwt}`,
            `Authorization: Basic ${basicCredential}`,
            `Bearer ${opaqueBearer}`,
            "-----BEGIN PRIVATE KEY-----",
            privateKeyBody,
            "-----END PRIVATE KEY-----",
            "provider event finished",
          ].join("\n"),
        }],
        end_cursor: "cursor-1",
        has_next_page: true,
        total: 2,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ event_id: "event-2", created_at: 1_765_756_801_000, message: "Done" }],
        end_cursor: "cursor-2",
        has_next_page: false,
        total: 2,
      }));
    const provider = new DevinV3Provider(config, fetchMock as unknown as typeof fetch);
    const page = await provider.getMessages("devin-session123");
    expect(page.endCursor).toBe("cursor-2");
    expect(page.events).toHaveLength(2);
    expect(page.events[0]).toMatchObject({
      externalEventId: "event-1",
      eventType: "provider_message",
      actorType: "devin",
      createdAt: "2025-12-15T00:00:00.000Z",
    });
    expect(page.events[0]?.text).toContain("[REDACTED_EMAIL]");
    expect(page.events[0]?.text).toContain("[REDACTED_PATH]");
    expect(page.events[0]?.text).toContain("[REDACTED_SECRET]");
    expect(page.events[0]?.text).toContain("provider event finished");
    expect(page.events[0]?.text).not.toContain(jwt);
    expect(page.events[0]?.text).not.toContain(opaqueBearer);
    expect(page.events[0]?.text).not.toContain(basicCredential);
    expect(page.events[0]?.text).not.toContain(privateKeyBody);
    expect(page.events[0]?.text).not.toContain("BEGIN PRIVATE KEY");
    const secondUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain("first=200");
    expect(secondUrl).toContain("after=cursor-1");
  });

  it("rejects provider events without source timestamps", async () => {
    const provider = new DevinV3Provider(config, (async () => jsonResponse({
      items: [{ event_id: "event-1", message: "No timestamp" }],
      end_cursor: null,
      has_next_page: false,
      total: 1,
    })) as typeof fetch);
    await expect(provider.getMessages("devin-session123")).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
  });

  it("rejects malformed session IDs and message totals before accepting provider data", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: "running" }));
    const provider = new DevinV3Provider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.getSession("session-without-prefix")).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const badMessages = new DevinV3Provider(config, (async () => jsonResponse({
      items: [],
      end_cursor: null,
      has_next_page: false,
      total: "0",
    })) as typeof fetch);
    await expect(badMessages.getMessages("devin-session123")).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
  });

  it.each([
    [401, "provider_permission_denied"],
    [403, "provider_permission_denied"],
    [422, "provider_request_rejected"],
  ])("classifies provider HTTP %s without exposing response text", async (status, code) => {
    const provider = new DevinV3Provider(config, (async () => jsonResponse({ secret: "do not expose" }, status)) as typeof fetch);
    await expect(provider.getSession("devin-session123")).rejects.toMatchObject({ code, resultUnknown: false });
  });

  it("turns Retry-After into a deterministic bounded provider deadline", async () => {
    const now = Date.parse("2026-08-16T03:00:00.000Z");
    const seconds = new DevinV3Provider(
      config,
      (async () => jsonResponse({}, 429, { "retry-after": "45" })) as typeof fetch,
      () => now,
    );
    await expect(seconds.getSession("devin-session123")).rejects.toMatchObject({
      code: "provider_rate_limited",
      resultUnknown: false,
      retryAfterAt: "2026-08-16T03:00:45.000Z",
    });

    const httpDate = new DevinV3Provider(
      config,
      (async () => jsonResponse({}, 429, { "retry-after": "Sun, 16 Aug 2026 03:02:00 GMT" })) as typeof fetch,
      () => now,
    );
    await expect(httpDate.getSession("devin-session123")).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryAfterAt: "2026-08-16T03:02:00.000Z",
    });

    const invalid = new DevinV3Provider(
      config,
      (async () => jsonResponse({}, 429, { "retry-after": "invalid" })) as typeof fetch,
      () => now,
    );
    await expect(invalid.getSession("devin-session123")).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryAfterAt: "2026-08-16T03:00:30.000Z",
    });

    const capped = new DevinV3Provider(
      config,
      (async () => jsonResponse({}, 429, { "retry-after": "999999" })) as typeof fetch,
      () => now,
    );
    await expect(capped.getSession("devin-session123")).rejects.toMatchObject({
      code: "provider_rate_limited",
      retryAfterAt: "2026-08-17T03:00:00.000Z",
    });
  });

  it("marks a create timeout or 5xx as ambiguous so callers never auto-retry", async () => {
    const timeout = new DevinV3Provider(config, (async () => {
      throw new TypeError("network timeout with secret response");
    }) as typeof fetch);
    await expect(timeout.createSession(brief, {
      roomId: ROOM_ID,
      clientRequestId: "request_demo_002",
    })).rejects.toMatchObject({
      code: "provider_result_unknown",
      resultUnknown: true,
    });

    const serverError = new DevinV3Provider(config, (async () => jsonResponse({}, 503)) as typeof fetch);
    await expect(serverError.createSession(brief, {
      roomId: ROOM_ID,
      clientRequestId: "request_demo_003",
    })).rejects.toMatchObject({
      code: "provider_result_unknown",
      resultUnknown: true,
    });
  });

  it("sends follow-up messages to the exact v3 session path", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const provider = new DevinV3Provider(config, fetchMock as unknown as typeof fetch);
    await provider.sendMessage("devin-session123", "Run the approved checks", "request_demo_004");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.devin.ai/v3/organizations/org-dialogue-atlas/sessions/devin-session123/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ message: "Run the approved checks" });
  });
});
