import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "../..");
const migrationRoot = resolve(repositoryRoot, "supabase/migrations");
const sql = readdirSync(migrationRoot)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationRoot, name), "utf8"))
  .join("\n");
const edgeRoot = resolve(repositoryRoot, "supabase/functions/devin-relay");
const edgeFiles = readdirSync(edgeRoot).filter((name) => name.endsWith(".ts")).sort();
const edge = edgeFiles.map((name) => readFileSync(resolve(edgeRoot, name), "utf8")).join("\n");
const edgeIndex = readFileSync(resolve(edgeRoot, "index.ts"), "utf8");
const provider = readFileSync(resolve(edgeRoot, "provider.ts"), "utf8");
const policy = readFileSync(resolve(repositoryRoot, "supabase/functions/devin-relay/policy.ts"), "utf8");

const tables = [
  "rooms",
  "room_members",
  "room_invites",
  "atlas_versions",
  "room_layout_items",
  "team_graph_items",
  "node_stances",
  "proposals",
  "proposal_comments",
  "proposal_decisions",
  "activity_events",
  "action_briefs",
  "devin_runs",
  "devin_events",
];
const lockedRpcs = [
  "create_room_with_package",
  "join_room",
  "upsert_team_graph_item",
  "save_layout_item",
  "set_node_stance",
  "submit_proposal",
  "append_proposal_comment",
  "decide_proposal",
  "create_action_brief",
];

const functionBlocks = [...sql.matchAll(/create function\s+([^\s(]+)[\s\S]*?\$\$;/gi)]
  .map((match) => ({ name: match[1], body: match[0] }));
const securityDefiners = functionBlocks.filter(({ body }) => /security definer/i.test(body));
const missingSearchPath = securityDefiners
  .filter(({ body }) => !/set search_path\s*=\s*[A-Za-z0-9_, ]+\s+as\s+\$\$/i.test(body))
  .map(({ name }) => name);
const missingTables = tables.filter((table) => !new RegExp(`create table public\\.${table}\\s*\\(`, "i").test(sql));
const missingRls = tables.filter((table) => !new RegExp(`alter table public\\.${table} enable row level security`, "i").test(sql));
const missingRpcs = lockedRpcs.filter((rpc) => !new RegExp(`create function public\\.${rpc}\\s*\\(`, "i").test(sql));
const directMutationPolicies = [...sql.matchAll(/create policy[^;]+on public\.[^;]+for (insert|update|delete|all)/gi)]
  .map((match) => match[0]);
const directMutationGrants = [...sql.matchAll(/grant\s+(insert|update|delete|all)[^;]+on table public\./gi)]
  .map((match) => match[0]);
const providerFetches = (provider.match(/this\.fetchImpl\(/g) ?? []).length;
const providerContractFailures = [
  providerFetches === 1 ? null : `expected one mockable provider fetch, found ${providerFetches}`,
  provider.includes('https://api.devin.ai/v3') ? null : "missing pinned Devin v3 base URL",
  provider.includes('repos: [this.config.repo]') ? null : "missing fixed repos request field",
  provider.includes('max_acu_limit: this.config.maxAcuLimit') ? null : "missing bounded max_acu_limit",
  edgeIndex.includes('SUPABASE_SERVICE_ROLE_KEY') ? null : "missing service-role persistence boundary",
  edge.includes('DEVIN_API_TOKEN') || edge.includes('DEVIN_FIXED_REPOSITORY')
    ? "legacy Devin environment name remains"
    : null,
  ...["DEVIN_API_KEY", "DEVIN_ORG_ID", "DEVIN_REPO", "DEVIN_MAX_ACU_LIMIT"]
    .filter((name) => !provider.includes(`\"${name}\"`))
    .map((name) => `missing ${name}`),
].filter(Boolean);
const providerMutationGrantLeaks = [
  "claim_devin_session_attempt",
  "update_devin_run_snapshot",
  "record_devin_provider_failure",
  "append_devin_provider_events",
  "record_devin_follow_up_result",
]
  .filter((name) => new RegExp(`grant execute on function public\\.${name}[^;]+to authenticated`, "i").test(sql));
const entitlementFailures = [
  sql.includes("create table relay_private.devin_entitlements") ? null : "missing private Devin entitlement table",
  sql.includes("max_runs_per_day") ? null : "missing operator run quota",
  sql.includes("devin_runs_one_active_per_brief_idx") ? null : "missing active paid-run uniqueness",
  sql.includes("claim_devin_session_attempt") ? null : "missing durable provider attempt claim",
].filter(Boolean);
const hardenedHelperStart = sql.lastIndexOf("create or replace function relay_private.assert_safe_shared_text");
const hardenedHelper = hardenedHelperStart >= 0
  ? sql.slice(hardenedHelperStart, sql.indexOf("$$;", sql.indexOf("as $$", hardenedHelperStart)) + 3)
  : "";
const credentialPrivacyFailures = [
  hardenedHelper.includes("authorization[[:space:]]*[:=][[:space:]]*[^,;[:cntrl:]]{8,}")
    ? null
    : "SQL shared-text assertion misses Authorization values",
  hardenedHelper.includes("bearer[[:space:]]+")
    ? null
    : "SQL shared-text assertion misses Bearer values",
  hardenedHelper.includes("[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}")
    ? null
    : "SQL shared-text assertion misses standalone JWTs",
  hardenedHelper.includes("-----BEGIN( [A-Z0-9]+)* PRIVATE KEY-----")
    ? null
    : "SQL shared-text assertion misses private-key markers",
  sql.includes("create trigger atlas_versions_credential_privacy")
    ? null
    : "atlas version writes lack a hardened privacy trigger",
  policy.includes("authorization\\s*[:=]\\s*[^\\r\\n,;]{8,}")
    ? null
    : "Edge policy misses Authorization values",
  policy.includes("Bearer[ \\t]+")
    ? null
    : "Edge policy misses Bearer values",
  policy.includes("[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}")
    ? null
    : "Edge policy misses standalone JWTs",
  policy.includes("PRIVATE KEY-----[\\s\\S]*?")
    ? null
    : "Edge provider redaction misses private-key blocks",
].filter(Boolean);

const failures = {
  missingTables,
  missingRls,
  missingRpcs,
  missingSearchPath,
  directMutationPolicies,
  directMutationGrants,
  providerContractFailures,
  providerMutationGrantLeaks,
  entitlementFailures,
  credentialPrivacyFailures,
};
if (Object.values(failures).some((values) => values.length > 0)) {
  process.stderr.write(`${JSON.stringify({ ok: false, failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const receipt = {
    ok: true,
    migrations: readdirSync(migrationRoot).filter((name) => name.endsWith(".sql")).length,
    publicTables: tables.length,
    rlsEnabledTables: tables.length,
    lockedRpcs: lockedRpcs.length,
    securityDefinerFunctions: securityDefiners.length,
    fixedSearchPaths: securityDefiners.length,
    directPublicMutationPolicies: 0,
    directClientMutationGrants: 0,
    privateRealtimePolicies: (sql.match(/create policy relay_room_(?:receive|send)(?:_guard)?/g) ?? []).length,
    immutableTriggers: (sql.match(/create trigger (?:atlas_versions|proposal_comments|proposal_decisions|activity_events|action_briefs|devin_events)_immutable/g) ?? []).length,
    inviteEntropyBytes: sql.includes("extensions.gen_random_bytes(32)") ? 32 : 0,
    edgeTypeScriptFilesScanned: edgeFiles.length,
    edgeProviderImplemented: providerFetches === 1,
    edgeExternalProviderFetches: providerFetches,
    canonicalRepositoryPinned: policy.includes('"visiontale7-svg/AIAU-Salary-neko"'),
    statusCacheMilliseconds: edgeIndex.includes("STATUS_CACHE_MS = 5_000") ? 5000 : null,
    privateDevinEntitlement: true,
    serviceOnlyProviderMutationRpcs: 5,
    credentialPrivacyGuards: 9,
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
