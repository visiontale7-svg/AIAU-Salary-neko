begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'rooms', 'room_members', 'room_invites', 'atlas_versions',
        'room_layout_items', 'team_graph_items', 'node_stances', 'proposals',
        'proposal_comments', 'proposal_decisions', 'activity_events',
        'action_briefs', 'devin_runs', 'devin_events'
      ])
      and relation.relrowsecurity
  ),
  14,
  'RLS is enabled on every exposed Relay table'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name = 'room_invites'
  ),
  0,
  'invite hashes have no direct client table grant'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name = any(array[
        'rooms', 'room_members', 'atlas_versions', 'room_layout_items',
        'team_graph_items', 'node_stances', 'proposals', 'proposal_comments',
        'proposal_decisions', 'activity_events', 'action_briefs',
        'devin_runs', 'devin_events'
      ])
      and privilege_type <> 'SELECT'
  ),
  0,
  'clients cannot bypass RPC mutation invariants with direct writes'
);

select ok(to_regprocedure('public.create_room_with_package(jsonb,jsonb)') is not null, 'create_room_with_package exists');
select ok(to_regprocedure('public.join_room(text,text)') is not null, 'join_room exists');
select ok(to_regprocedure('public.upsert_team_graph_item(jsonb,bigint)') is not null, 'team item CAS RPC exists');
select ok(to_regprocedure('public.save_layout_item(jsonb,bigint)') is not null, 'layout CAS RPC exists');
select ok(to_regprocedure('public.decide_proposal(jsonb,bigint)') is not null, 'owner decision CAS RPC exists');
select ok(to_regprocedure('public.create_action_brief(uuid,jsonb)') is not null, 'owner action brief RPC exists');
select lives_ok(
  $$select relay_private.assert_safe_shared_text('{}', 'fixture')$$,
  'shared-text privacy validator executes on safe JSON'
);

insert into auth.users(id, aud, role) values
  ('10000000-0000-7000-8000-000000000001', 'authenticated', 'authenticated'),
  ('10000000-0000-7000-8000-000000000002', 'authenticated', 'authenticated'),
  ('10000000-0000-7000-8000-000000000003', 'authenticated', 'authenticated');

insert into public.rooms(id, owner_id, title) values (
  '20000000-0000-7000-8000-000000000001',
  '10000000-0000-7000-8000-000000000001',
  'RLS fixture'
);
insert into public.room_members(room_id, user_id, display_name, role) values
  ('20000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000001', 'Owner', 'owner'),
  ('20000000-0000-7000-8000-000000000001', '10000000-0000-7000-8000-000000000002', 'Member', 'member');
insert into public.atlas_versions(
  id, room_id, version, package_id, client_publish_id, package_sha256, package, published_by
) values (
  '30000000-0000-7000-8000-000000000001',
  '20000000-0000-7000-8000-000000000001',
  1,
  'fixture-package',
  'fixture-publish-0001',
  extensions.digest(convert_to('fixture', 'UTF8'), 'sha256'),
  '{}'::jsonb,
  '10000000-0000-7000-8000-000000000001'
);
update public.rooms set current_version_id = '30000000-0000-7000-8000-000000000001'
where id = '20000000-0000-7000-8000-000000000001';
insert into public.node_stances(
  room_id, atlas_version_id, node_id, user_id, stance, last_client_mutation_id
) values (
  '20000000-0000-7000-8000-000000000001',
  '30000000-0000-7000-8000-000000000001',
  'n001',
  '10000000-0000-7000-8000-000000000002',
  'challenge',
  'stance-fixture-0001'
);
insert into public.proposals(
  id, room_id, atlas_version_id, target_type, target_id, operation, proposed_value,
  rationale, status, created_by, client_mutation_id
) values
  ('40000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', 'source_node', 'n001', 'replace_label', '{"value":"A"}', 'fixture', 'accepted', '10000000-0000-7000-8000-000000000002', 'proposal-fixture-0001'),
  ('40000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '30000000-0000-7000-8000-000000000001', 'source_node', 'n001', 'replace_label', '{"value":"B"}', 'fixture', 'accepted', '10000000-0000-7000-8000-000000000002', 'proposal-fixture-0002');
insert into public.proposal_decisions(
  id, room_id, proposal_id, decision, rationale, room_revision, decided_by, client_mutation_id
) values
  ('50000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000001', 'accepted', 'fixture', 1, '10000000-0000-7000-8000-000000000001', 'decision-fixture-0001'),
  ('50000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '40000000-0000-7000-8000-000000000002', 'accepted', 'fixture', 1, '10000000-0000-7000-8000-000000000001', 'decision-fixture-0002');
insert into public.action_briefs(
  id, room_id, decision_id, title, objective, baseline_sha, allowed_files,
  acceptance_commands, created_by, client_mutation_id
) values
  ('60000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', '50000000-0000-7000-8000-000000000001', 'Fixture one', 'Test one', 'dbee0babc7480f25205783a00d2fe96cb65d350d', array['supabase/**'], array['npm test'], '10000000-0000-7000-8000-000000000001', 'brief-fixture-0001'),
  ('60000000-0000-7000-8000-000000000002', '20000000-0000-7000-8000-000000000001', '50000000-0000-7000-8000-000000000002', 'Fixture two', 'Test two', 'dbee0babc7480f25205783a00d2fe96cb65d350d', array['supabase/**'], array['npm test'], '10000000-0000-7000-8000-000000000001', 'brief-fixture-0002');
insert into public.devin_runs(
  id, room_id, action_brief_id, client_request_id, state, status_detail, requested_by
) values (
  '70000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001',
  '60000000-0000-7000-8000-000000000001', 'seed-run-fixture-0001', 'not_configured',
  'not_configured', '10000000-0000-7000-8000-000000000001'
);
insert into public.devin_events(room_id, run_id, event_type, text)
values ('20000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-000000000001', 'fixture', 'fixture');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-7000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from public.rooms), 0, 'authenticated non-member cannot read a room');
select is((select count(*)::integer from public.devin_runs), 0, 'authenticated non-member cannot read Devin runs');
select throws_ok(
  $$select public.get_room_bundle('20000000-0000-7000-8000-000000000001')$$,
  '42501', 'room_membership_required', 'authenticated non-member cannot use the bundle RPC'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-7000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from public.rooms), 1, 'room member can read the room');
select is((select count(*)::integer from public.devin_runs), 1, 'room member can read Devin execution log');
select is(
  public.get_room_bundle('20000000-0000-7000-8000-000000000001')->'room'->>'id',
  '20000000-0000-7000-8000-000000000001',
  'room member can load the atomic room bundle'
);
select is(
  jsonb_typeof(public.get_room_bundle('20000000-0000-7000-8000-000000000001')->'stances'->0),
  'object',
  'atomic room bundle returns complete stance rows instead of scalar stance values'
);
select is(
  jsonb_typeof(public.get_room_bundle('20000000-0000-7000-8000-000000000001')->'decisions'->0),
  'object',
  'atomic room bundle returns complete decision rows instead of scalar decision values'
);
select throws_ok(
  $$select public.decide_proposal('{"roomId":"20000000-0000-7000-8000-000000000001","proposalId":"40000000-0000-7000-8000-000000000001","decision":"accepted","rationale":"x","clientMutationId":"member-decision-0001"}'::jsonb, 1)$$,
  '42501', 'owner_required', 'member cannot decide a proposal'
);
select throws_ok(
  $$select public.create_action_brief('50000000-0000-7000-8000-000000000001', '{"roomId":"20000000-0000-7000-8000-000000000001","title":"x","objective":"x","baselineSha":"dbee0babc7480f25205783a00d2fe96cb65d350d","allowedFiles":["supabase/**"],"acceptanceCommands":["npm test"],"forbiddenActions":[],"approvedContext":[],"clientMutationId":"member-brief-0001"}'::jsonb)$$,
  '42501', 'owner_required', 'member cannot create an ActionBrief'
);
select throws_ok(
  $$select public.create_devin_run('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', 'member-devin-0001', true)$$,
  '42501', 'owner_required', 'member cannot reserve a Devin run'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.claim_devin_session_attempt(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.update_devin_run_snapshot(uuid,uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.append_devin_provider_events(uuid,uuid,jsonb,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_devin_follow_up_result(uuid,uuid,text,text)', 'execute'),
  'authenticated users cannot forge provider-derived run or event state'
);

insert into relay_private.devin_entitlements(
  user_id, enabled, max_runs_per_day, max_acu_limit
) values ('10000000-0000-7000-8000-000000000001', true, 1, 5);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-7000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  public.create_devin_run('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000001', 'owner-devin-0001', true)->>'providerAuthorized',
  'true',
  'entitled owner atomically reserves one bounded Devin run'
);
select is(
  (select count(*)::integer from public.devin_runs where client_request_id = 'owner-devin-0001'),
  1,
  'same Devin client request is idempotent'
);
select is(
  public.create_devin_run('20000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-000000000002', 'owner-devin-0002', true)->'run'->>'statusDetail',
  'provider_quota_exhausted',
  'daily operator quota denies a second paid run'
);
reset role;

select * from finish();
rollback;
