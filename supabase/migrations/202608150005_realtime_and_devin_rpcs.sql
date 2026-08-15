begin;

create function relay_private.can_access_realtime_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, relay_private
as $$
begin
  if p_topic is null
    or p_topic !~* '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;
  return relay_private.is_room_member(substring(p_topic from 6)::uuid);
end;
$$;

revoke all on function relay_private.can_access_realtime_topic(text) from public, anon;
grant execute on function relay_private.can_access_realtime_topic(text) to authenticated;

drop policy if exists relay_room_receive on realtime.messages;
drop policy if exists relay_room_send on realtime.messages;
drop policy if exists relay_room_receive_guard on realtime.messages;
drop policy if exists relay_room_send_guard on realtime.messages;
create policy relay_room_receive
  on realtime.messages
  for select
  to authenticated
  using (
    extension in ('broadcast', 'presence')
    and relay_private.can_access_realtime_topic(realtime.topic())
  );
create policy relay_room_send
  on realtime.messages
  for insert
  to authenticated
  with check (
    extension = 'presence'
    and relay_private.can_access_realtime_topic(realtime.topic())
  );
-- Restrictive guards keep the membership condition authoritative even if a
-- later integration adds another permissive realtime.messages policy.
create policy relay_room_receive_guard
  on realtime.messages
  as restrictive
  for select
  to authenticated
  using (
    extension in ('broadcast', 'presence')
    and relay_private.can_access_realtime_topic(realtime.topic())
  );
create policy relay_room_send_guard
  on realtime.messages
  as restrictive
  for insert
  to authenticated
  with check (
    extension = 'presence'
    and relay_private.can_access_realtime_topic(realtime.topic())
  );

create function relay_private.broadcast_activity_hint()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, realtime
as $$
begin
  -- Broadcast is only a hint. Clients replay the durable table by sequence.
  -- No package, evidence, comment, proposal body, or action brief is included.
  perform realtime.send(
    jsonb_strip_nulls(jsonb_build_object(
      'seq', new.seq,
      'type', new.event_type,
      'targetId', new.target_id
    )),
    'activity',
    'room:' || new.room_id::text,
    true
  );
  return new;
exception when others then
  -- Realtime availability must never roll back an already-valid durable write.
  return new;
end;
$$;

create trigger activity_events_broadcast_hint
  after insert on public.activity_events
  for each row execute function relay_private.broadcast_activity_hint();

revoke all on function relay_private.broadcast_activity_hint() from public, anon, authenticated;

-- Client-authored Broadcast payloads cannot be trusted to identify their
-- sender. Authenticated members therefore publish ephemeral events through
-- this RPC; the server derives userId from auth.uid(). Direct Realtime INSERT
-- policy above allows Presence only.
create function public.broadcast_relay_ephemeral(
  p_room_id uuid,
  p_event text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, realtime, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_out jsonb;
begin
  if v_actor is null or not relay_private.is_room_member(p_room_id) then
    raise exception using errcode = '42501', message = 'member_required';
  end if;
  if p_event = 'focus' then
    perform relay_private.assert_json_keys(p_payload, array['nodeId'], 'focus payload');
    if p_payload ? 'nodeId' and char_length(coalesce(p_payload->>'nodeId', '')) not between 1 and 120 then
      raise exception using errcode = '22023', message = 'invalid_focus_payload';
    end if;
  elsif p_event = 'typing' then
    perform relay_private.assert_json_keys(p_payload, array['targetId', 'typing'], 'typing payload');
    if char_length(coalesce(p_payload->>'targetId', '')) not between 1 and 160
      or jsonb_typeof(p_payload->'typing') is distinct from 'boolean'
    then
      raise exception using errcode = '22023', message = 'invalid_typing_payload';
    end if;
  elsif p_event = 'drag_preview' then
    perform relay_private.assert_json_keys(p_payload, array['nodeId', 'x', 'y'], 'drag payload');
    if char_length(coalesce(p_payload->>'nodeId', '')) not between 1 and 120
      or jsonb_typeof(p_payload->'x') is distinct from 'number'
      or jsonb_typeof(p_payload->'y') is distinct from 'number'
      or abs((p_payload->>'x')::double precision) > 10000000
      or abs((p_payload->>'y')::double precision) > 10000000
    then
      raise exception using errcode = '22023', message = 'invalid_drag_payload';
    end if;
  else
    raise exception using errcode = '22023', message = 'unsupported_realtime_event';
  end if;
  v_out := jsonb_build_object('userId', v_actor) || p_payload;
  perform realtime.send(v_out, p_event, 'room:' || p_room_id::text, true);
  return true;
end;
$$;

revoke all on function public.broadcast_relay_ephemeral(uuid, text, jsonb) from public, anon;
grant execute on function public.broadcast_relay_ephemeral(uuid, text, jsonb) to authenticated;

-- Build the durable room projection in one SQL statement. This gives the
-- package, current-version collaboration state, and activity cursor the same
-- MVCC snapshot; a client must never advance its replay cursor using a newer
-- activity read paired with older independently fetched rows.
create function public.get_room_bundle(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_bundle jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;

  select jsonb_build_object(
    'room', to_jsonb(room),
    'member', to_jsonb(member),
    'atlas', version.package,
    'layout', coalesce((
      select jsonb_agg(to_jsonb(layout_item) order by layout_item.node_id)
      from public.room_layout_items layout_item
      where layout_item.room_id = room.id
        and layout_item.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'teamItems', coalesce((
      select jsonb_agg(to_jsonb(team_item) order by team_item.item_id)
      from public.team_graph_items team_item
      where team_item.room_id = room.id
        and team_item.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'stances', coalesce((
      select jsonb_agg(to_jsonb(stance) order by stance.node_id, stance.user_id)
      from public.node_stances stance
      where stance.room_id = room.id
        and stance.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'proposals', coalesce((
      select jsonb_agg(to_jsonb(proposal) order by proposal.created_at, proposal.id)
      from public.proposals proposal
      where proposal.room_id = room.id
        and proposal.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(comment) order by comment.created_at, comment.id)
      from public.proposal_comments comment
      join public.proposals proposal
        on proposal.room_id = comment.room_id and proposal.id = comment.proposal_id
      where comment.room_id = room.id
        and proposal.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(to_jsonb(decision) order by decision.decided_at, decision.id)
      from public.proposal_decisions decision
      join public.proposals proposal
        on proposal.room_id = decision.room_id and proposal.id = decision.proposal_id
      where decision.room_id = room.id
        and proposal.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'actionBriefs', coalesce((
      select jsonb_agg(to_jsonb(brief) order by brief.created_at, brief.id)
      from public.action_briefs brief
      join public.proposal_decisions decision
        on decision.room_id = brief.room_id and decision.id = brief.decision_id
      join public.proposals proposal
        on proposal.room_id = decision.room_id and proposal.id = decision.proposal_id
      where brief.room_id = room.id
        and proposal.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'devinRuns', coalesce((
      select jsonb_agg(to_jsonb(run) order by run.updated_at desc, run.id)
      from public.devin_runs run
      join public.action_briefs brief
        on brief.room_id = run.room_id and brief.id = run.action_brief_id
      join public.proposal_decisions decision
        on decision.room_id = brief.room_id and decision.id = brief.decision_id
      join public.proposals proposal
        on proposal.room_id = decision.room_id and proposal.id = decision.proposal_id
      where run.room_id = room.id
        and proposal.atlas_version_id = room.current_version_id
    ), '[]'::jsonb),
    'lastActivitySeq', coalesce((
      select max(activity.seq)
      from public.activity_events activity
      where activity.room_id = room.id
    ), 0)
  ) into v_bundle
  from public.rooms room
  join public.room_members member
    on member.room_id = room.id and member.user_id = v_actor
  join public.atlas_versions version
    on version.room_id = room.id and version.id = room.current_version_id
  where room.id = p_room_id;

  if not found then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;
  return v_bundle;
end;
$$;

revoke all on function public.get_room_bundle(uuid) from public, anon;
grant execute on function public.get_room_bundle(uuid) to authenticated;

create function public.load_action_brief_for_devin(
  p_room_id uuid,
  p_action_brief_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_row public.action_briefs%rowtype;
begin
  if auth.uid() is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  if not exists (select 1 from public.rooms where id = p_room_id and status = 'open') then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  select * into v_row
  from public.action_briefs
  where id = p_action_brief_id and room_id = p_room_id;
  if not found then
    raise exception using errcode = '22023', message = 'approved_action_brief_required';
  end if;
  return relay_private.format_action_brief(v_row);
end;
$$;

create function public.create_devin_run(
  p_room_id uuid,
  p_action_brief_id uuid,
  p_client_request_id text,
  p_configured boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.devin_runs%rowtype;
  v_entitlement relay_private.devin_entitlements%rowtype;
  v_provider_authorized boolean := false;
  v_status_detail text := 'not_configured';
  v_operator_max_acu_limit integer;
  v_run_count integer := 0;
begin
  perform relay_private.assert_client_key(p_client_request_id, 'clientRequestId');
  if v_actor is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('devin:' || p_action_brief_id::text, 0));

  -- Resolve an existing idempotent reservation before mutable lifecycle
  -- checks. This never reopens provider spend, but it lets a lost response be
  -- recovered after the room closes or the run changes state.
  select * into v_row
  from public.devin_runs
  where room_id = p_room_id and client_request_id = p_client_request_id;
  if found then
    if v_row.action_brief_id <> p_action_brief_id then
      raise exception using errcode = '22023', message = 'client_request_id_reused_with_different_input';
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'run', relay_private.format_devin_run(v_row),
      'providerAuthorized', v_row.provider_authorized,
      'operatorMaxAcuLimit', v_row.reserved_max_acu_limit,
      'shouldStart', v_row.provider_authorized
        and v_row.state = 'queued'
        and v_row.provider_attempted_at is null
        and v_row.external_session_id is null
    ));
  end if;

  if not exists (select 1 from public.rooms where id = p_room_id and status = 'open') then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  if not exists (
    select 1 from public.action_briefs
    where id = p_action_brief_id and room_id = p_room_id
  ) then
    raise exception using errcode = '22023', message = 'approved_action_brief_required';
  end if;

  -- A changed client key must not bypass an unresolved paid attempt. The
  -- partial unique index is the concurrent backstop for this lookup.
  select * into v_row
  from public.devin_runs
  where action_brief_id = p_action_brief_id
    and state in ('queued', 'working', 'needs_input', 'approval_needed', 'blocked')
  for update;
  if found then
    return jsonb_strip_nulls(jsonb_build_object(
      'run', relay_private.format_devin_run(v_row),
      'providerAuthorized', v_row.provider_authorized,
      'operatorMaxAcuLimit', v_row.reserved_max_acu_limit,
      'shouldStart', false
    ));
  end if;

  if p_configured then
    select * into v_entitlement
    from relay_private.devin_entitlements
    where user_id = v_actor
    for update;
    if not found
      or not v_entitlement.enabled
      or (v_entitlement.expires_at is not null and v_entitlement.expires_at <= now())
    then
      v_status_detail := 'provider_not_entitled';
    else
      select count(*) into v_run_count
      from public.devin_runs
      where requested_by = v_actor
        and provider_authorized
        and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
      if v_run_count >= v_entitlement.max_runs_per_day then
        v_status_detail := 'provider_quota_exhausted';
      else
        v_provider_authorized := true;
        v_status_detail := 'Devin session request queued';
        v_operator_max_acu_limit := v_entitlement.max_acu_limit;
      end if;
    end if;
  end if;

  insert into public.devin_runs(
    room_id,
    action_brief_id,
    client_request_id,
    state,
    status_detail,
    provider_authorized,
    reserved_max_acu_limit,
    requested_by
  ) values (
    p_room_id,
    p_action_brief_id,
    p_client_request_id,
    case when v_provider_authorized then 'queued' else 'not_configured' end,
    v_status_detail,
    v_provider_authorized,
    v_operator_max_acu_limit,
    v_actor
  ) returning * into v_row;
  perform relay_private.record_activity(
    p_room_id, 'devin_run_requested', v_row.id::text, v_actor, p_client_request_id
  );
  return jsonb_strip_nulls(jsonb_build_object(
    'run', relay_private.format_devin_run(v_row),
    'providerAuthorized', v_provider_authorized,
    'operatorMaxAcuLimit', v_operator_max_acu_limit,
    'shouldStart', v_provider_authorized
  ));
end;
$$;

create function public.load_devin_run_for_owner(
  p_room_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_row public.devin_runs%rowtype;
begin
  if auth.uid() is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  select * into v_row
  from public.devin_runs
  where id = p_run_id and room_id = p_room_id;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;
  return relay_private.format_devin_run(v_row)
    || jsonb_strip_nulls(jsonb_build_object(
      'providerMessageCursor', v_row.provider_message_cursor
    ));
end;
$$;

create function public.claim_devin_session_attempt(
  p_room_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claimed boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  update public.devin_runs run
  set provider_authorized = false,
      reserved_max_acu_limit = null,
      state = 'not_configured',
      status_detail = 'provider_not_entitled',
      updated_at = now()
  where run.id = p_run_id
    and run.room_id = p_room_id
    and run.provider_attempted_at is null
    and not exists (
      select 1 from relay_private.devin_entitlements entitlement
      where entitlement.user_id = run.requested_by
        and entitlement.enabled
        and (entitlement.expires_at is null or entitlement.expires_at > now())
    );
  update public.devin_runs run
  set provider_attempted_at = now(),
      state = 'blocked',
      status_detail = 'provider_result_unknown',
      updated_at = now()
  where run.id = p_run_id
    and run.room_id = p_room_id
    and run.provider_authorized
    and run.provider_attempted_at is null
    and run.external_session_id is null
    and exists (
      select 1 from relay_private.devin_entitlements entitlement
      where entitlement.user_id = run.requested_by
        and entitlement.enabled
        and (entitlement.expires_at is null or entitlement.expires_at > now())
    );
  v_claimed := found;
  return v_claimed;
end;
$$;

create function public.update_devin_run_snapshot(
  p_room_id uuid,
  p_run_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_before public.devin_runs%rowtype;
  v_row public.devin_runs%rowtype;
  v_state text;
  v_status_detail text;
  v_external_session_id text;
  v_external_url text;
  v_pull_request_url text;
  v_pull_request_state text;
  v_checks_state text;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array[
      'externalSessionId', 'externalUrl', 'state', 'statusDetail',
      'pullRequestUrl', 'pullRequestState', 'checksState'
    ],
    'Devin provider snapshot'
  );
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  select * into v_before
  from public.devin_runs
  where id = p_run_id and room_id = p_room_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;
  if not v_before.provider_authorized or v_before.provider_attempted_at is null then
    raise exception using errcode = '42501', message = 'provider_attempt_not_reserved';
  end if;

  v_state := coalesce(p_input->>'state', v_before.state);
  v_status_detail := case
    when p_input ? 'statusDetail' then nullif(p_input->>'statusDetail', '')
    else v_before.status_detail
  end;
  v_external_session_id := case
    when p_input ? 'externalSessionId' then nullif(p_input->>'externalSessionId', '')
    else v_before.external_session_id
  end;
  v_external_url := case
    when p_input ? 'externalUrl' then nullif(p_input->>'externalUrl', '')
    else v_before.external_url
  end;
  v_pull_request_url := case
    when p_input ? 'pullRequestUrl' then nullif(p_input->>'pullRequestUrl', '')
    else v_before.pull_request_url
  end;
  v_pull_request_state := case
    when p_input ? 'pullRequestState' then nullif(p_input->>'pullRequestState', '')
    else v_before.pull_request_state
  end;
  v_checks_state := case
    when p_input ? 'checksState' then nullif(p_input->>'checksState', '')
    else v_before.checks_state
  end;

  -- Provider polls can complete out of order across owner tabs. A stale
  -- working snapshot must never reopen a terminal run. The pre-POST blocked
  -- marker can become failed after an explicit 4xx rejection, or can attach
  -- the one reconciled/returned external Session, but cannot otherwise become
  -- active while its paid result is unknown.
  if v_before.state in ('completed', 'failed') then
    v_state := v_before.state;
    v_status_detail := v_before.status_detail;
  elsif v_before.state = 'blocked'
    and v_before.status_detail = 'provider_result_unknown'
    and v_before.external_session_id is null
    and v_external_session_id is null
    and v_state not in ('blocked', 'failed')
  then
    raise exception using errcode = '55000', message = 'provider_result_requires_reconciliation';
  end if;

  if v_state not in ('not_configured', 'queued', 'working', 'needs_input', 'approval_needed', 'completed', 'failed', 'blocked')
    or (v_status_detail is not null and char_length(v_status_detail) > 2000)
    or (v_external_session_id is not null and (
      char_length(v_external_session_id) not between 3 and 200
      or v_external_session_id !~ '^devin-[A-Za-z0-9_-]+$'
    ))
    or (v_external_url is not null and (
      v_external_session_id is null
      or rtrim(v_external_url, '/') <> ('https://app.devin.ai/sessions/' || v_external_session_id)
    ))
    or (v_pull_request_url is not null and v_pull_request_url !~ '^https://github\.com/visiontale7-svg/AIAU-Salary-neko/pull/[1-9][0-9]*$')
    or (v_pull_request_state is not null and char_length(v_pull_request_state) > 80)
    or (v_checks_state is not null and v_checks_state not in ('unknown', 'pending', 'passing', 'failing'))
  then
    raise exception using errcode = '22023', message = 'invalid_devin_provider_snapshot';
  end if;
  if v_before.external_session_id is not null
    and v_external_session_id is distinct from v_before.external_session_id
  then
    raise exception using errcode = '22023', message = 'external_session_id_is_immutable';
  end if;
  if coalesce(v_status_detail, '') ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or coalesce(v_status_detail, '') ~ '(/Users/|/home/|/private/|/var/|/tmp/|/Volumes/|/opt/|/etc/|/srv/|/root/|/mnt/|/media/|/run/|/usr/|/Library/)'
    or coalesce(v_status_detail, '') ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=])'
  then
    raise exception using errcode = '22023', message = 'unsanitized_devin_status_detail';
  end if;
  if v_status_detail is not null then
    perform relay_private.assert_safe_shared_text(v_status_detail, 'Devin status detail');
  end if;

  update public.devin_runs
  set external_session_id = v_external_session_id,
      external_url = v_external_url,
      state = v_state,
      status_detail = v_status_detail,
      pull_request_url = v_pull_request_url,
      pull_request_state = v_pull_request_state,
      checks_state = v_checks_state,
      updated_at = now()
  where id = p_run_id
  returning * into v_row;

  if row(
    v_before.external_session_id, v_before.external_url, v_before.state,
    v_before.status_detail, v_before.pull_request_url,
    v_before.pull_request_state, v_before.checks_state
  ) is distinct from row(
    v_row.external_session_id, v_row.external_url, v_row.state,
    v_row.status_detail, v_row.pull_request_url,
    v_row.pull_request_state, v_row.checks_state
  ) then
    perform relay_private.record_activity(
      p_room_id, 'devin_run_updated', p_run_id::text, v_before.requested_by, null
    );
  end if;
  return relay_private.format_devin_run(v_row);
end;
$$;

create function public.append_devin_provider_events(
  p_room_id uuid,
  p_run_id uuid,
  p_events jsonb,
  p_end_cursor text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_requester uuid;
  v_event jsonb;
  v_created_at timestamptz;
  v_inserted integer := 0;
  v_row_count integer;
  v_text text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  select requested_by into v_requester
  from public.devin_runs
  where id = p_run_id
    and room_id = p_room_id
    and provider_authorized
    and provider_attempted_at is not null
    and external_session_id is not null;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array'
    or jsonb_array_length(p_events) > 1000
    or (p_end_cursor is not null and char_length(p_end_cursor) not between 1 and 500)
  then
    raise exception using errcode = '22023', message = 'invalid_devin_provider_events';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    perform relay_private.assert_json_keys(
      v_event,
      array['externalEventId', 'createdAt', 'text'],
      'Devin provider event'
    );
    v_text := v_event->>'text';
    begin
      v_created_at := (v_event->>'createdAt')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_devin_provider_event_timestamp';
    end;
    if char_length(coalesce(v_event->>'externalEventId', '')) not between 1 and 200
      or v_event->>'externalEventId' !~ '^[A-Za-z0-9_.:-]+$'
      or char_length(coalesce(v_text, '')) not between 1 and 6000
      or v_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
      or v_text ~ '(/Users/|/home/|/private/|/var/|/tmp/|/Volumes/|/opt/|/etc/|/srv/|/root/|/mnt/|/media/|/run/|/usr/|/Library/)'
      or v_text ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=])'
    then
      raise exception using errcode = '22023', message = 'unsanitized_devin_provider_event';
    end if;
    perform relay_private.assert_safe_shared_text(v_text, 'Devin provider event');
    insert into public.devin_events(
      room_id, run_id, external_event_id, event_type, text, actor_id, created_at
    ) values (
      p_room_id,
      p_run_id,
      v_event->>'externalEventId',
      'provider_message',
      v_text,
      null,
      v_created_at
    )
    on conflict (run_id, external_event_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;
  if v_inserted > 0 then
    perform relay_private.record_activity(
      p_room_id, 'devin_events_appended', p_run_id::text, v_requester, null
    );
  end if;
  if p_end_cursor is not null then
    update public.devin_runs
    set provider_message_cursor = p_end_cursor,
        updated_at = now()
    where id = p_run_id and room_id = p_room_id;
  end if;
  return v_inserted;
end;
$$;

create function public.append_devin_follow_up(
  p_room_id uuid,
  p_run_id uuid,
  p_message text,
  p_client_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.devin_runs%rowtype;
  v_event public.devin_events%rowtype;
  v_outcome public.devin_events%rowtype;
  v_outcome_found boolean;
begin
  perform relay_private.assert_client_key(p_client_request_id, 'clientRequestId');
  if v_actor is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 6000
    or translate(p_message, E'\n\t', '') ~ '[[:cntrl:]]'
    or p_message ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or p_message ~ '(/Users/|/home/|/private/|/var/|/tmp/|/Volumes/|/opt/|/etc/|/srv/|/root/|/mnt/|/media/|/run/|/usr/|/Library/)'
    or p_message ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=])'
  then
    raise exception using errcode = '22023', message = 'invalid_follow_up_message';
  end if;
  perform relay_private.assert_safe_shared_text(p_message, 'Devin follow-up');
  select * into v_run
  from public.devin_runs
  where id = p_run_id and room_id = p_room_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;

  -- Resolve an already-committed request before consulting mutable room,
  -- entitlement, or run state. A lost Edge response must remain deterministic
  -- after close/revocation/completion, and an attempted-but-unconfirmed send is
  -- never issued again automatically.
  select * into v_event
  from public.devin_events
  where run_id = p_run_id
    and client_request_id = p_client_request_id
    and event_type = 'owner_follow_up_attempted';
  if found then
    if v_event.text <> btrim(p_message) then
      raise exception using errcode = '22023', message = 'client_request_id_reused_with_different_input';
    end if;
    select * into v_outcome
    from public.devin_events
    where run_id = p_run_id
      and client_request_id = p_client_request_id
      and event_type in (
        'owner_follow_up_sent', 'owner_follow_up_rejected', 'owner_follow_up_unknown'
      )
    order by case event_type
      when 'owner_follow_up_sent' then 1
      when 'owner_follow_up_rejected' then 2
      else 3
    end
    limit 1;
    v_outcome_found := found;
    return jsonb_build_object(
      'run', relay_private.format_devin_run(v_run),
      'shouldSend', false,
      'deliveryStatus', case
        when not v_outcome_found then 'unknown'
        when v_outcome.event_type = 'owner_follow_up_sent' then 'sent'
        when v_outcome.event_type = 'owner_follow_up_rejected' then 'rejected'
        else 'unknown'
      end
    );
  end if;

  if not exists (select 1 from public.rooms where id = p_room_id and status = 'open') then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  if v_run.state = 'not_configured' then
    raise exception using errcode = '55000', message = 'not_configured';
  end if;
  if not v_run.provider_authorized
    or v_run.external_session_id is null
    or not exists (
      select 1
      from relay_private.devin_entitlements entitlement
      where entitlement.user_id = v_actor
        and entitlement.enabled
        and (entitlement.expires_at is null or entitlement.expires_at > now())
    )
  then
    raise exception using errcode = '42501', message = 'provider_not_entitled';
  end if;
  if v_run.state in ('completed', 'failed', 'blocked') then
    raise exception using errcode = '55000', message = 'devin_run_is_terminal';
  end if;

  insert into public.devin_events(
    room_id, run_id, event_type, text, actor_id, client_request_id
  ) values (
    p_room_id, p_run_id, 'owner_follow_up_attempted', btrim(p_message), v_actor, p_client_request_id
  ) returning * into v_event;
  perform relay_private.record_activity(
    p_room_id, 'devin_follow_up_attempted', p_run_id::text, v_actor, p_client_request_id
  );
  return jsonb_build_object(
    'run', relay_private.format_devin_run(v_run),
    'shouldSend', true,
    'deliveryStatus', 'pending'
  );
end;
$$;

create function public.record_devin_follow_up_result(
  p_room_id uuid,
  p_run_id uuid,
  p_client_request_id text,
  p_result text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_run public.devin_runs%rowtype;
  v_event_type text;
  v_text text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  perform relay_private.assert_client_key(p_client_request_id, 'clientRequestId');
  if p_result not in ('sent', 'rejected', 'unknown') then
    raise exception using errcode = '22023', message = 'invalid_follow_up_result';
  end if;
  select * into v_run
  from public.devin_runs
  where id = p_run_id and room_id = p_room_id and provider_authorized;
  if not found or not exists (
    select 1 from public.devin_events
    where run_id = p_run_id
      and client_request_id = p_client_request_id
      and event_type = 'owner_follow_up_attempted'
  ) then
    raise exception using errcode = '22023', message = 'follow_up_attempt_not_found';
  end if;
  v_event_type := 'owner_follow_up_' || p_result;
  v_text := case p_result
    when 'sent' then 'Follow-up accepted by Devin'
    when 'rejected' then 'Follow-up rejected by Devin'
    else 'Follow-up delivery result is unknown; do not retry this request ID'
  end;
  insert into public.devin_events(
    room_id, run_id, event_type, text, actor_id, client_request_id
  ) values (
    p_room_id, p_run_id, v_event_type, v_text, null, p_client_request_id
  ) on conflict (run_id, client_request_id, event_type) do nothing;
  perform relay_private.record_activity(
    p_room_id, 'devin_follow_up_' || p_result, p_run_id::text, v_run.requested_by,
    p_client_request_id
  );
  return relay_private.format_devin_run(v_run);
end;
$$;

revoke all on function public.load_action_brief_for_devin(uuid, uuid) from public, anon;
revoke all on function public.create_devin_run(uuid, uuid, text, boolean) from public, anon;
revoke all on function public.load_devin_run_for_owner(uuid, uuid) from public, anon;
revoke all on function public.claim_devin_session_attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_devin_run_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.append_devin_provider_events(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.append_devin_follow_up(uuid, uuid, text, text) from public, anon;
revoke all on function public.record_devin_follow_up_result(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.load_action_brief_for_devin(uuid, uuid) to authenticated;
grant execute on function public.create_devin_run(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.load_devin_run_for_owner(uuid, uuid) to authenticated;
grant execute on function public.claim_devin_session_attempt(uuid, uuid) to service_role;
grant execute on function public.update_devin_run_snapshot(uuid, uuid, jsonb) to service_role;
grant execute on function public.append_devin_provider_events(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.append_devin_follow_up(uuid, uuid, text, text) to authenticated;
grant execute on function public.record_devin_follow_up_result(uuid, uuid, text, text) to service_role;

commit;
