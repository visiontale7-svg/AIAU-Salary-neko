begin;

alter table public.devin_runs
  add column provider_health text not null default 'unknown'
    check (provider_health in ('healthy', 'delayed', 'stale', 'unknown')),
  add column last_successful_poll_at timestamptz,
  add column last_provider_event_at timestamptz,
  add column consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  add column retry_after_at timestamptz;

alter table public.devin_events
  add column actor_type text;

update public.devin_events
set actor_type = case
  when event_type = 'provider_message' then 'devin'
  when actor_id is not null then 'owner'
  else 'system'
end;

alter table public.devin_events
  alter column actor_type set not null,
  add constraint devin_events_actor_type_check
    check (actor_type in ('devin', 'owner', 'system'));

create function relay_private.assign_devin_event_actor_type()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  -- Actor provenance is derived from trusted columns, never from a caller.
  new.actor_type := case
    when new.event_type = 'provider_message' then 'devin'
    when new.actor_id is not null then 'owner'
    else 'system'
  end;
  return new;
end;
$$;

revoke all on function relay_private.assign_devin_event_actor_type()
  from public, anon, authenticated;

create trigger devin_events_assign_actor_type
before insert on public.devin_events
for each row execute function relay_private.assign_devin_event_actor_type();

create or replace function relay_private.format_devin_run(p_row public.devin_runs)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_row.id,
    'roomId', p_row.room_id,
    'actionBriefId', p_row.action_brief_id,
    'externalSessionId', p_row.external_session_id,
    'externalUrl', p_row.external_url,
    'state', p_row.state,
    'statusDetail', p_row.status_detail,
    'pullRequestUrl', p_row.pull_request_url,
    'pullRequestState', p_row.pull_request_state,
    'checksState', p_row.checks_state,
    'providerHealth', p_row.provider_health,
    'lastSuccessfulPollAt', p_row.last_successful_poll_at,
    'lastProviderEventAt', p_row.last_provider_event_at,
    'consecutiveFailures', p_row.consecutive_failures,
    'retryAfterAt', p_row.retry_after_at,
    'updatedAt', p_row.updated_at
  ));
$$;

create or replace function public.update_devin_run_snapshot(
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
  v_poll_succeeded boolean := false;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array[
      'externalSessionId', 'externalUrl', 'state', 'statusDetail',
      'pullRequestUrl', 'pullRequestState', 'checksState', 'pollSucceeded'
    ],
    'Devin provider snapshot'
  );
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_input ? 'pollSucceeded'
    and jsonb_typeof(p_input->'pollSucceeded') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'invalid_devin_provider_snapshot';
  end if;
  v_poll_succeeded := coalesce((p_input->>'pollSucceeded')::boolean, false);

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

  -- Lifecycle state remains monotonic and independent of provider health.
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
      provider_health = case when v_poll_succeeded then 'healthy' else provider_health end,
      last_successful_poll_at = case when v_poll_succeeded then now() else last_successful_poll_at end,
      consecutive_failures = case when v_poll_succeeded then 0 else consecutive_failures end,
      retry_after_at = case when v_poll_succeeded then null else retry_after_at end,
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
  if v_before.provider_health = 'stale'
    and v_row.provider_health = 'healthy'
  then
    perform relay_private.record_activity(
      p_room_id, 'devin_provider_health_recovered', p_run_id::text,
      v_before.requested_by, null
    );
  end if;
  return relay_private.format_devin_run(v_row);
end;
$$;

create function public.record_devin_provider_failure(
  p_room_id uuid,
  p_run_id uuid,
  p_error_code text,
  p_retry_after_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_before public.devin_runs%rowtype;
  v_row public.devin_runs%rowtype;
  v_next_retry_at timestamptz;
  v_next_failure_count integer;
  v_backoff_seconds integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_error_code not in (
    'provider_permission_denied', 'provider_request_rejected',
    'provider_rate_limited', 'provider_result_unknown',
    'invalid_provider_response', 'provider_page_limit'
  ) then
    raise exception using errcode = '22023', message = 'invalid_provider_failure';
  end if;
  if (p_error_code = 'provider_rate_limited' and p_retry_after_at is null)
    or (p_retry_after_at is not null and (
      p_error_code <> 'provider_rate_limited'
      or p_retry_after_at <= now()
      or p_retry_after_at > now() + interval '24 hours 1 minute'
    ))
  then
    raise exception using errcode = '22023', message = 'invalid_provider_retry_after';
  end if;

  select * into v_before
  from public.devin_runs
  where id = p_run_id
    and room_id = p_room_id
    and provider_authorized
    and provider_attempted_at is not null
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'devin_run_not_found';
  end if;

  v_next_failure_count := least(v_before.consecutive_failures::bigint + 1, 1000000)::integer;
  v_backoff_seconds := case
    when v_next_failure_count = 1 then 5
    when v_next_failure_count = 2 then 10
    when v_next_failure_count = 3 then 20
    when v_next_failure_count = 4 then 40
    else 60
  end;
  v_next_retry_at := case
    when p_error_code = 'provider_rate_limited' then
      greatest(p_retry_after_at, v_before.retry_after_at)
    else
      greatest(now() + make_interval(secs => v_backoff_seconds), v_before.retry_after_at)
  end;

  update public.devin_runs
  set provider_health = case
        when v_next_failure_count >= 3 then 'stale'
        else 'delayed'
      end,
      consecutive_failures = v_next_failure_count,
      retry_after_at = v_next_retry_at,
      updated_at = now()
  where id = p_run_id
  returning * into v_row;

  if v_before.provider_health <> 'stale'
    and v_row.provider_health = 'stale'
  then
    perform relay_private.record_activity(
      p_room_id, 'devin_provider_health_stale', p_run_id::text,
      v_before.requested_by, null
    );
  end if;
  return relay_private.format_devin_run(v_row);
end;
$$;

create or replace function public.append_devin_provider_events(
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
  v_max_created_at timestamptz;
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
      array['externalEventId', 'eventType', 'actorType', 'createdAt', 'text'],
      'Devin provider event'
    );
    v_text := v_event->>'text';
    begin
      v_created_at := (v_event->>'createdAt')::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_devin_provider_event_timestamp';
    end;
    if v_event->>'eventType' <> 'provider_message'
      or v_event->>'actorType' <> 'devin'
      or char_length(coalesce(v_event->>'externalEventId', '')) not between 1 and 200
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
      room_id, run_id, external_event_id, event_type, actor_type, text, actor_id, created_at
    ) values (
      p_room_id,
      p_run_id,
      v_event->>'externalEventId',
      'provider_message',
      'devin',
      v_text,
      null,
      v_created_at
    )
    on conflict (run_id, external_event_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
    if v_row_count > 0 then
      v_max_created_at := case
        when v_max_created_at is null or v_created_at > v_max_created_at then v_created_at
        else v_max_created_at
      end;
    end if;
  end loop;

  if v_inserted > 0 then
    perform relay_private.record_activity(
      p_room_id, 'devin_events_appended', p_run_id::text, v_requester, null
    );
  end if;
  if p_end_cursor is not null or v_max_created_at is not null then
    update public.devin_runs
    set provider_message_cursor = coalesce(p_end_cursor, provider_message_cursor),
        last_provider_event_at = case
          when v_max_created_at is null then last_provider_event_at
          when last_provider_event_at is null or v_max_created_at > last_provider_event_at then v_max_created_at
          else last_provider_event_at
        end,
        updated_at = now()
    where id = p_run_id and room_id = p_room_id;
  end if;
  return v_inserted;
end;
$$;

revoke all on function public.record_devin_provider_failure(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_devin_provider_failure(uuid, uuid, text, timestamptz)
  to service_role;

-- Reassert service-only permissions after replacing these provider-derived
-- mutation functions. Room members retain SELECT through RLS only.
revoke all on function public.update_devin_run_snapshot(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.append_devin_provider_events(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.update_devin_run_snapshot(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.append_devin_provider_events(uuid, uuid, jsonb, text)
  to service_role;

commit;
