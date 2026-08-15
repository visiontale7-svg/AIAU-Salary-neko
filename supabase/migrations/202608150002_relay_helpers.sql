begin;

create function relay_private.assert_json_keys(
  p_value jsonb,
  p_allowed text[],
  p_context text
)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_unexpected text;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception using errcode = '22023', message = p_context || ' must be an object';
  end if;

  select string_agg(keys.key, ', ' order by keys.key)
    into v_unexpected
  from jsonb_object_keys(p_value) as keys(key)
  where not (keys.key = any(p_allowed));

  if v_unexpected is not null then
    raise exception using
      errcode = '22023',
      message = p_context || ' contains unsupported keys: ' || v_unexpected;
  end if;
end;
$$;

create function relay_private.assert_client_key(p_value text, p_context text)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value is null
    or char_length(p_value) not between 8 and 160
    or p_value !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
  then
    raise exception using
      errcode = '22023',
      message = p_context || ' must be an opaque 8-160 character client key';
  end if;
end;
$$;

create function relay_private.assert_safe_shared_text(p_value text, p_context text)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value is null
    or translate(p_value, E'\n\t', '') ~ '[[:cntrl:]]'
    or p_value ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    or p_value ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    or p_value ~ $path$(^|[[:space:]"'`(])/[[:alnum:]_.~+-]+(/[[:alnum:]_.~+-]+)*$path$
    or position(E':\\' in p_value) > 0
    or p_value ~ E'\\\\\\\\[^\\\\[:space:]<>:"|?*]+\\\\[^\\\\[:space:]<>:"|?*]+'
    or p_value ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=][[:space:]]*[^[:space:],;]{8,})'
  then
    raise exception using errcode = '22023', message = p_context || ' contains unsafe shared content';
  end if;
end;
$$;

create function relay_private.assert_relay_package(p_package jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_graph jsonb;
  v_item jsonb;
  v_point jsonb;
  v_id text;
  v_key text;
  v_node_ids text[] := '{}';
  v_edge_ids text[] := '{}';
  v_mode_ids text[] := '{}';
  v_evidence_ids text[] := '{}';
  v_referenced_evidence text[] := '{}';
  v_reference text;
begin
  perform relay_private.assert_json_keys(
    p_package,
    array['schemaVersion', 'packageId', 'clientPublishId', 'title', 'publishedAt', 'graph', 'evidence'],
    'package'
  );

  if p_package->>'schemaVersion' is distinct from 'relay-v1' then
    raise exception using errcode = '22023', message = 'package.schemaVersion must be relay-v1';
  end if;
  if char_length(coalesce(p_package->>'packageId', '')) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'package.packageId is invalid';
  end if;
  perform relay_private.assert_client_key(p_package->>'clientPublishId', 'package.clientPublishId');
  if char_length(coalesce(p_package->>'title', '')) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'package.title is invalid';
  end if;
  if jsonb_typeof(p_package->'publishedAt') is distinct from 'string'
    or char_length(p_package->>'publishedAt') not between 20 and 40
  then
    raise exception using errcode = '22023', message = 'package.publishedAt must be RFC3339';
  end if;
  begin
    perform (p_package->>'publishedAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'package.publishedAt must be RFC3339';
  end;

  if pg_column_size(p_package) > 1048576 then
    raise exception using errcode = '54000', message = 'package exceeds the 1 MiB Relay limit';
  end if;

  -- Match the contract privacy canaries server-side. Exact object-key allowlists
  -- below also reject private snapshot-shaped fields at every graph level.
  if p_package::text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' then
    raise exception using errcode = '22023', message = 'package contains an email address';
  end if;
  if p_package::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
    raise exception using errcode = '22023', message = 'package contains a UUID';
  end if;
  if p_package::text ~ $path$(^|[[:space:]"'`(])/[[:alnum:]_.~+-]+(/[[:alnum:]_.~+-]+)*$path$ then
    raise exception using errcode = '22023', message = 'package contains an absolute path';
  end if;
  if position(E':\\\\' in p_package::text) > 0 then
    raise exception using errcode = '22023', message = 'package contains a Windows path';
  end if;
  if p_package::text ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=][[:space:]]*[^[:space:],;]{8,})' then
    raise exception using errcode = '22023', message = 'package contains a secret-like value';
  end if;

  v_graph := p_package->'graph';
  perform relay_private.assert_json_keys(
    v_graph,
    array['nodes', 'edges', 'modes', 'layout', 'viewport'],
    'package.graph'
  );
  if jsonb_typeof(v_graph->'nodes') is distinct from 'array'
    or jsonb_array_length(v_graph->'nodes') not between 1 and 120
  then
    raise exception using errcode = '22023', message = 'package.graph.nodes must contain 1-120 nodes';
  end if;
  if jsonb_typeof(v_graph->'edges') is distinct from 'array'
    or jsonb_typeof(v_graph->'modes') is distinct from 'array'
    or jsonb_typeof(v_graph->'layout') is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'package graph collections have invalid types';
  end if;

  for v_item in select value from jsonb_array_elements(v_graph->'nodes') loop
    perform relay_private.assert_json_keys(
      v_item,
      array['id', 'origin', 'label', 'kind', 'speaker', 'acts', 'modeIds', 'evidenceIds', 'importance', 'primary'],
      'package.graph.nodes[]'
    );
    v_id := v_item->>'id';
    if v_id !~ '^n[0-9]{3,}$' or v_id = any(v_node_ids) then
      raise exception using errcode = '22023', message = 'package contains an invalid or duplicate node id';
    end if;
    if v_item->>'origin' is distinct from 'source'
      or coalesce(v_item->>'kind', '') not in ('anchor', 'claim', 'evidence', 'decision', 'action', 'note')
      or char_length(coalesce(v_item->>'label', '')) not between 1 and 2000
      or jsonb_typeof(v_item->'acts') is distinct from 'array'
      or jsonb_typeof(v_item->'modeIds') is distinct from 'array'
      or jsonb_typeof(v_item->'evidenceIds') is distinct from 'array'
      or jsonb_typeof(v_item->'importance') is distinct from 'number'
      or (v_item->>'importance')::numeric not between 0 and 1
      or jsonb_typeof(v_item->'primary') is distinct from 'boolean'
      or (v_item ? 'speaker' and coalesce(v_item->>'speaker', '') not in ('user', 'assistant'))
    then
      raise exception using errcode = '22023', message = 'package contains an invalid source node';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_item->'acts') as act(value)
      where jsonb_typeof(act.value) <> 'string'
    ) then
      raise exception using errcode = '22023', message = 'node acts must be strings';
    end if;
    v_node_ids := array_append(v_node_ids, v_id);
  end loop;

  for v_item in select value from jsonb_array_elements(v_graph->'edges') loop
    perform relay_private.assert_json_keys(
      v_item,
      array['id', 'origin', 'source', 'target', 'type', 'label', 'evidenceIds'],
      'package.graph.edges[]'
    );
    v_id := v_item->>'id';
    if v_id !~ '^r[0-9]{3,}$' or v_id = any(v_edge_ids) then
      raise exception using errcode = '22023', message = 'package contains an invalid or duplicate edge id';
    end if;
    if coalesce(v_item->>'origin', '') not in ('source', 'accepted_proposal')
      or not (coalesce(v_item->>'source', '') = any(v_node_ids))
      or not (coalesce(v_item->>'target', '') = any(v_node_ids))
      or char_length(coalesce(v_item->>'type', '')) not between 1 and 120
      or char_length(coalesce(v_item->>'label', '')) > 1000
      or jsonb_typeof(v_item->'evidenceIds') is distinct from 'array'
    then
      raise exception using errcode = '22023', message = 'package contains an invalid or dangling source edge';
    end if;
    v_edge_ids := array_append(v_edge_ids, v_id);
  end loop;

  for v_item in select value from jsonb_array_elements(v_graph->'modes') loop
    perform relay_private.assert_json_keys(
      v_item,
      array['id', 'kind', 'label', 'color', 'memberNodeIds'],
      'package.graph.modes[]'
    );
    v_id := v_item->>'id';
    if v_id !~ '^m[0-9]{3,}$' or v_id = any(v_mode_ids)
      or char_length(coalesce(v_item->>'kind', '')) not between 1 and 120
      or char_length(coalesce(v_item->>'label', '')) not between 1 and 300
      or char_length(coalesce(v_item->>'color', '')) not between 1 and 40
      or jsonb_typeof(v_item->'memberNodeIds') is distinct from 'array'
      or jsonb_array_length(v_item->'memberNodeIds') = 0
    then
      raise exception using errcode = '22023', message = 'package contains an invalid or duplicate mode';
    end if;
    for v_reference in select value #>> '{}' from jsonb_array_elements(v_item->'memberNodeIds') loop
      if not (v_reference = any(v_node_ids)) then
        raise exception using errcode = '22023', message = 'package mode references a missing node';
      end if;
    end loop;
    v_mode_ids := array_append(v_mode_ids, v_id);
  end loop;

  for v_item in select value from jsonb_array_elements(v_graph->'nodes') loop
    for v_reference in select value #>> '{}' from jsonb_array_elements(v_item->'modeIds') loop
      if not (v_reference = any(v_mode_ids)) then
        raise exception using errcode = '22023', message = 'package node references a missing mode';
      end if;
    end loop;
    for v_reference in select value #>> '{}' from jsonb_array_elements(v_item->'evidenceIds') loop
      v_referenced_evidence := array_append(v_referenced_evidence, v_reference);
    end loop;
  end loop;
  for v_item in select value from jsonb_array_elements(v_graph->'edges') loop
    for v_reference in select value #>> '{}' from jsonb_array_elements(v_item->'evidenceIds') loop
      v_referenced_evidence := array_append(v_referenced_evidence, v_reference);
    end loop;
  end loop;

  for v_key, v_point in select key, value from jsonb_each(v_graph->'layout') loop
    perform relay_private.assert_json_keys(v_point, array['x', 'y'], 'package.graph.layout point');
    if not (v_key = any(v_node_ids))
      or jsonb_typeof(v_point->'x') is distinct from 'number'
      or jsonb_typeof(v_point->'y') is distinct from 'number'
      or abs((v_point->>'x')::numeric) > 10000000
      or abs((v_point->>'y')::numeric) > 10000000
    then
      raise exception using errcode = '22023', message = 'package contains an invalid layout point';
    end if;
  end loop;
  foreach v_id in array v_node_ids loop
    if not ((v_graph->'layout') ? v_id) then
      raise exception using errcode = '22023', message = 'package layout is missing a source node';
    end if;
  end loop;

  if v_graph ? 'viewport' then
    perform relay_private.assert_json_keys(v_graph->'viewport', array['x', 'y', 'zoom'], 'package.graph.viewport');
    if jsonb_typeof(v_graph->'viewport'->'x') is distinct from 'number'
      or jsonb_typeof(v_graph->'viewport'->'y') is distinct from 'number'
      or jsonb_typeof(v_graph->'viewport'->'zoom') is distinct from 'number'
      or (v_graph->'viewport'->>'zoom')::numeric <= 0
    then
      raise exception using errcode = '22023', message = 'package viewport is invalid';
    end if;
  end if;

  if jsonb_typeof(p_package->'evidence') is distinct from 'object' then
    raise exception using errcode = '22023', message = 'package.evidence must be an object';
  end if;
  for v_key, v_item in select key, value from jsonb_each(p_package->'evidence') loop
    perform relay_private.assert_json_keys(v_item, array['excerpt', 'speaker'], 'package.evidence entry');
    if v_key !~ '^e[0-9]{3,}$' or v_key = any(v_evidence_ids)
      or char_length(coalesce(v_item->>'excerpt', '')) not between 1 and 4000
      or (v_item ? 'speaker' and coalesce(v_item->>'speaker', '') not in ('user', 'assistant'))
    then
      raise exception using errcode = '22023', message = 'package contains invalid evidence';
    end if;
    v_evidence_ids := array_append(v_evidence_ids, v_key);
  end loop;
  foreach v_reference in array v_referenced_evidence loop
    if not (v_reference = any(v_evidence_ids)) then
      raise exception using errcode = '22023', message = 'package references missing evidence';
    end if;
  end loop;
  foreach v_id in array v_evidence_ids loop
    if not (v_id = any(v_referenced_evidence)) then
      raise exception using errcode = '22023', message = 'package contains unreferenced evidence';
    end if;
  end loop;
end;
$$;

create function relay_private.acquire_receipt(
  p_actor_id uuid,
  p_operation text,
  p_client_mutation_id text,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, relay_private, extensions
as $$
declare
  v_expected bytea := extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256');
  v_receipt relay_private.mutation_receipts%rowtype;
begin
  perform relay_private.assert_client_key(p_client_mutation_id, 'client mutation id');
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_id::text || ':' || p_operation || ':' || p_client_mutation_id, 0)
  );
  select * into v_receipt
  from relay_private.mutation_receipts
  where actor_id = p_actor_id
    and operation = p_operation
    and client_mutation_id = p_client_mutation_id;
  if not found then
    return null;
  end if;
  if v_receipt.request_sha256 <> v_expected then
    raise exception using errcode = '22023', message = 'idempotency_key_reused_with_different_input';
  end if;
  return v_receipt.response;
end;
$$;

create function relay_private.store_receipt(
  p_actor_id uuid,
  p_operation text,
  p_client_mutation_id text,
  p_request jsonb,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, relay_private, extensions
as $$
begin
  insert into relay_private.mutation_receipts(
    actor_id, operation, client_mutation_id, request_sha256, response
  ) values (
    p_actor_id,
    p_operation,
    p_client_mutation_id,
    extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'),
    p_response
  );
  return p_response;
end;
$$;

create function relay_private.record_activity(
  p_room_id uuid,
  p_event_type text,
  p_target_id text,
  p_actor_id uuid,
  p_client_mutation_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seq bigint;
begin
  insert into public.activity_events(
    room_id, event_type, target_id, actor_id, client_mutation_id
  ) values (
    p_room_id, p_event_type, p_target_id, p_actor_id, p_client_mutation_id
  )
  on conflict (room_id, client_mutation_id, event_type)
    where client_mutation_id is not null
  do nothing
  returning seq into v_seq;

  if v_seq is null and p_client_mutation_id is not null then
    select seq into v_seq
    from public.activity_events
    where room_id = p_room_id
      and event_type = p_event_type
      and client_mutation_id = p_client_mutation_id;
  end if;
  return v_seq;
end;
$$;

create function relay_private.current_version_id(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select current_version_id from public.rooms where id = p_room_id;
$$;

create function relay_private.source_node_exists(p_room_id uuid, p_node_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.rooms room
    join public.atlas_versions version on version.id = room.current_version_id
    cross join lateral jsonb_array_elements(version.package->'graph'->'nodes') as node(value)
    where room.id = p_room_id and node.value->>'id' = p_node_id
  );
$$;

create function relay_private.source_edge_exists(p_room_id uuid, p_edge_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.rooms room
    join public.atlas_versions version on version.id = room.current_version_id
    cross join lateral jsonb_array_elements(version.package->'graph'->'edges') as edge(value)
    where room.id = p_room_id and edge.value->>'id' = p_edge_id
  );
$$;

create function relay_private.graph_node_exists(p_room_id uuid, p_node_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, relay_private
as $$
  select relay_private.source_node_exists(p_room_id, p_node_id)
    or exists (
      select 1 from public.team_graph_items
      where room_id = p_room_id
        and atlas_version_id = relay_private.current_version_id(p_room_id)
        and item_id = p_node_id
        and item_type = 'node'
    );
$$;

create function relay_private.proposal_target_exists(
  p_room_id uuid,
  p_target_type text,
  p_target_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, relay_private
as $$
begin
  if p_target_type = 'source_node' then
    return relay_private.source_node_exists(p_room_id, p_target_id);
  elsif p_target_type = 'source_edge' then
    return relay_private.source_edge_exists(p_room_id, p_target_id);
  elsif p_target_type = 'team_node' then
    return exists (
      select 1 from public.team_graph_items
      where room_id = p_room_id
        and atlas_version_id = relay_private.current_version_id(p_room_id)
        and item_id = p_target_id
        and item_type = 'node'
    );
  elsif p_target_type = 'team_edge' then
    return exists (
      select 1 from public.team_graph_items
      where room_id = p_room_id
        and atlas_version_id = relay_private.current_version_id(p_room_id)
        and item_id = p_target_id
        and item_type = 'edge'
    );
  end if;
  return false;
end;
$$;

create function relay_private.assert_proposal_value(
  p_room_id uuid,
  p_target_type text,
  p_operation text,
  p_value jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, relay_private
as $$
declare
  v_text text;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'proposedValue must be an object';
  end if;
  if p_operation = 'replace_label' then
    perform relay_private.assert_json_keys(p_value, array['value', 'label'], 'replace_label value');
    if (p_value ? 'value') = (p_value ? 'label') then
      raise exception using errcode = '22023', message = 'replace_label requires exactly one value';
    end if;
    v_text := coalesce(p_value->>'value', p_value->>'label');
    if char_length(coalesce(v_text, '')) not between 1 and 2000 then
      raise exception using errcode = '22023', message = 'invalid replacement label';
    end if;
  elsif p_operation = 'reclassify' then
    if p_target_type in ('source_node', 'team_node') then
      perform relay_private.assert_json_keys(p_value, array['value', 'kind'], 'node reclassify value');
      if (p_value ? 'value') = (p_value ? 'kind')
        or coalesce(p_value->>'value', p_value->>'kind', '') not in (
          'anchor', 'claim', 'evidence', 'decision', 'action', 'note'
        )
      then
        raise exception using errcode = '22023', message = 'invalid node reclassification';
      end if;
    elsif p_target_type in ('source_edge', 'team_edge') then
      perform relay_private.assert_json_keys(p_value, array['value', 'type'], 'edge reclassify value');
      if (p_value ? 'value') = (p_value ? 'type')
        or char_length(coalesce(p_value->>'value', p_value->>'type', '')) not between 1 and 120
      then
        raise exception using errcode = '22023', message = 'invalid edge reclassification';
      end if;
    else
      raise exception using errcode = '22023', message = 'invalid reclassify target';
    end if;
  elsif p_operation = 'replace_relation' then
    if p_target_type not in ('source_edge', 'team_edge') then
      raise exception using errcode = '22023', message = 'replace_relation requires an edge';
    end if;
    perform relay_private.assert_json_keys(
      p_value,
      array['source', 'target', 'type', 'relation', 'label', 'value'],
      'replace_relation value'
    );
    if jsonb_object_length(p_value) = 0
      or ((p_value ? 'type') and (p_value ? 'relation'))
      or ((p_value ? 'label') and (p_value ? 'value'))
      or (p_value ? 'source' and not relay_private.graph_node_exists(p_room_id, p_value->>'source'))
      or (p_value ? 'target' and not relay_private.graph_node_exists(p_room_id, p_value->>'target'))
      or (p_value ? 'type' and char_length(coalesce(p_value->>'type', '')) not between 1 and 120)
      or (p_value ? 'relation' and char_length(coalesce(p_value->>'relation', '')) not between 1 and 120)
      or (p_value ? 'label' and char_length(coalesce(p_value->>'label', '')) not between 1 and 1000)
      or (p_value ? 'value' and char_length(coalesce(p_value->>'value', '')) not between 1 and 1000)
    then
      raise exception using errcode = '22023', message = 'invalid or dangling relation replacement';
    end if;
  elsif p_operation = 'remove' then
    perform relay_private.assert_json_keys(p_value, array['remove'], 'remove value');
    if jsonb_object_length(p_value) > 1
      or (p_value ? 'remove' and p_value->'remove' <> 'true'::jsonb)
    then
      raise exception using errcode = '22023', message = 'invalid remove value';
    end if;
  else
    raise exception using errcode = '22023', message = 'invalid proposal operation';
  end if;
end;
$$;

create function relay_private.format_layout_item(p_row public.room_layout_items)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'roomId', p_row.room_id,
    'nodeId', p_row.node_id,
    'x', p_row.x,
    'y', p_row.y,
    'revision', p_row.revision,
    'updatedBy', p_row.updated_by
  );
$$;

create function relay_private.format_team_graph_item(p_row public.team_graph_items)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select p_row.payload || jsonb_build_object(
    'itemType', p_row.item_type,
    'id', p_row.item_id,
    'roomId', p_row.room_id,
    'revision', p_row.revision,
    'createdBy', p_row.created_by
  );
$$;

create function relay_private.format_node_stance(p_row public.node_stances)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'roomId', p_row.room_id,
    'nodeId', p_row.node_id,
    'userId', p_row.user_id,
    'stance', p_row.stance,
    'updatedAt', p_row.updated_at
  );
$$;

create function relay_private.format_proposal(p_row public.proposals)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'roomId', p_row.room_id,
    'targetType', p_row.target_type,
    'targetId', p_row.target_id,
    'operation', p_row.operation,
    'proposedValue', p_row.proposed_value,
    'rationale', p_row.rationale,
    'status', p_row.status,
    'revision', p_row.revision,
    'createdBy', p_row.created_by,
    'createdAt', p_row.created_at
  );
$$;

create function relay_private.format_proposal_comment(p_row public.proposal_comments)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'roomId', p_row.room_id,
    'proposalId', p_row.proposal_id,
    'body', p_row.body,
    'createdBy', p_row.created_by,
    'createdAt', p_row.created_at,
    'clientMutationId', p_row.client_mutation_id
  );
$$;

create function relay_private.format_proposal_decision(p_row public.proposal_decisions)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'roomId', p_row.room_id,
    'proposalId', p_row.proposal_id,
    'decision', p_row.decision,
    'rationale', p_row.rationale,
    'decidedBy', p_row.decided_by,
    'decidedAt', p_row.decided_at
  );
$$;

create function relay_private.format_action_brief(p_row public.action_briefs)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', p_row.id,
    'roomId', p_row.room_id,
    'decisionId', p_row.decision_id,
    'title', p_row.title,
    'objective', p_row.objective,
    'baselineSha', p_row.baseline_sha,
    'allowedFiles', to_jsonb(p_row.allowed_files),
    'acceptanceCommands', to_jsonb(p_row.acceptance_commands),
    'forbiddenActions', to_jsonb(p_row.forbidden_actions),
    'approvedContext', to_jsonb(p_row.approved_context),
    'createdBy', p_row.created_by,
    'createdAt', p_row.created_at
  );
$$;

create function relay_private.format_devin_run(p_row public.devin_runs)
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
    'updatedAt', p_row.updated_at
  ));
$$;

create function relay_private.jsonb_text_array(
  p_value jsonb,
  p_context text,
  p_max_items integer,
  p_allow_empty boolean default true
)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_result text[];
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    raise exception using errcode = '22023', message = p_context || ' must be an array';
  end if;
  if jsonb_array_length(p_value) > p_max_items
    or (not p_allow_empty and jsonb_array_length(p_value) = 0)
  then
    raise exception using errcode = '22023', message = p_context || ' has an invalid item count';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value) as item(value)
    where jsonb_typeof(item.value) <> 'string'
      or char_length(item.value #>> '{}') not between 1 and 1000
  ) then
    raise exception using errcode = '22023', message = p_context || ' must contain bounded strings';
  end if;
  select coalesce(array_agg(item.value #>> '{}' order by item.ordinality), '{}')
    into v_result
  from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);
  return v_result;
end;
$$;

create function relay_private.create_invite(
  p_room_id uuid,
  p_actor_id uuid,
  p_config jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_invite public.room_invites%rowtype;
  v_token text;
  v_expires_at timestamptz;
  v_max_uses integer;
  v_request_sha256 bytea;
begin
  perform relay_private.assert_json_keys(coalesce(p_config, '{}'::jsonb), array['expiresAt', 'maxUses'], 'inviteConfig');
  v_expires_at := coalesce((p_config->>'expiresAt')::timestamptz, now() + interval '24 hours');
  v_max_uses := coalesce((p_config->>'maxUses')::integer, 1);
  v_request_sha256 := extensions.digest(
    convert_to(coalesce(p_config, '{}'::jsonb)::text, 'UTF8'),
    'sha256'
  );
  if p_idempotency_key is not null then
    perform relay_private.assert_client_key(p_idempotency_key, 'invite idempotency key');
  end if;
  if v_expires_at < now() + interval '5 minutes'
    or v_expires_at > now() + interval '7 days'
    or v_max_uses not between 1 and 50
  then
    raise exception using errcode = '22023', message = 'inviteConfig is outside the allowed lifetime or use count';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  if p_idempotency_key is not null then
    select * into v_invite
    from public.room_invites
    where created_by = p_actor_id and idempotency_key = p_idempotency_key
    for update;
    if found then
      if v_invite.room_id <> p_room_id or v_invite.request_sha256 <> v_request_sha256 then
        raise exception using errcode = '22023', message = 'invite_idempotency_key_reused_with_different_input';
      end if;
      update public.room_invites
      set token_hash = extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
          expires_at = v_expires_at,
          max_uses = v_max_uses,
          use_count = 0,
          revoked_at = null
      where id = v_invite.id
      returning * into v_invite;
      return jsonb_build_object(
        'inviteId', v_invite.id,
        'inviteToken', v_token,
        'expiresAt', v_invite.expires_at,
        'maxUses', v_invite.max_uses
      );
    end if;
  end if;

  insert into public.room_invites(
    room_id, token_hash, created_by, idempotency_key, request_sha256, expires_at, max_uses
  )
  values (
    p_room_id,
    extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
    p_actor_id,
    p_idempotency_key,
    case when p_idempotency_key is null then null else v_request_sha256 end,
    v_expires_at,
    v_max_uses
  )
  returning * into v_invite;

  return jsonb_build_object(
    'inviteId', v_invite.id,
    'inviteToken', v_token,
    'expiresAt', v_invite.expires_at,
    'maxUses', v_invite.max_uses
  );
end;
$$;

revoke all on all functions in schema relay_private from public, anon, authenticated;
grant execute on function relay_private.is_room_member(uuid) to authenticated;
grant execute on function relay_private.is_room_owner(uuid) to authenticated;

commit;
