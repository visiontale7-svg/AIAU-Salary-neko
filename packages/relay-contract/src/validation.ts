import {
  RELAY_SCHEMA_VERSION,
  type RelayPackageV1,
} from "./relay-v1";

const MAX_NODES = 120;
const PUBLIC_ID = /^(?:n|r|m|e)\d{3,}$/;
// Local/public identifiers must never leak through descriptive strings. Match
// canonical UUID text regardless of UUID version so newer UUIDv7 values are
// covered as well as the older v1-v5 forms.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const UNIX_PATH = /(?:^|[\s"'`(])\/(?!\/)(?:[\p{L}\p{N}._~+\-]+\/)*[\p{L}\p{N}._~+\-]+/u;
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\\\s<>:"|?*]+\\?)+/;
const WINDOWS_UNC_PATH = /\\\\[^\\\s<>:"|?*]+\\[^\\\s<>:"|?*]+/;
// Keep this credential boundary aligned with the Edge policy and the
// server-side SQL assertion. In addition to vendor-prefixed secrets, reject
// auth-scheme values, standalone JWTs, and PEM private-key markers. Bearer
// values require an explicit auth scheme plus an opaque value of at least
// eight characters, so ordinary prose containing the word "bearer" remains
// valid.
const SECRET = /(?:sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----|\bauthorization\s*[:=]\s*[^\r\n,;]{8,}|\bBearer[ \t]+[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}|\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*[^\s,;]{8,})/i;

const FORBIDDEN_KEYS = new Set([
  "fulltext",
  "sourcepath",
  "sourcemessages",
  "visibleturns",
  "rawmodeloutput",
  "rawoutput",
  "prompt",
  "provider",
  "validation",
  "messageid",
  "turnid",
  "snapshotid",
  "conversationid",
  "sourceeventindex",
  "exactquote",
  "sourcespan",
]);

export interface RelayValidationResult {
  ok: boolean;
  errors: string[];
}

export function privacyFindings(value: string): string[] {
  const findings: string[] = [];
  if (UUID.test(value)) findings.push("uuid");
  if (EMAIL.test(value)) findings.push("email");
  if (UNIX_PATH.test(value)) findings.push("unix_path");
  if (WINDOWS_PATH.test(value) || WINDOWS_UNC_PATH.test(value)) findings.push("windows_path");
  if (SECRET.test(value)) findings.push("secret");
  return findings;
}

function finitePoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && Number.isFinite(point.x)
    && typeof point.y === "number" && Number.isFinite(point.y);
}

function scanRecursive(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "string") {
    for (const finding of privacyFindings(value)) errors.push(`${path}: contains ${finding}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanRecursive(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll("_", "").toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)) errors.push(`${path}.${key}: forbidden key`);
    scanRecursive(child, `${path}.${key}`, errors);
  }
}

export function validateRelayPackage(value: unknown): RelayValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["package must be an object"] };
  const pkg = value as Partial<RelayPackageV1>;
  if (pkg.schemaVersion !== RELAY_SCHEMA_VERSION) errors.push("schemaVersion must be relay-v1");
  if (!pkg.packageId || typeof pkg.packageId !== "string") errors.push("packageId is required");
  if (!pkg.clientPublishId || typeof pkg.clientPublishId !== "string") errors.push("clientPublishId is required");
  if (!pkg.title || typeof pkg.title !== "string") errors.push("title is required");
  if (!pkg.publishedAt || Number.isNaN(Date.parse(pkg.publishedAt))) errors.push("publishedAt must be RFC3339");
  if (!pkg.graph || typeof pkg.graph !== "object") {
    errors.push("graph is required");
    scanRecursive(value, "$", errors);
    return { ok: errors.length === 0, errors };
  }

  const nodes = Array.isArray(pkg.graph.nodes) ? pkg.graph.nodes : [];
  const edges = Array.isArray(pkg.graph.edges) ? pkg.graph.edges : [];
  const modes = Array.isArray(pkg.graph.modes) ? pkg.graph.modes : [];
  if (nodes.length === 0) errors.push("graph must contain at least one node");
  if (nodes.length > MAX_NODES) errors.push(`graph contains more than ${MAX_NODES} nodes`);

  const nodeIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (!node || typeof node !== "object" || !PUBLIC_ID.test(node.id) || !node.id.startsWith("n")) {
      errors.push(`graph.nodes[${index}].id is invalid`);
      continue;
    }
    if (nodeIds.has(node.id)) errors.push(`duplicate node id ${node.id}`);
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    if (!edge || typeof edge !== "object" || !PUBLIC_ID.test(edge.id) || !edge.id.startsWith("r")) {
      errors.push(`graph.edges[${index}].id is invalid`);
      continue;
    }
    if (edgeIds.has(edge.id)) errors.push(`duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) errors.push(`edge ${edge.id} source is missing`);
    if (!nodeIds.has(edge.target)) errors.push(`edge ${edge.id} target is missing`);
  }

  const modeIds = new Set<string>();
  for (const [index, mode] of modes.entries()) {
    if (!mode || typeof mode !== "object" || !PUBLIC_ID.test(mode.id) || !mode.id.startsWith("m")) {
      errors.push(`graph.modes[${index}].id is invalid`);
      continue;
    }
    if (modeIds.has(mode.id)) errors.push(`duplicate mode id ${mode.id}`);
    modeIds.add(mode.id);
    if (!mode.memberNodeIds.length) errors.push(`mode ${mode.id} has no members`);
    for (const nodeId of mode.memberNodeIds) {
      if (!nodeIds.has(nodeId)) errors.push(`mode ${mode.id} references missing node ${nodeId}`);
    }
  }

  for (const node of nodes) {
    for (const modeId of node.modeIds) if (!modeIds.has(modeId)) errors.push(`node ${node.id} references missing mode ${modeId}`);
  }

  const layout = pkg.graph.layout ?? {};
  for (const nodeId of nodeIds) {
    if (!finitePoint(layout[nodeId])) errors.push(`layout for ${nodeId} is missing or non-finite`);
  }
  for (const nodeId of Object.keys(layout)) if (!nodeIds.has(nodeId)) errors.push(`layout references missing node ${nodeId}`);
  if (pkg.graph.viewport) {
    if (!finitePoint(pkg.graph.viewport) || !Number.isFinite(pkg.graph.viewport.zoom) || pkg.graph.viewport.zoom <= 0) {
      errors.push("viewport is invalid");
    }
  }

  const evidence = pkg.evidence && typeof pkg.evidence === "object" ? pkg.evidence : {};
  const referencedEvidence = new Set([...nodes.flatMap((node) => node.evidenceIds), ...edges.flatMap((edge) => edge.evidenceIds)]);
  for (const evidenceId of referencedEvidence) {
    if (!PUBLIC_ID.test(evidenceId) || !evidenceId.startsWith("e")) errors.push(`evidence id ${evidenceId} is invalid`);
    if (!evidence[evidenceId]) errors.push(`evidence ${evidenceId} is missing`);
  }
  for (const evidenceId of Object.keys(evidence)) {
    if (!referencedEvidence.has(evidenceId)) errors.push(`unreferenced evidence ${evidenceId}`);
  }

  scanRecursive(value, "$", errors);
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertRelayPackage(value: unknown): asserts value is RelayPackageV1 {
  const result = validateRelayPackage(value);
  if (!result.ok) throw new Error(`Invalid RelayPackageV1: ${result.errors.join("; ")}`);
}
