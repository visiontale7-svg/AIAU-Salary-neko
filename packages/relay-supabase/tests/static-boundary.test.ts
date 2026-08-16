import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const migrationRoot = resolve(repositoryRoot, "supabase/migrations");
const sql = readdirSync(migrationRoot)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(resolve(migrationRoot, name), "utf8"))
  .join("\n");

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

describe("Relay migration static invariants", () => {
  it.each(tables)("creates and enables RLS for %s", (table) => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}\\s*\\(`, "i"));
    expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  });

  it.each(lockedRpcs)("defines locked RPC %s", (rpc) => {
    expect(sql).toMatch(new RegExp(`create function public\\.${rpc}\\s*\\(`, "i"));
  });

  it("stores only a 32-byte invite hash and redeems a 43-char secret", () => {
    expect(sql).toContain("extensions.gen_random_bytes(32)");
    expect(sql).toContain("token_hash bytea not null unique check (octet_length(token_hash) = 32)");
    expect(sql).toContain("char_length(p_invite_token) <> 43");
    expect(sql).not.toMatch(/grant select on table[^;]*room_invites/i);
    const inviteTable = sql.slice(
      sql.indexOf("create table public.room_invites"),
      sql.indexOf("create index room_invites_room_active_idx"),
    );
    expect(inviteTable).not.toMatch(/\btoken\s+text\b/i);
    expect(sql).not.toMatch(/store_receipt\([\s\S]{0,300}inviteToken/i);
    expect(sql).toContain("unique (created_by, idempotency_key)");
    expect(sql).toContain("invite_idempotency_key_reused_with_different_input");
  });

  it("rejects generic Unix absolute paths rather than a selected root list", () => {
    const helperStart = sql.lastIndexOf("create or replace function relay_private.assert_safe_shared_text");
    const helper = sql.slice(helperStart, sql.indexOf("$$;", sql.indexOf("as $$", helperStart)) + 3);
    expect(helper).toContain("[[:space:]");
    expect(helper).toContain("/[[:alnum:]_.~+-]+");
    expect(helper).not.toContain("/Users/|/home/");
  });

  it("hardens shared text and packages against Bearer, JWT, and private-key credentials", () => {
    const helperStart = sql.lastIndexOf("create or replace function relay_private.assert_safe_shared_text");
    const helper = sql.slice(helperStart, sql.indexOf("$$;", sql.indexOf("as $$", helperStart)) + 3);
    expect(helper).toContain("bearer[[:space:]]+");
    expect(helper).toContain("authorization[[:space:]]*[:=][[:space:]]*[^,;[:cntrl:]]{8,}");
    expect(helper).toContain("[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}");
    expect(helper).toContain("-----BEGIN( [A-Z0-9]+)* PRIVATE KEY-----");
    expect(sql).toContain("rename to assert_relay_package_before_credential_hardening");
    const packageWrapper = sql.slice(sql.lastIndexOf("create function relay_private.assert_relay_package"));
    expect(packageWrapper).toContain("assert_safe_shared_text(p_package::text, 'Relay package')");
    expect(packageWrapper).toContain("assert_relay_package_before_credential_hardening(p_package)");
    expect(sql).toContain("create trigger atlas_versions_credential_privacy");
    const packageTrigger = sql.slice(sql.indexOf("create function relay_private.enforce_atlas_version_credential_privacy"));
    expect(packageTrigger).toContain("assert_safe_shared_text(new.package::text, 'Relay package')");
  });

  it("keeps append-only records immutable and mutation receipts private", () => {
    for (const trigger of [
      "atlas_versions_immutable",
      "proposal_comments_immutable",
      "proposal_decisions_immutable",
      "activity_events_immutable",
      "devin_events_immutable",
    ]) expect(sql).toContain(`create trigger ${trigger}`);
    expect(sql).toContain("create table relay_private.mutation_receipts");
    expect(sql).toContain("idempotency_key_reused_with_different_input");
  });

  it("authorizes private room channels and broadcasts only activity hints", () => {
    expect(sql).toContain("relay_private.can_access_realtime_topic(realtime.topic())");
    expect(sql).toContain("'room:' || new.room_id::text");
    const broadcast = sql.slice(sql.indexOf("create function relay_private.broadcast_activity_hint"));
    const body = broadcast.slice(0, broadcast.indexOf("$$;", broadcast.indexOf("as $$")) + 3);
    const payload = body.slice(
      body.indexOf("jsonb_build_object("),
      body.indexOf(")),", body.indexOf("jsonb_build_object(")) + 3,
    );
    expect(body).toContain("'seq', new.seq");
    expect(body).toContain("'type', new.event_type");
    expect(payload).not.toContain("new.package");
    expect(payload).not.toContain("new.evidence");
    expect(payload).not.toContain("p_message");
    expect(sql).toContain("extension = 'presence'");
    expect(sql).toContain("create function public.broadcast_relay_ephemeral");
    expect(sql).toContain("jsonb_build_object('userId', v_actor)");
  });

  it("uses fixed search paths for every security-definer function", () => {
    const functionBlocks = [...sql.matchAll(/create function\s+[^;]+?[\s\S]*?\$\$;/gi)]
      .map((match) => match[0])
      .filter((block) => /security definer/i.test(block));
    expect(functionBlocks.length).toBeGreaterThan(10);
    for (const block of functionBlocks) {
      expect(block).toMatch(/set search_path\s*=\s*[A-Za-z0-9_, ]+\s+as\s+\$\$/i);
    }
  });

  it("gives public tables no direct mutation policy and keeps owner RPC checks", () => {
    expect(sql).not.toMatch(/create policy[^;]+on public\.[^;]+for (?:insert|update|delete|all)/i);
    for (const rpc of ["decide_proposal", "create_action_brief", "create_devin_run", "append_devin_follow_up"]) {
      const block = sql.slice(sql.indexOf(`create function public.${rpc}`));
      const body = block.slice(0, block.indexOf("$$;", block.indexOf("as $$")) + 3);
      expect(body).toContain("relay_private.is_room_owner");
    }
  });

  it("keeps provider-derived writes service-only and paid starts entitled", () => {
    expect(sql).toContain("create table relay_private.devin_entitlements");
    expect(sql).toContain("max_runs_per_day");
    expect(sql).toContain("create unique index devin_runs_one_active_per_brief_idx");
    expect(sql).toContain("create function public.claim_devin_session_attempt");
    expect(sql).toContain("provider_result_unknown");
    for (const rpc of [
      "claim_devin_session_attempt",
      "update_devin_run_snapshot",
      "record_devin_provider_failure",
      "append_devin_provider_events",
      "record_devin_follow_up_result",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${rpc}[^;]+to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant execute on function public\\.${rpc}[^;]+to authenticated`, "i"));
    }
  });

  it("returns the durable room projection and replay watermark from one snapshot", () => {
    const block = sql.slice(sql.indexOf("create function public.get_room_bundle"));
    const body = block.slice(0, block.indexOf("$$;", block.indexOf("as $$")) + 3);
    expect(body).toContain("'lastActivitySeq'");
    expect(body).toContain("version.package");
    expect(body).toContain("room.current_version_id");
    expect(body).toContain("member.user_id = v_actor");
    expect(sql).toMatch(/grant execute on function public\.get_room_bundle\(uuid\) to authenticated/i);
    expect(sql).toContain("to_jsonb(stance_row)");
    expect(sql).toContain("to_jsonb(decision_row)");
  });

  it("assigns durable member colors and returns the RLS-protected directory atomically", () => {
    expect(sql).toContain("create trigger room_members_assign_color_key");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("room_members_room_color_key_unique");
    const start = sql.lastIndexOf("create or replace function public.get_room_bundle");
    const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)) + 3);
    expect(body).toContain("'members'");
    expect(body).toContain("from public.room_members room_member");
    expect(body).toContain("member.user_id = v_actor");
  });

  it("checks stored mutation receipts before mutable room/version/target state", () => {
    const cases = [
      ["upsert_team_graph_item", "select current_version_id"],
      ["save_layout_item", "relay_private.graph_node_exists"],
      ["set_node_stance", "relay_private.graph_node_exists"],
      ["submit_proposal", "select current_version_id"],
      ["append_proposal_comment", "from public.proposals proposal"],
      ["decide_proposal", "select * into v_room"],
      ["create_action_brief", "select * into v_decision"],
    ] as const;
    for (const [rpc, mutableRead] of cases) {
      const block = sql.slice(sql.indexOf(`create function public.${rpc}`));
      const body = block.slice(0, block.indexOf("$$;", block.indexOf("as $$")) + 3);
      expect(body.indexOf("relay_private.acquire_receipt")).toBeGreaterThan(0);
      expect(body.indexOf("relay_private.acquire_receipt")).toBeLessThan(body.indexOf(mutableRead));
    }
  });

  it("fails follow-up closed when runtime is unavailable and never re-sends an attempted key", () => {
    const edge = readFileSync(resolve(repositoryRoot, "supabase/functions/devin-relay/index.ts"), "utf8");
    const edgeStart = edge.indexOf("async function sendFollowUp");
    const edgeBody = edge.slice(edgeStart, edge.indexOf("async function execute", edgeStart));
    expect(edgeBody).toContain('throw new HttpError(503, "not_configured")');
    const sqlStart = sql.indexOf("create function public.append_devin_follow_up");
    const sqlBody = sql.slice(sqlStart, sql.indexOf("$$;", sql.indexOf("as $$", sqlStart)) + 3);
    expect(sqlBody).toContain("event_type = 'owner_follow_up_attempted'");
    expect(sqlBody).toContain("client_request_id_reused_with_different_input");
    expect(sqlBody).toContain("'shouldSend', false");
  });

  it("keeps Devin terminal/provider-unknown state monotonic under stale polls", () => {
    const start = sql.lastIndexOf("create or replace function public.update_devin_run_snapshot");
    const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)) + 3);
    expect(body).toContain("v_before.state in ('completed', 'failed')");
    expect(body).toContain("provider_result_requires_reconciliation");
    expect(body).toContain("v_before.external_session_id is null");
  });

  it("tracks provider health independently and honors durable Retry-After windows", () => {
    expect(sql).toContain("provider_health text not null default 'unknown'");
    expect(sql).toContain("last_successful_poll_at timestamptz");
    expect(sql).toContain("last_provider_event_at timestamptz");
    expect(sql).toContain("consecutive_failures integer not null default 0");
    expect(sql).toContain("retry_after_at timestamptz");
    const failureStart = sql.indexOf("create function public.record_devin_provider_failure");
    const failureBody = sql.slice(failureStart, sql.indexOf("$$;", sql.indexOf("as $$", failureStart)) + 3);
    expect(failureBody).toContain("provider_rate_limited");
    expect(failureBody).toContain("v_next_failure_count >= 3");
    for (const seconds of [5, 10, 20, 40]) {
      expect(failureBody).toContain(`then ${seconds}`);
    }
    expect(failureBody).toContain("else 60");
    expect(failureBody).toContain("devin_provider_health_stale");
    expect(failureBody).toContain("v_before.provider_health <> 'stale'");
    expect(failureBody).not.toContain("devin_provider_health_changed");
    expect(failureBody).not.toContain("state =");

    const updateStart = sql.lastIndexOf("create or replace function public.update_devin_run_snapshot");
    const updateBody = sql.slice(updateStart, sql.indexOf("$$;", sql.indexOf("as $$", updateStart)) + 3);
    expect(updateBody).toContain("devin_provider_health_recovered");
    expect(updateBody).toContain("v_before.provider_health = 'stale'");
    expect(updateBody).toContain("v_row.provider_health = 'healthy'");

    const edge = readFileSync(resolve(repositoryRoot, "supabase/functions/devin-relay/index.ts"), "utf8");
    expect(edge).toContain("providerRetryScheduled(existing, now)");
    expect(edge).toContain("providerRetryScheduled(ownerContext.run)");
    expect(edge).toContain('serviceRpc("record_devin_provider_failure"');
    expect(edge.indexOf("providerRetryScheduled(ownerContext.run)")).toBeLessThan(
      edge.indexOf('userRpc("append_devin_follow_up"'),
    );

    const latestBundleStart = sql.lastIndexOf("create or replace function public.get_room_bundle");
    const latestBundle = sql.slice(
      latestBundleStart,
      sql.indexOf("$$;", sql.indexOf("as $$", latestBundleStart)) + 3,
    );
    expect(latestBundle).toContain("to_jsonb(run)");
  });

  it("scopes mutable graph state to the current immutable atlas version", () => {
    for (const table of ["room_layout_items", "team_graph_items", "proposals"]) {
      const block = sql.slice(sql.indexOf(`create table public.${table}`));
      expect(block.slice(0, block.indexOf(");") + 2)).toContain("atlas_version_id uuid not null");
    }
    expect(sql).toContain("proposal.atlas_version_id = room.current_version_id");
    expect(sql).toContain("team_item_creator_required");
    expect(sql).toContain("relay_private.assert_proposal_value");
  });

  it("implements the exact mockable Devin v3 boundary without credential literals", () => {
    const edge = readFileSync(resolve(repositoryRoot, "supabase/functions/devin-relay/index.ts"), "utf8");
    const policy = readFileSync(resolve(repositoryRoot, "supabase/functions/devin-relay/policy.ts"), "utf8");
    const provider = readFileSync(resolve(repositoryRoot, "supabase/functions/devin-relay/provider.ts"), "utf8");
    expect(edge).toContain("/rest/v1/");
    expect(provider).toContain('https://api.devin.ai/v3');
    expect(provider).toContain("this.fetchImpl(");
    expect(provider).toContain("repos: [this.config.repo]");
    expect(provider).toContain("max_acu_limit: this.config.maxAcuLimit");
    for (const name of ["DEVIN_API_KEY", "DEVIN_ORG_ID", "DEVIN_REPO", "DEVIN_MAX_ACU_LIMIT"]) {
      expect(provider).toContain(`\"${name}\"`);
    }
    expect(edge + provider).not.toContain("DEVIN_API_TOKEN");
    expect(edge + provider).not.toContain("DEVIN_FIXED_REPOSITORY");
    expect(edge).not.toMatch(/cog_[A-Za-z0-9_-]{12,}/);
    expect(provider).not.toMatch(/cog_[A-Za-z0-9_-]{12,}/);
    expect(policy).not.toMatch(/cog_[A-Za-z0-9_-]{12,}/);
    expect(policy).toContain("CANONICAL_REPOSITORY");
    expect(policy).toContain("action brief");
  });
});
