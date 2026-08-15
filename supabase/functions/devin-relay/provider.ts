import {
  CANONICAL_REPOSITORY,
  PolicyError,
  canonicalPullRequestUrl,
  redactProviderText,
  type SanitizedActionBrief,
} from "./policy.ts";

export const DEVIN_API_BASE_URL = "https://api.devin.ai/v3" as const;

export interface DevinProviderConfig {
  apiKey: string;
  orgId: string;
  repo: typeof CANONICAL_REPOSITORY;
  maxAcuLimit: number;
}

export interface DevinProviderSnapshot {
  externalSessionId?: string;
  externalUrl?: string;
  state: "queued" | "working" | "needs_input" | "approval_needed" | "completed" | "failed" | "blocked";
  statusDetail?: string;
  pullRequestUrl?: string;
  pullRequestState?: string;
  checksState?: "unknown" | "pending" | "passing" | "failing";
}

export interface DevinProviderEvent {
  externalEventId: string;
  createdAt: string;
  text: string;
}

export interface DevinProviderEventPage {
  events: DevinProviderEvent[];
  endCursor?: string;
}

export class DevinProviderError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly resultUnknown = false,
  ) {
    super(message);
    this.name = "DevinProviderError";
  }
}

export function readDevinProviderConfig(
  get: (name: string) => string | undefined,
): DevinProviderConfig | undefined {
  const apiKey = get("DEVIN_API_KEY")?.trim();
  const orgId = get("DEVIN_ORG_ID")?.trim();
  const repo = get("DEVIN_REPO")?.trim();
  const maxAcuRaw = get("DEVIN_MAX_ACU_LIMIT")?.trim();
  if (!apiKey || !orgId || !repo || !maxAcuRaw) return undefined;
  const maxAcuLimit = Number(maxAcuRaw);
  if (!/^cog_[A-Za-z0-9_-]{12,}$/.test(apiKey)
    || !/^org-[A-Za-z0-9_-]{3,124}$/.test(orgId)
    || repo !== CANONICAL_REPOSITORY
    || !Number.isInteger(maxAcuLimit)
    || maxAcuLimit < 1
    || maxAcuLimit > 1000) {
    return undefined;
  }
  return { apiKey, orgId, repo, maxAcuLimit };
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DevinProviderError("invalid_provider_response", `${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sessionId(value: Record<string, unknown>): string {
  const id = optionalString(value.session_id) ?? optionalString(value.devin_id) ?? optionalString(value.id);
  return validatedSessionId(id);
}

function validatedSessionId(value: unknown): string {
  if (typeof value !== "string" || !/^devin-[A-Za-z0-9_-]{3,193}$/.test(value)) {
    throw new DevinProviderError("invalid_provider_response", "session id is invalid");
  }
  return value;
}

function sessionUrl(value: unknown, id: string): string {
  const candidate = optionalString(value) ?? `https://app.devin.ai/sessions/${encodeURIComponent(id)}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new DevinProviderError("invalid_provider_response", "session URL is invalid");
  }
  if (url.protocol !== "https:"
    || url.hostname !== "app.devin.ai"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || (url.pathname !== `/sessions/${id}` && url.pathname !== `/sessions/${id}/`)) {
    throw new DevinProviderError("invalid_provider_response", "session URL is outside app.devin.ai");
  }
  return url.toString();
}

function mapState(status: string, detail?: string): DevinProviderSnapshot["state"] {
  switch (status.toLowerCase()) {
    case "new":
    case "claimed":
      return "queued";
    case "running":
    case "resuming": {
      const normalized = detail?.toLowerCase() ?? "";
      if (normalized === "waiting_for_user") return "needs_input";
      if (normalized === "waiting_for_approval") return "approval_needed";
      if (normalized === "finished") return "completed";
      return "working";
    }
    case "exit":
      return "completed";
    case "error":
      return "failed";
    case "suspended": {
      const normalized = detail?.toLowerCase() ?? "";
      if (normalized.includes("approv")) return "approval_needed";
      if (normalized === "waiting_for_user"
        || normalized.includes("input")
        || normalized.includes("question")) return "needs_input";
      return "blocked";
    }
    default:
      throw new DevinProviderError("invalid_provider_response", "session status is unsupported");
  }
}

function pullRequest(value: Record<string, unknown>): Pick<
  DevinProviderSnapshot,
  "pullRequestUrl" | "pullRequestState" | "checksState"
> {
  const raw = value.pull_requests;
  if (raw === undefined || raw === null) return {};
  if (!Array.isArray(raw)) {
    throw new DevinProviderError("invalid_provider_response", "pull_requests must be an array");
  }
  let selected: { url: string; state?: string; checks?: DevinProviderSnapshot["checksState"] } | undefined;
  for (const entry of raw) {
    const row = typeof entry === "string" ? { url: entry } : object(entry, "pull request");
    const urlValue = optionalString(row.url) ?? optionalString(row.pr_url) ?? optionalString(row.html_url);
    if (!urlValue) continue;
    let url: string;
    try {
      url = canonicalPullRequestUrl(urlValue);
    } catch (error) {
      if (error instanceof PolicyError) {
        throw new DevinProviderError("invalid_provider_response", "provider returned an off-repository pull request");
      }
      throw error;
    }
    selected ??= {
      url,
      state: optionalString(row.pr_state) ?? optionalString(row.state),
      // Devin's PR object proves only that a PR was reported. CI truth must
      // come from a separately authenticated GitHub Checks integration.
      checks: "unknown",
    };
  }
  return selected ? {
    pullRequestUrl: selected.url,
    pullRequestState: selected.state,
    checksState: selected.checks,
  } : {};
}

function snapshot(value: Record<string, unknown>, includeIdentity: boolean): DevinProviderSnapshot {
  const status = optionalString(value.status);
  if (!status) throw new DevinProviderError("invalid_provider_response", "session status is missing");
  const statusDetail = optionalString(value.status_detail)
    ? redactProviderText(value.status_detail as string, 2000)
    : undefined;
  const id = includeIdentity ? sessionId(value) : undefined;
  return {
    externalSessionId: id,
    externalUrl: id ? sessionUrl(value.url ?? value.devin_url, id) : undefined,
    state: mapState(status, statusDetail),
    statusDetail,
    ...pullRequest(value),
  };
}

function prompt(brief: SanitizedActionBrief): string {
  return [
    "Execute this owner-approved Dialogue Atlas action brief.",
    `Repository: ${CANONICAL_REPOSITORY}`,
    `Baseline SHA: ${brief.baselineSha}`,
    `Title: ${brief.title}`,
    `Objective: ${brief.objective}`,
    `Allowed files: ${JSON.stringify(brief.allowedFiles)}`,
    `Acceptance commands: ${JSON.stringify(brief.acceptanceCommands)}`,
    `Forbidden actions: ${JSON.stringify(brief.forbiddenActions)}`,
    `Approved context: ${JSON.stringify(brief.approvedContext)}`,
    "Stay inside the allowed files. Run the listed acceptance commands and report exact results.",
  ].join("\n");
}

export class DevinV3Provider {
  constructor(
    private readonly config: DevinProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createSession(
    brief: SanitizedActionBrief,
    input: { roomId: string; clientRequestId: string },
  ): Promise<DevinProviderSnapshot> {
    try {
      const value = object(await this.requestJson("sessions", {
        method: "POST",
        idempotencyKey: input.clientRequestId,
        body: {
          prompt: prompt(brief),
          repos: [this.config.repo],
          max_acu_limit: this.config.maxAcuLimit,
          tags: ["dialogue-atlas-relay", `room:${input.roomId}`, `client-request:${input.clientRequestId}`],
          title: `Dialogue Atlas Relay: ${brief.title}`.slice(0, 200),
        },
      }), "create session response");
      const id = sessionId(value);
      const status = optionalString(value.status) ?? "new";
      return snapshot({ ...value, status, session_id: id }, true);
    } catch (error) {
      // A malformed success body can still represent a paid Session that was
      // created. The caller must reconcile by tag; it must never auto-retry.
      if (error instanceof DevinProviderError
        && error.code === "invalid_provider_response"
        && !error.resultUnknown) {
        throw new DevinProviderError(error.code, error.message, true);
      }
      throw error;
    }
  }

  async getSession(externalSessionId: string): Promise<DevinProviderSnapshot> {
    const id = validatedSessionId(externalSessionId);
    const value = object(await this.requestJson(`sessions/${encodeURIComponent(id)}`, {
      method: "GET",
    }), "session response");
    return snapshot(value, false);
  }

  async getMessages(externalSessionId: string, after?: string): Promise<DevinProviderEventPage> {
    const id = validatedSessionId(externalSessionId);
    const events: DevinProviderEvent[] = [];
    let cursor = after;
    let finalCursor = after;
    const maxPages = 5;
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ first: "200" });
      if (cursor) query.set("after", cursor);
      const response = object(await this.requestJson(
        `sessions/${encodeURIComponent(id)}/messages?${query.toString()}`,
        { method: "GET" },
      ), "messages response");
      const items = response.items;
      const hasNextPage = response.has_next_page;
      const endCursor = response.end_cursor === null ? undefined : optionalString(response.end_cursor);
      const total = response.total;
      if (!Array.isArray(items)
        || items.length > 200
        || typeof hasNextPage !== "boolean"
        || !Number.isSafeInteger(total)
        || (total as number) < 0
        || (hasNextPage && !endCursor)) {
        throw new DevinProviderError("invalid_provider_response", "messages response is invalid");
      }
      for (const [index, item] of items.entries()) {
        const row = object(item, `message ${index}`);
        const id = optionalString(row.event_id);
        const text = optionalString(row.message);
        const epoch = row.created_at;
        if (!id
          || !/^[A-Za-z0-9_.:-]{1,200}$/.test(id)
          || !text
          || typeof epoch !== "number"
          || !Number.isFinite(epoch)
          || epoch <= 0) {
          throw new DevinProviderError("invalid_provider_response", "provider message is invalid");
        }
        // Devin emits Unix epoch numbers. Accept seconds or milliseconds by
        // magnitude, then require a representable deterministic timestamp.
        const milliseconds = epoch < 1_000_000_000_000 ? epoch * 1000 : epoch;
        const date = new Date(milliseconds);
        if (Number.isNaN(date.valueOf())) {
          throw new DevinProviderError("invalid_provider_response", "provider message timestamp is invalid");
        }
        events.push({
          externalEventId: id,
          createdAt: date.toISOString(),
          text: redactProviderText(text, 6000),
        });
      }
      finalCursor = endCursor ?? finalCursor;
      if (!hasNextPage) return { events, endCursor: finalCursor };
      cursor = endCursor;
    }
    throw new DevinProviderError("provider_page_limit", "provider message page limit reached");
  }

  async sendMessage(
    externalSessionId: string,
    message: string,
    clientRequestId: string,
  ): Promise<void> {
    const id = validatedSessionId(externalSessionId);
    await this.requestJson(`sessions/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      idempotencyKey: clientRequestId,
      body: { message },
    });
  }

  private async requestJson(
    path: string,
    request: {
      method: "GET" | "POST";
      body?: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${DEVIN_API_BASE_URL}/organizations/${encodeURIComponent(this.config.orgId)}/${path}`,
        {
          method: request.method,
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            accept: "application/json",
            ...(request.body ? { "content-type": "application/json" } : {}),
            ...(request.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : {}),
          },
          body: request.body ? JSON.stringify(request.body) : undefined,
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new DevinProviderError(
        "provider_result_unknown",
        "provider request outcome is unknown",
        request.method === "POST",
      );
    }
    if (!response.ok) {
      const resultUnknown = request.method === "POST" && response.status >= 500;
      throw new DevinProviderError(
        response.status === 401 || response.status === 403
          ? "provider_permission_denied"
          : response.status >= 400 && response.status < 500
          ? "provider_request_rejected"
          : "provider_result_unknown",
        "provider request failed",
        resultUnknown,
      );
    }
    if (response.status === 204) return {};
    try {
      return await response.json() as unknown;
    } catch {
      throw new DevinProviderError("invalid_provider_response");
    }
  }
}
