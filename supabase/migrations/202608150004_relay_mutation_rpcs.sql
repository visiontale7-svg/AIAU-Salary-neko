begin;

create function public.upsert_team_graph_item(
  p_input jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_version_id uuid;
  v_item_id text;
  v_item_type text;
  v_client_key text;
  v_payload jsonb;
  v_request jsonb;
  v_response jsonb;
  v_existing public.team_graph_items%rowtype;
  v_row public.team_graph_items%rowtype;
  v_activity_seq bigint;
  v_mode_id text;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array['roomId', 'itemType', 'id', 'label', 'kind', 'modeIds', 'source', 'target', 'type', 'clientMutationId'],
    'team graph input'
  );
  v_room_id := (p_input->>'roomId')::uuid;
  v_item_id := p_input->>'id';
  v_item_type := p_input->>'itemType';
  v_client_key := p_input->>'clientMutationId';
  perform relay_private.assert_client_key(v_client_key, 'clientMutationId');
  if v_actor is null or not relay_private.is_room_member(v_room_id) then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;
  v_request := jsonb_build_object('input', p_input, 'expectedRevision', p_expected_revision);
  v_response := relay_private.acquire_receipt(v_actor, 'upsert_team_graph_item', v_client_key, v_request);
  if v_response is not null then
    return v_response;
  end if;
  select current_version_id into v_version_id
  from public.rooms where id = v_room_id and status = 'open';
  if v_version_id is null then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or char_length(coalesce(v_item_id, '')) not between 1 and 120
    or v_item_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
    or coalesce(v_item_type, '') not in ('node', 'edge')
  then
    raise exception using errcode = '22023', message = 'invalid_team_graph_item';
  end if;
  if relay_private.source_node_exists(v_room_id, v_item_id)
    or relay_private.source_edge_exists(v_room_id, v_item_id)
  then
    raise exception using errcode = '22023', message = 'team_item_id_collides_with_immutable_source';
  end if;

  if v_item_type = 'node' then
    if char_length(coalesce(p_input->>'label', '')) not between 1 and 2000
      or coalesce(p_input->>'kind', '') not in ('anchor', 'claim', 'evidence', 'decision', 'action', 'note')
      or jsonb_typeof(p_input->'modeIds') is distinct from 'array'
      or p_input ? 'source' or p_input ? 'target' or p_input ? 'type'
    then
      raise exception using errcode = '22023', message = 'invalid_team_node';
    end if;
    if jsonb_array_length(p_input->'modeIds') > 30
      or exists (
        select 1 from jsonb_array_elements(p_input->'modeIds') as mode(value)
        where jsonb_typeof(mode.value) <> 'string'
      )
    then
      raise exception using errcode = '22023', message = 'invalid_team_node_modes';
    end if;
    for v_mode_id in select value #>> '{}' from jsonb_array_elements(p_input->'modeIds') loop
      if not exists (
        select 1
        from public.rooms room
        join public.atlas_versions version on version.id = room.current_version_id
        cross join lateral jsonb_array_elements(version.package->'graph'->'modes') mode(value)
        where room.id = v_room_id and mode.value->>'id' = v_mode_id
      ) then
        raise exception using errcode = '22023', message = 'team_node_references_missing_mode';
      end if;
    end loop;
    v_payload := jsonb_build_object(
      'label', p_input->>'label',
      'kind', p_input->>'kind',
      'modeIds', p_input->'modeIds'
    );
  else
    if char_length(coalesce(p_input->>'source', '')) not between 1 and 120
      or char_length(coalesce(p_input->>'target', '')) not between 1 and 120
      or char_length(coalesce(p_input->>'type', '')) not between 1 and 120
      or char_length(coalesce(p_input->>'label', '')) > 1000
      or p_input ? 'kind' or p_input ? 'modeIds'
      or not relay_private.graph_node_exists(v_room_id, p_input->>'source')
      or not relay_private.graph_node_exists(v_room_id, p_input->>'target')
    then
      raise exception using errcode = '22023', message = 'invalid_or_dangling_team_edge';
    end if;
    v_payload := jsonb_build_object(
      'source', p_input->>'source',
      'target', p_input->>'target',
      'type', p_input->>'type',
      'label', coalesce(p_input->>'label', '')
    );
  end if;

  select * into v_existing
  from public.team_graph_items
  where room_id = v_room_id and atlas_version_id = v_version_id and item_id = v_item_id
  for update;
  if found then
    if v_existing.created_by <> v_actor then
      raise exception using errcode = '42501', message = 'team_item_creator_required';
    end if;
    if v_existing.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'revision_conflict';
    end if;
    if v_existing.item_type <> v_item_type then
      raise exception using errcode = '22023', message = 'team_item_type_is_immutable';
    end if;
    update public.team_graph_items
    set payload = v_payload,
        revision = revision + 1,
        updated_by = v_actor,
        last_client_mutation_id = v_client_key,
        updated_at = now()
    where room_id = v_room_id and atlas_version_id = v_version_id and item_id = v_item_id
    returning * into v_row;
  else
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'revision_conflict';
    end if;
    insert into public.team_graph_items(
      room_id, atlas_version_id, item_id, item_type, payload,
      created_by, updated_by, last_client_mutation_id
    ) values (
      v_room_id, v_version_id, v_item_id, v_item_type, v_payload,
      v_actor, v_actor, v_client_key
    ) returning * into v_row;
  end if;

  v_activity_seq := relay_private.record_activity(
    v_room_id, 'team_graph_item_upserted', v_item_id, v_actor, v_client_key
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_team_graph_item(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'upsert_team_graph_item', v_client_key, v_request, v_response
  );
end;
$$;

create function public.save_layout_item(
  p_input jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_version_id uuid;
  v_node_id text;
  v_client_key text;
  v_request jsonb;
  v_response jsonb;
  v_existing public.room_layout_items%rowtype;
  v_row public.room_layout_items%rowtype;
  v_activity_seq bigint;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array['roomId', 'nodeId', 'x', 'y', 'clientMutationId'],
    'layout input'
  );
  v_room_id := (p_input->>'roomId')::uuid;
  v_node_id := p_input->>'nodeId';
  v_client_key := p_input->>'clientMutationId';
  perform relay_private.assert_client_key(v_client_key, 'clientMutationId');
  if v_actor is null or not relay_private.is_room_member(v_room_id) then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;
  v_request := jsonb_build_object('input', p_input, 'expectedRevision', p_expected_revision);
  v_response := relay_private.acquire_receipt(v_actor, 'save_layout_item', v_client_key, v_request);
  if v_response is not null then
    return v_response;
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_input->'x') is distinct from 'number'
    or jsonb_typeof(p_input->'y') is distinct from 'number'
    or abs((p_input->>'x')::numeric) > 10000000
    or abs((p_input->>'y')::numeric) > 10000000
    or not relay_private.graph_node_exists(v_room_id, v_node_id)
  then
    raise exception using errcode = '22023', message = 'invalid_layout_item';
  end if;
  select current_version_id into v_version_id
  from public.rooms where id = v_room_id and status = 'open';
  if v_version_id is null then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;

  select * into v_existing
  from public.room_layout_items
  where room_id = v_room_id and atlas_version_id = v_version_id and node_id = v_node_id
  for update;
  if found then
    if v_existing.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'revision_conflict';
    end if;
    update public.room_layout_items
    set x = (p_input->>'x')::double precision,
        y = (p_input->>'y')::double precision,
        revision = revision + 1,
        updated_by = v_actor,
        last_client_mutation_id = v_client_key,
        updated_at = now()
    where room_id = v_room_id and atlas_version_id = v_version_id and node_id = v_node_id
    returning * into v_row;
  else
    if p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'revision_conflict';
    end if;
    insert into public.room_layout_items(
      room_id, atlas_version_id, node_id, x, y, updated_by, last_client_mutation_id
    ) values (
      v_room_id,
      v_version_id,
      v_node_id,
      (p_input->>'x')::double precision,
      (p_input->>'y')::double precision,
      v_actor,
      v_client_key
    ) returning * into v_row;
  end if;

  v_activity_seq := relay_private.record_activity(
    v_room_id, 'layout_item_saved', v_node_id, v_actor, v_client_key
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_layout_item(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'save_layout_item', v_client_key, v_request, v_response
  );
end;
$$;

create function public.set_node_stance(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_version_id uuid;
  v_node_id text;
  v_stance text;
  v_client_key text;
  v_request jsonb;
  v_response jsonb;
  v_row public.node_stances%rowtype;
  v_activity_seq bigint;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array['roomId', 'nodeId', 'stance', 'clientMutationId'],
    'stance input'
  );
  v_room_id := (p_input->>'roomId')::uuid;
  v_node_id := p_input->>'nodeId';
  v_stance := p_input->>'stance';
  v_client_key := p_input->>'clientMutationId';
  perform relay_private.assert_client_key(v_client_key, 'clientMutationId');
  if v_actor is null or not relay_private.is_room_member(v_room_id) then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;
  v_request := p_input;
  v_response := relay_private.acquire_receipt(v_actor, 'set_node_stance', v_client_key, v_request);
  if v_response is not null then
    return v_response;
  end if;
  if coalesce(v_stance, '') not in ('confirm', 'challenge', 'needs_evidence')
    or not relay_private.graph_node_exists(v_room_id, v_node_id)
  then
    raise exception using errcode = '22023', message = 'invalid_node_stance';
  end if;
  select current_version_id into v_version_id
  from public.rooms where id = v_room_id and status = 'open';
  if v_version_id is null then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;

  insert into public.node_stances(
    room_id, atlas_version_id, node_id, user_id, stance, last_client_mutation_id
  ) values (
    v_room_id, v_version_id, v_node_id, v_actor, v_stance, v_client_key
  )
  on conflict (room_id, atlas_version_id, node_id, user_id)
  do update set
    stance = excluded.stance,
    revision = public.node_stances.revision + 1,
    last_client_mutation_id = excluded.last_client_mutation_id,
    updated_at = now()
  returning * into v_row;

  v_activity_seq := relay_private.record_activity(
    v_room_id, 'node_stance_set', v_node_id, v_actor, v_client_key
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_node_stance(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'set_node_stance', v_client_key, v_request, v_response
  );
end;
$$;

create function public.submit_proposal(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_version_id uuid;
  v_target_type text;
  v_target_id text;
  v_client_key text;
  v_request jsonb := p_input;
  v_response jsonb;
  v_row public.proposals%rowtype;
  v_activity_seq bigint;
  v_target_ok boolean := false;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array['roomId', 'targetType', 'targetId', 'operation', 'proposedValue', 'rationale', 'clientMutationId'],
    'proposal input'
  );
  v_room_id := (p_input->>'roomId')::uuid;
  v_target_type := p_input->>'targetType';
  v_target_id := p_input->>'targetId';
  v_client_key := p_input->>'clientMutationId';
  perform relay_private.assert_client_key(v_client_key, 'clientMutationId');
  if v_actor is null or not relay_private.is_room_member(v_room_id) then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;
  v_response := relay_private.acquire_receipt(v_actor, 'submit_proposal', v_client_key, v_request);
  if v_response is not null then
    return v_response;
  end if;
  select current_version_id into v_version_id
  from public.rooms where id = v_room_id and status = 'open';
  if v_version_id is null then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;

  v_target_ok := relay_private.proposal_target_exists(v_room_id, v_target_type, v_target_id);
  if not v_target_ok
    or char_length(coalesce(p_input->>'rationale', '')) not between 1 and 4000
  then
    raise exception using errcode = '22023', message = 'invalid_proposal';
  end if;
  perform relay_private.assert_proposal_value(
    v_room_id,
    v_target_type,
    p_input->>'operation',
    p_input->'proposedValue'
  );

  insert into public.proposals(
    room_id, atlas_version_id, target_type, target_id, operation, proposed_value,
    rationale, created_by, client_mutation_id
  ) values (
    v_room_id,
    v_version_id,
    v_target_type,
    v_target_id,
    p_input->>'operation',
    p_input->'proposedValue',
    p_input->>'rationale',
    v_actor,
    v_client_key
  ) returning * into v_row;
  v_activity_seq := relay_private.record_activity(
    v_room_id, 'proposal_submitted', v_row.id::text, v_actor, v_client_key
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_proposal(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'submit_proposal', v_client_key, v_request, v_response
  );
end;
$$;

create function public.append_proposal_comment(
  p_input jsonb,
  p_client_mutation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_proposal_id uuid;
  v_request jsonb;
  v_response jsonb;
  v_row public.proposal_comments%rowtype;
  v_activity_seq bigint;
begin
  perform relay_private.assert_json_keys(
    p_input, array['roomId', 'proposalId', 'body'], 'proposal comment input'
  );
  perform relay_private.assert_client_key(p_client_mutation_id, 'clientMutationId');
  v_room_id := (p_input->>'roomId')::uuid;
  v_proposal_id := (p_input->>'proposalId')::uuid;
  if v_actor is null or not relay_private.is_room_member(v_room_id) then
    raise exception using errcode = '42501', message = 'room_membership_required';
  end if;
  v_request := jsonb_build_object('input', p_input, 'clientMutationId', p_client_mutation_id);
  v_response := relay_private.acquire_receipt(
    v_actor, 'append_proposal_comment', p_client_mutation_id, v_request
  );
  if v_response is not null then
    return v_response;
  end if;
  if char_length(coalesce(p_input->>'body', '')) not between 1 and 4000
    or not exists (
      select 1
      from public.proposals proposal
      join public.rooms room on room.id = proposal.room_id
      where proposal.id = v_proposal_id
        and proposal.room_id = v_room_id
        and proposal.atlas_version_id = room.current_version_id
        and room.status = 'open'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_proposal_comment';
  end if;

  insert into public.proposal_comments(
    room_id, proposal_id, body, created_by, client_mutation_id
  ) values (
    v_room_id, v_proposal_id, p_input->>'body', v_actor, p_client_mutation_id
  ) returning * into v_row;
  v_activity_seq := relay_private.record_activity(
    v_room_id, 'proposal_comment_appended', v_row.id::text, v_actor, p_client_mutation_id
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_proposal_comment(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'append_proposal_comment', p_client_mutation_id, v_request, v_response
  );
end;
$$;

create function public.decide_proposal(
  p_input jsonb,
  p_expected_room_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_proposal_id uuid;
  v_client_key text;
  v_request jsonb;
  v_response jsonb;
  v_room public.rooms%rowtype;
  v_proposal public.proposals%rowtype;
  v_row public.proposal_decisions%rowtype;
  v_activity_seq bigint;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array['roomId', 'proposalId', 'decision', 'rationale', 'clientMutationId'],
    'proposal decision input'
  );
  v_room_id := (p_input->>'roomId')::uuid;
  v_proposal_id := (p_input->>'proposalId')::uuid;
  v_client_key := p_input->>'clientMutationId';
  perform relay_private.assert_client_key(v_client_key, 'clientMutationId');
  if v_actor is null or not relay_private.is_room_owner(v_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  v_request := jsonb_build_object('input', p_input, 'expectedRoomRevision', p_expected_room_revision);
  v_response := relay_private.acquire_receipt(v_actor, 'decide_proposal', v_client_key, v_request);
  if v_response is not null then
    return v_response;
  end if;
  if not exists (select 1 from public.rooms where id = v_room_id and status = 'open') then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  if coalesce(p_input->>'decision', '') not in ('accepted', 'rejected', 'deferred')
    or char_length(coalesce(p_input->>'rationale', '')) not between 1 and 4000
    or p_expected_room_revision is null or p_expected_room_revision < 1
  then
    raise exception using errcode = '22023', message = 'invalid_proposal_decision';
  end if;

  select * into v_room from public.rooms where id = v_room_id for update;
  if v_room.status <> 'open' then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  if v_room.revision <> p_expected_room_revision then
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;
  select * into v_proposal
  from public.proposals
  where id = v_proposal_id
    and room_id = v_room_id
    and atlas_version_id = v_room.current_version_id
  for update;
  if not found or v_proposal.status in ('accepted', 'rejected') then
    raise exception using errcode = '55000', message = 'proposal_not_decidable';
  end if;
  if not relay_private.proposal_target_exists(
    v_room_id, v_proposal.target_type, v_proposal.target_id
  ) then
    raise exception using errcode = '55000', message = 'proposal_target_no_longer_exists';
  end if;
  perform relay_private.assert_proposal_value(
    v_room_id,
    v_proposal.target_type,
    v_proposal.operation,
    v_proposal.proposed_value
  );

  insert into public.proposal_decisions(
    room_id, proposal_id, decision, rationale, room_revision,
    decided_by, client_mutation_id
  ) values (
    v_room_id,
    v_proposal_id,
    p_input->>'decision',
    p_input->>'rationale',
    v_room.revision + 1,
    v_actor,
    v_client_key
  ) returning * into v_row;
  update public.proposals
  set status = p_input->>'decision',
      revision = revision + 1,
      updated_at = now()
  where id = v_proposal_id;
  update public.rooms
  set revision = revision + 1,
      updated_at = now()
  where id = v_room_id;

  v_activity_seq := relay_private.record_activity(
    v_room_id, 'proposal_decided', v_row.id::text, v_actor, v_client_key
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_proposal_decision(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'decide_proposal', v_client_key, v_request, v_response
  );
end;
$$;

create function public.create_action_brief(
  p_decision_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room_id uuid;
  v_client_key text;
  v_request jsonb;
  v_response jsonb;
  v_decision public.proposal_decisions%rowtype;
  v_row public.action_briefs%rowtype;
  v_allowed_files text[];
  v_acceptance_commands text[];
  v_forbidden_actions text[];
  v_approved_context text[];
  v_path text;
  v_text text;
  v_activity_seq bigint;
begin
  perform relay_private.assert_json_keys(
    p_input,
    array['roomId', 'title', 'objective', 'baselineSha', 'allowedFiles', 'acceptanceCommands', 'forbiddenActions', 'approvedContext', 'clientMutationId'],
    'action brief input'
  );
  v_room_id := (p_input->>'roomId')::uuid;
  v_client_key := p_input->>'clientMutationId';
  perform relay_private.assert_client_key(v_client_key, 'clientMutationId');
  if v_actor is null or not relay_private.is_room_owner(v_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  v_request := jsonb_build_object('decisionId', p_decision_id, 'input', p_input);
  v_response := relay_private.acquire_receipt(v_actor, 'create_action_brief', v_client_key, v_request);
  if v_response is not null then
    return v_response;
  end if;
  if not exists (select 1 from public.rooms where id = v_room_id and status = 'open') then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  select * into v_decision
  from public.proposal_decisions
  where id = p_decision_id and room_id = v_room_id;
  if not found or v_decision.decision <> 'accepted' then
    raise exception using errcode = '22023', message = 'accepted_owner_decision_required';
  end if;
  if char_length(coalesce(p_input->>'title', '')) not between 1 and 200
    or char_length(coalesce(p_input->>'objective', '')) not between 1 and 6000
    or coalesce(p_input->>'baselineSha', '') !~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  then
    raise exception using errcode = '22023', message = 'invalid_action_brief';
  end if;
  perform relay_private.assert_safe_shared_text(p_input->>'title', 'action brief title');
  perform relay_private.assert_safe_shared_text(p_input->>'objective', 'action brief objective');

  v_allowed_files := relay_private.jsonb_text_array(p_input->'allowedFiles', 'allowedFiles', 50, false);
  v_acceptance_commands := relay_private.jsonb_text_array(p_input->'acceptanceCommands', 'acceptanceCommands', 30, false);
  v_forbidden_actions := relay_private.jsonb_text_array(coalesce(p_input->'forbiddenActions', '[]'::jsonb), 'forbiddenActions', 30, true);
  v_approved_context := relay_private.jsonb_text_array(coalesce(p_input->'approvedContext', '[]'::jsonb), 'approvedContext', 20, true);
  if octet_length(array_to_string(v_approved_context, E'\n')) > 12000 then
    raise exception using errcode = '22023', message = 'approvedContext exceeds the 12 KB boundary';
  end if;
  foreach v_path in array v_allowed_files loop
    if v_path ~ '^/' or v_path ~ '(^|/)\.\.(/|$)' or position(E'\\' in v_path) > 0 then
      raise exception using errcode = '22023', message = 'allowedFiles must contain relative repository paths';
    end if;
  end loop;
  foreach v_text in array (
    v_allowed_files || v_acceptance_commands || v_forbidden_actions || v_approved_context
  ) loop
    perform relay_private.assert_safe_shared_text(v_text, 'action brief field');
  end loop;

  if exists (select 1 from public.action_briefs where decision_id = p_decision_id) then
    raise exception using errcode = '55000', message = 'decision_already_has_action_brief';
  end if;

  insert into public.action_briefs(
    room_id, decision_id, title, objective, baseline_sha, allowed_files,
    acceptance_commands, forbidden_actions, approved_context,
    created_by, client_mutation_id
  ) values (
    v_room_id,
    p_decision_id,
    p_input->>'title',
    p_input->>'objective',
    p_input->>'baselineSha',
    v_allowed_files,
    v_acceptance_commands,
    v_forbidden_actions,
    v_approved_context,
    v_actor,
    v_client_key
  ) returning * into v_row;
  v_activity_seq := relay_private.record_activity(
    v_room_id, 'action_brief_created', v_row.id::text, v_actor, v_client_key
  );
  v_response := jsonb_build_object(
    'value', relay_private.format_action_brief(v_row),
    'activitySeq', v_activity_seq
  );
  return relay_private.store_receipt(
    v_actor, 'create_action_brief', v_client_key, v_request, v_response
  );
end;
$$;

revoke all on function public.upsert_team_graph_item(jsonb, bigint) from public, anon;
revoke all on function public.save_layout_item(jsonb, bigint) from public, anon;
revoke all on function public.set_node_stance(jsonb) from public, anon;
revoke all on function public.submit_proposal(jsonb) from public, anon;
revoke all on function public.append_proposal_comment(jsonb, text) from public, anon;
revoke all on function public.decide_proposal(jsonb, bigint) from public, anon;
revoke all on function public.create_action_brief(uuid, jsonb) from public, anon;
grant execute on function public.upsert_team_graph_item(jsonb, bigint) to authenticated;
grant execute on function public.save_layout_item(jsonb, bigint) to authenticated;
grant execute on function public.set_node_stance(jsonb) to authenticated;
grant execute on function public.submit_proposal(jsonb) to authenticated;
grant execute on function public.append_proposal_comment(jsonb, text) to authenticated;
grant execute on function public.decide_proposal(jsonb, bigint) to authenticated;
grant execute on function public.create_action_brief(uuid, jsonb) to authenticated;

commit;
