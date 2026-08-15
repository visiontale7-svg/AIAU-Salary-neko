begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists relay_private;
revoke all on schema relay_private from public, anon, authenticated;

create table public.rooms (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'closed')),
  current_version_id uuid,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create unique index room_members_one_owner_per_room
  on public.room_members(room_id)
  where role = 'owner';

create table public.room_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text check (
    idempotency_key is null or char_length(idempotency_key) between 8 and 160
  ),
  request_sha256 bytea check (
    request_sha256 is null or octet_length(request_sha256) = 32
  ),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 50),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  unique (created_by, idempotency_key)
);

create index room_invites_room_active_idx
  on public.room_invites(room_id, expires_at)
  where revoked_at is null;

create table public.atlas_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  version integer not null check (version > 0),
  package_id text not null check (char_length(package_id) between 1 and 160),
  client_publish_id text not null check (char_length(client_publish_id) between 8 and 160),
  package_sha256 bytea not null check (octet_length(package_sha256) = 32),
  package jsonb not null,
  published_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (room_id, version),
  unique (room_id, id),
  unique (published_by, client_publish_id)
);

alter table public.rooms
  add constraint rooms_current_version_fk
  foreign key (id, current_version_id)
  references public.atlas_versions(room_id, id)
  deferrable initially deferred;

create table public.room_layout_items (
  room_id uuid not null references public.rooms(id) on delete cascade,
  atlas_version_id uuid not null,
  node_id text not null check (char_length(node_id) between 1 and 120),
  x double precision not null check (x between -10000000 and 10000000),
  y double precision not null check (y between -10000000 and 10000000),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  last_client_mutation_id text not null check (char_length(last_client_mutation_id) between 8 and 160),
  updated_at timestamptz not null default now(),
  primary key (room_id, atlas_version_id, node_id),
  unique (room_id, last_client_mutation_id),
  foreign key (room_id, atlas_version_id)
    references public.atlas_versions(room_id, id) on delete cascade
);

create table public.team_graph_items (
  room_id uuid not null references public.rooms(id) on delete cascade,
  atlas_version_id uuid not null,
  item_id text not null check (char_length(item_id) between 1 and 120),
  item_type text not null check (item_type in ('node', 'edge')),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  last_client_mutation_id text not null check (char_length(last_client_mutation_id) between 8 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, atlas_version_id, item_id),
  unique (room_id, last_client_mutation_id),
  foreign key (room_id, atlas_version_id)
    references public.atlas_versions(room_id, id) on delete cascade,
  check (jsonb_typeof(payload) = 'object')
);

create table public.node_stances (
  room_id uuid not null references public.rooms(id) on delete cascade,
  atlas_version_id uuid not null,
  node_id text not null check (char_length(node_id) between 1 and 120),
  user_id uuid not null references auth.users(id) on delete cascade,
  stance text not null check (stance in ('confirm', 'challenge', 'needs_evidence')),
  revision bigint not null default 1 check (revision > 0),
  last_client_mutation_id text not null check (char_length(last_client_mutation_id) between 8 and 160),
  updated_at timestamptz not null default now(),
  primary key (room_id, atlas_version_id, node_id, user_id),
  foreign key (room_id, atlas_version_id)
    references public.atlas_versions(room_id, id) on delete cascade,
  unique (room_id, last_client_mutation_id)
);

create table public.proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  atlas_version_id uuid not null,
  target_type text not null check (target_type in ('source_node', 'source_edge', 'team_node', 'team_edge')),
  target_id text not null check (char_length(target_id) between 1 and 120),
  operation text not null check (operation in ('replace_label', 'replace_relation', 'remove', 'reclassify')),
  proposed_value jsonb not null check (jsonb_typeof(proposed_value) = 'object'),
  rationale text not null check (char_length(rationale) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'deferred')),
  revision bigint not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  client_mutation_id text not null check (char_length(client_mutation_id) between 8 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, client_mutation_id),
  unique (room_id, id),
  foreign key (room_id, atlas_version_id)
    references public.atlas_versions(room_id, id) on delete cascade
);

create index proposals_room_status_idx on public.proposals(room_id, status, created_at);

create table public.proposal_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  proposal_id uuid not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  client_mutation_id text not null check (char_length(client_mutation_id) between 8 and 160),
  created_at timestamptz not null default now(),
  unique (room_id, client_mutation_id),
  foreign key (room_id, proposal_id)
    references public.proposals(room_id, id) on delete cascade
);

create index proposal_comments_proposal_idx
  on public.proposal_comments(proposal_id, created_at);

create table public.proposal_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  proposal_id uuid not null,
  decision text not null check (decision in ('accepted', 'rejected', 'deferred')),
  rationale text not null check (char_length(rationale) between 1 and 4000),
  room_revision bigint not null check (room_revision > 0),
  decided_by uuid not null references auth.users(id) on delete restrict,
  client_mutation_id text not null check (char_length(client_mutation_id) between 8 and 160),
  decided_at timestamptz not null default now(),
  unique (room_id, client_mutation_id),
  unique (room_id, id),
  foreign key (room_id, proposal_id)
    references public.proposals(room_id, id) on delete cascade
);

create index proposal_decisions_proposal_idx
  on public.proposal_decisions(proposal_id, decided_at);

create table public.activity_events (
  seq bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  event_type text not null check (char_length(event_type) between 1 and 80),
  target_id text check (target_id is null or char_length(target_id) between 1 and 160),
  actor_id uuid references auth.users(id) on delete set null,
  client_mutation_id text check (client_mutation_id is null or char_length(client_mutation_id) between 8 and 160),
  created_at timestamptz not null default now()
);

create index activity_events_replay_idx on public.activity_events(room_id, seq);
create unique index activity_events_mutation_once_idx
  on public.activity_events(room_id, client_mutation_id, event_type)
  where client_mutation_id is not null;

create table public.action_briefs (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  decision_id uuid not null unique,
  title text not null check (char_length(title) between 1 and 200),
  objective text not null check (char_length(objective) between 1 and 6000),
  baseline_sha text not null check (baseline_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  allowed_files text[] not null check (cardinality(allowed_files) between 1 and 50),
  acceptance_commands text[] not null check (cardinality(acceptance_commands) between 1 and 30),
  forbidden_actions text[] not null default '{}' check (cardinality(forbidden_actions) <= 30),
  approved_context text[] not null default '{}' check (
    cardinality(approved_context) <= 20
    and octet_length(array_to_string(approved_context, E'\n')) <= 12000
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  client_mutation_id text not null check (char_length(client_mutation_id) between 8 and 160),
  created_at timestamptz not null default now(),
  unique (room_id, client_mutation_id),
  unique (room_id, id),
  foreign key (room_id, decision_id)
    references public.proposal_decisions(room_id, id) on delete restrict
);

create table public.devin_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  action_brief_id uuid not null,
  client_request_id text not null check (char_length(client_request_id) between 8 and 160),
  external_session_id text,
  external_url text,
  state text not null default 'not_configured'
    check (state in ('not_configured', 'queued', 'working', 'needs_input', 'approval_needed', 'completed', 'failed', 'blocked')),
  status_detail text check (status_detail is null or char_length(status_detail) <= 2000),
  pull_request_url text check (
    pull_request_url is null
    or pull_request_url ~ '^https://github\.com/visiontale7-svg/AIAU-Salary-neko/pull/[1-9][0-9]*$'
  ),
  pull_request_state text,
  checks_state text check (checks_state is null or checks_state in ('unknown', 'pending', 'passing', 'failing')),
  provider_authorized boolean not null default false,
  reserved_max_acu_limit integer check (
    reserved_max_acu_limit is null or reserved_max_acu_limit between 1 and 1000
  ),
  provider_attempted_at timestamptz,
  provider_message_cursor text check (
    provider_message_cursor is null or char_length(provider_message_cursor) between 1 and 500
  ),
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, client_request_id),
  unique (room_id, id),
  foreign key (room_id, action_brief_id)
    references public.action_briefs(room_id, id) on delete restrict
);

create index devin_runs_room_updated_idx on public.devin_runs(room_id, updated_at desc);
create unique index devin_runs_one_active_per_brief_idx
  on public.devin_runs(action_brief_id)
  where state in ('queued', 'working', 'needs_input', 'approval_needed', 'blocked');

create table public.devin_events (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  run_id uuid not null,
  external_event_id text,
  event_type text not null check (char_length(event_type) between 1 and 80),
  text text not null check (char_length(text) between 1 and 6000),
  actor_id uuid references auth.users(id) on delete set null,
  client_request_id text,
  created_at timestamptz not null default now(),
  unique (run_id, external_event_id),
  unique (run_id, client_request_id, event_type),
  foreign key (room_id, run_id)
    references public.devin_runs(room_id, id) on delete cascade
);

create index devin_events_run_created_idx on public.devin_events(run_id, created_at, id);

-- This server-maintained allowlist is the paid-provider boundary. Anonymous
-- room ownership alone never grants Devin spend authority. Operators provision
-- and revoke rows out-of-band with the service role; no public API exposes it.
create table relay_private.devin_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  expires_at timestamptz,
  max_runs_per_day integer not null default 1 check (max_runs_per_day between 1 and 50),
  max_acu_limit integer not null check (max_acu_limit between 1 and 1000),
  updated_at timestamptz not null default now()
);

revoke all on relay_private.devin_entitlements from public, anon, authenticated;

-- Exact mutation responses live outside the exposed API schema. They make retries
-- deterministic even after the underlying row receives a later revision.
create table relay_private.mutation_receipts (
  actor_id uuid not null,
  operation text not null,
  client_mutation_id text not null,
  request_sha256 bytea not null check (octet_length(request_sha256) = 32),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation, client_mutation_id)
);

revoke all on relay_private.mutation_receipts from public, anon, authenticated;

create function relay_private.reject_immutable_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
end;
$$;

create trigger atlas_versions_immutable
  before update or delete on public.atlas_versions
  for each row execute function relay_private.reject_immutable_change();
create trigger proposal_comments_immutable
  before update or delete on public.proposal_comments
  for each row execute function relay_private.reject_immutable_change();
create trigger proposal_decisions_immutable
  before update or delete on public.proposal_decisions
  for each row execute function relay_private.reject_immutable_change();
create trigger activity_events_immutable
  before update or delete on public.activity_events
  for each row execute function relay_private.reject_immutable_change();
create trigger action_briefs_immutable
  before update or delete on public.action_briefs
  for each row execute function relay_private.reject_immutable_change();
create trigger devin_events_immutable
  before update or delete on public.devin_events
  for each row execute function relay_private.reject_immutable_change();

create function relay_private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.room_members member
    where member.room_id = p_room_id
      and member.user_id = (select auth.uid())
  );
$$;

create function relay_private.is_room_owner(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.rooms room
    where room.id = p_room_id
      and room.owner_id = (select auth.uid())
  );
$$;

revoke all on function relay_private.is_room_member(uuid) from public;
revoke all on function relay_private.is_room_owner(uuid) from public;
grant usage on schema relay_private to authenticated;
grant execute on function relay_private.is_room_member(uuid) to authenticated;
grant execute on function relay_private.is_room_owner(uuid) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
alter table public.atlas_versions enable row level security;
alter table public.room_layout_items enable row level security;
alter table public.team_graph_items enable row level security;
alter table public.node_stances enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_comments enable row level security;
alter table public.proposal_decisions enable row level security;
alter table public.activity_events enable row level security;
alter table public.action_briefs enable row level security;
alter table public.devin_runs enable row level security;
alter table public.devin_events enable row level security;

create policy rooms_member_read on public.rooms
  for select to authenticated
  using (relay_private.is_room_member(id));
create policy room_members_member_read on public.room_members
  for select to authenticated
  using (relay_private.is_room_member(room_id));
-- Deliberately no direct room_invites policy: even owners use token-safe RPCs.
create policy atlas_versions_member_read on public.atlas_versions
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy room_layout_items_member_read on public.room_layout_items
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy team_graph_items_member_read on public.team_graph_items
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy node_stances_member_read on public.node_stances
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy proposals_member_read on public.proposals
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy proposal_comments_member_read on public.proposal_comments
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy proposal_decisions_member_read on public.proposal_decisions
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy activity_events_member_read on public.activity_events
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy action_briefs_member_read on public.action_briefs
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy devin_runs_member_read on public.devin_runs
  for select to authenticated
  using (relay_private.is_room_member(room_id));
create policy devin_events_member_read on public.devin_events
  for select to authenticated
  using (relay_private.is_room_member(room_id));

revoke all on table public.rooms, public.room_members, public.room_invites,
  public.atlas_versions, public.room_layout_items, public.team_graph_items,
  public.node_stances, public.proposals, public.proposal_comments,
  public.proposal_decisions, public.activity_events, public.action_briefs,
  public.devin_runs, public.devin_events from anon, authenticated;

grant select on table public.rooms, public.room_members, public.atlas_versions,
  public.room_layout_items, public.team_graph_items, public.node_stances,
  public.proposals, public.proposal_comments, public.proposal_decisions,
  public.activity_events, public.action_briefs, public.devin_runs,
  public.devin_events to authenticated;

commit;
