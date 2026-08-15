export const CANONICAL_REPOSITORY = "visiontale7-svg/AIAU-Salary-neko" as const;

// PostgreSQL accepts canonical UUID text independently of the UUID version.
// Relay must therefore reject v7 and other canonical UUIDs in privacy scans,
// while also accepting them as identifiers at the API boundary.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CONTROL_GLOBAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const UUID_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const SECRET = /(?:sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----|\bauthorization\s*[:=]\s*[^\r\n,;]{8,}|\bBearer[ \t]+[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}|\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*[^\s,;]{8,})/i;
const ABSOLUTE_PATH = /(?:^|[\s"'`(])\/(?:[\p{L}\p{N}._~+\-]+\/)*[\p{L}\p{N}._~+\-]+/u;
const WINDOWS_PATH = /\b[A-Z]:\\(?:[^\\\s<>:"|?*]+\\?)+/i;
const WINDOWS_UNC_PATH = /\\\\[^\\\s<>:"|?*]+\\[^\\\s<>:"|?*]+/;
const BASELINE_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export type DevinRelayRequest =
  | { operation: "start"; roomId: string; actionBriefId: string; requestId: string }
  | { operation: "follow_up"; roomId: string; runId: string; message: string; requestId: string }
  | { operation: "status"; roomId: string; runId: string };

export interface SanitizedActionBrief {
  id: string;
  roomId: string;
  decisionId: string;
  title: string;
  objective: string;
  baselineSha: string;
  allowedFiles: string[];
  acceptanceCommands: string[];
  forbiddenActions: string[];
  approvedContext: string[];
  repository: typeof CANONICAL_REPOSITORY;
}

export class PolicyError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "PolicyError";
  }
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyError("invalid_request", `${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allow.has(key));
  if (unexpected.length > 0) {
    throw new PolicyError("invalid_request", `${context} contains unsupported keys: ${unexpected.sort().join(", ")}`);
  }
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new PolicyError("invalid_request", `${key} is required`);
  }
  return field;
}

function uuid(value: Record<string, unknown>, key: string): string {
  const result = requiredString(value, key);
  if (!UUID.test(result)) throw new PolicyError("invalid_request", `${key} must be a UUID`);
  return result.toLowerCase();
}

function clientKey(value: Record<string, unknown>, key: string): string {
  const result = requiredString(value, key);
  if (!CLIENT_KEY.test(result)) throw new PolicyError("invalid_request", `${key} is invalid`);
  return result;
}

export function parseRelayRequest(value: unknown): DevinRelayRequest {
  const input = record(value, "request");
  const operation = requiredString(input, "operation");
  if (operation === "start") {
    exactKeys(input, ["operation", "roomId", "actionBriefId", "requestId"], "start request");
    return {
      operation,
      roomId: uuid(input, "roomId"),
      actionBriefId: uuid(input, "actionBriefId"),
      requestId: clientKey(input, "requestId"),
    };
  }
  if (operation === "follow_up") {
    exactKeys(input, ["operation", "roomId", "runId", "message", "requestId"], "follow-up request");
    return {
      operation,
      roomId: uuid(input, "roomId"),
      runId: uuid(input, "runId"),
      message: sanitizeText(requiredString(input, "message"), 6000, "message"),
      requestId: clientKey(input, "requestId"),
    };
  }
  if (operation === "status") {
    exactKeys(input, ["operation", "roomId", "runId"], "status request");
    return { operation, roomId: uuid(input, "roomId"), runId: uuid(input, "runId") };
  }
  throw new PolicyError("invalid_request", "operation is not allowlisted");
}

export function sanitizeText(value: string, maxLength: number, context: string): string {
  const normalized = value.normalize("NFKC").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (normalized.length === 0 || normalized.length > maxLength || CONTROL.test(normalized)) {
    throw new PolicyError("unsafe_content", `${context} is empty, oversized, or contains control characters`);
  }
  if (EMAIL.test(normalized)) throw new PolicyError("unsafe_content", `${context} contains an email address`);
  if (UUID_TEXT.test(normalized)) throw new PolicyError("unsafe_content", `${context} contains a UUID`);
  if (SECRET.test(normalized)) throw new PolicyError("unsafe_content", `${context} contains a secret-like value`);
  if (ABSOLUTE_PATH.test(normalized) || WINDOWS_PATH.test(normalized) || WINDOWS_UNC_PATH.test(normalized)) {
    throw new PolicyError("unsafe_content", `${context} contains a local absolute path`);
  }
  return normalized;
}

export function redactProviderText(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFKC")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(CONTROL_GLOBAL, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_UUID]")
    .replace(/(?:^|[\s"'`(])\/(?:[\p{L}\p{N}._~+\-]+\/)*[\p{L}\p{N}._~+\-]+/gu, " [REDACTED_PATH]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s<>:"|?*]+\\?)+/g, "[REDACTED_PATH]")
    .replace(/\\\\[^\\\s<>:"|?*]+\\[^\\\s<>:"|?*]+/g, "[REDACTED_PATH]")
    .replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY-----|$)/gi, "[REDACTED_SECRET]")
    .replace(/\bauthorization\s*[:=]\s*[^\r\n,;]{8,}/gi, "authorization=[REDACTED_SECRET]")
    .replace(/\bBearer[ \t]+[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}/gi, "[REDACTED_SECRET]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}/gi, "[REDACTED_SECRET]")
    .replace(/((?:api[_-]?key|authorization|bearer|token|secret|password))\s*[:=]\s*[^\s,;]{8,}/gi, "$1=[REDACTED_SECRET]")
    .trim();
  const bounded = normalized.slice(0, maxLength).trim();
  return bounded.length > 0 ? bounded : "[REDACTED_EMPTY_EVENT]";
}

function stringArray(
  input: Record<string, unknown>,
  key: string,
  maxItems: number,
  allowEmpty: boolean,
): string[] {
  const value = input[key];
  if (!Array.isArray(value)
    || value.length > maxItems
    || (!allowEmpty && value.length === 0)
    || value.some((item) => typeof item !== "string")) {
    throw new PolicyError("unsafe_action_brief", `${key} is invalid`);
  }
  return value.map((item) => sanitizeText(item as string, 1000, key));
}

export function sanitizeActionBrief(value: unknown): SanitizedActionBrief {
  const input = record(value, "action brief");
  exactKeys(input, [
    "id",
    "roomId",
    "decisionId",
    "title",
    "objective",
    "baselineSha",
    "allowedFiles",
    "acceptanceCommands",
    "forbiddenActions",
    "approvedContext",
    "createdBy",
    "createdAt",
  ], "action brief");
  const allowedFiles = stringArray(input, "allowedFiles", 50, false);
  for (const path of allowedFiles) {
    if (path.startsWith("/") || path.includes("\\") || /(?:^|\/)\.\.(?:\/|$)/.test(path)) {
      throw new PolicyError("unsafe_action_brief", "allowedFiles must be repository-relative");
    }
  }
  const baselineSha = requiredString(input, "baselineSha");
  if (!BASELINE_SHA.test(baselineSha)) {
    throw new PolicyError("unsafe_action_brief", "baselineSha is invalid");
  }
  const acceptanceCommands = stringArray(input, "acceptanceCommands", 30, false);
  const forbiddenActions = stringArray(input, "forbiddenActions", 30, true);
  const approvedContext = stringArray(input, "approvedContext", 20, true);
  if (new TextEncoder().encode(approvedContext.join("\n")).byteLength > 12_000) {
    throw new PolicyError("unsafe_action_brief", "approvedContext exceeds the 12 KB boundary");
  }
  return {
    id: uuid(input, "id"),
    roomId: uuid(input, "roomId"),
    decisionId: uuid(input, "decisionId"),
    title: sanitizeText(requiredString(input, "title"), 200, "title"),
    objective: sanitizeText(requiredString(input, "objective"), 6000, "objective"),
    baselineSha,
    allowedFiles,
    acceptanceCommands,
    forbiddenActions,
    approvedContext,
    repository: CANONICAL_REPOSITORY,
  };
}

export function canonicalPullRequestUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PolicyError("invalid_provider_response", "pull request URL is invalid");
  }
  if (url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || !/^\/visiontale7-svg\/AIAU-Salary-neko\/pull\/[1-9][0-9]*$/.test(url.pathname)) {
    throw new PolicyError("invalid_provider_response", "pull request URL is outside the canonical repository");
  }
  return `https://github.com${url.pathname}`;
}
