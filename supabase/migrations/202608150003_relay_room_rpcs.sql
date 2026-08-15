begin;

create function public.create_room_with_package(
  p_package jsonb,
  p_invite_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_hash bytea;
  v_room public.rooms%rowtype;
  v_version public.atlas_versions%rowtype;
  v_invite jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  perform relay_private.assert_relay_package(p_package);
  v_hash := extensions.digest(convert_to(p_package::text, 'UTF8'), 'sha256');
  perform pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':publish:' || (p_package->>'clientPublishId'), 0)
  );

  select * into v_version
  from public.atlas_versions
  where published_by = v_actor
    and client_publish_id = p_package->>'clientPublishId';

  if found then
    if v_version.package_sha256 <> v_hash then
      raise exception using errcode = '22023', message = 'client_publish_id_reused_with_different_package';
    end if;
    select * into strict v_room from public.rooms where id = v_version.room_id;
    if v_room.owner_id <> v_actor then
      raise exception using errcode = '42501', message = 'owner_required';
    end if;
    -- Rotate the hash on the original invitation row. A retry creates no
    -- duplicate record and invalidates the prior bearer without persisting it.
    v_invite := relay_private.create_invite(
      v_room.id,
      v_actor,
      coalesce(p_invite_config, '{}'::jsonb),
      p_package->>'clientPublishId'
    );
    return jsonb_build_object(
      'roomId', v_room.id,
      'inviteToken', v_invite->>'inviteToken'
    );
  end if;

  -- Serialize all room creation for this identity, not just one publish key.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':room-create', 0));
  if (select count(*) from public.rooms where owner_id = v_actor) >= 20 then
    raise exception using errcode = '54000', message = 'room_quota_exhausted';
  end if;

  insert into public.rooms(owner_id, title)
  values (v_actor, p_package->>'title')
  returning * into v_room;

  insert into public.room_members(room_id, user_id, display_name, role)
  values (v_room.id, v_actor, 'Owner', 'owner');

  insert into public.atlas_versions(
    room_id,
    version,
    package_id,
    client_publish_id,
    package_sha256,
    package,
    published_by
  ) values (
    v_room.id,
    1,
    p_package->>'packageId',
    p_package->>'clientPublishId',
    v_hash,
    p_package,
    v_actor
  )
  returning * into v_version;

  update public.rooms
  set current_version_id = v_version.id,
      updated_at = now()
  where id = v_room.id;

  perform relay_private.record_activity(
    v_room.id,
    'room_created',
    v_version.id::text,
    v_actor,
    p_package->>'clientPublishId'
  );
  v_invite := relay_private.create_invite(
    v_room.id,
    v_actor,
    coalesce(p_invite_config, '{}'::jsonb),
    p_package->>'clientPublishId'
  );

  return jsonb_build_object(
    'roomId', v_room.id,
    'inviteToken', v_invite->>'inviteToken'
  );
end;
$$;

create function public.publish_atlas_version(
  p_room_id uuid,
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_hash bytea;
  v_room public.rooms%rowtype;
  v_version public.atlas_versions%rowtype;
  v_activity_seq bigint;
  v_next_version integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  perform relay_private.assert_relay_package(p_package);
  v_hash := extensions.digest(convert_to(p_package::text, 'UTF8'), 'sha256');
  perform pg_advisory_xact_lock(
    hashtextextended(v_actor::text || ':publish:' || (p_package->>'clientPublishId'), 0)
  );

  select * into v_version
  from public.atlas_versions
  where published_by = v_actor
    and client_publish_id = p_package->>'clientPublishId';
  if found then
    if v_version.room_id <> p_room_id or v_version.package_sha256 <> v_hash then
      raise exception using errcode = '22023', message = 'client_publish_id_reused_with_different_package';
    end if;
    select seq into v_activity_seq
    from public.activity_events
    where room_id = p_room_id
      and client_mutation_id = p_package->>'clientPublishId'
      and event_type = 'atlas_published';
    return jsonb_build_object(
      'atlasVersionId', v_version.id,
      'version', v_version.version,
      'activitySeq', v_activity_seq
    );
  end if;

  select * into v_room
  from public.rooms
  where id = p_room_id
  for update;
  if not found or v_room.owner_id <> v_actor then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  if v_room.status <> 'open' then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;

  -- Source IDs are version-local. Layout, team overlays, stances, and
  -- proposals all carry atlas_version_id, so n001/r001 may be regenerated by
  -- the local publisher without binding old discussion to new semantics.

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.atlas_versions
  where room_id = p_room_id;
  insert into public.atlas_versions(
    room_id,
    version,
    package_id,
    client_publish_id,
    package_sha256,
    package,
    published_by
  ) values (
    p_room_id,
    v_next_version,
    p_package->>'packageId',
    p_package->>'clientPublishId',
    v_hash,
    p_package,
    v_actor
  ) returning * into v_version;

  update public.rooms
  set current_version_id = v_version.id,
      revision = revision + 1,
      title = p_package->>'title',
      updated_at = now()
  where id = p_room_id;

  v_activity_seq := relay_private.record_activity(
    p_room_id,
    'atlas_published',
    v_version.id::text,
    v_actor,
    p_package->>'clientPublishId'
  );
  return jsonb_build_object(
    'atlasVersionId', v_version.id,
    'version', v_version.version,
    'activitySeq', v_activity_seq
  );
end;
$$;

create function public.create_room_invite(
  p_room_id uuid,
  p_invite_config jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  if not exists (select 1 from public.rooms where id = p_room_id and status = 'open') then
    raise exception using errcode = '55000', message = 'room_closed';
  end if;
  return relay_private.create_invite(p_room_id, v_actor, coalesce(p_invite_config, '{}'::jsonb));
end;
$$;

create function public.close_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
declare
  v_actor uuid := auth.uid();
  v_room public.rooms%rowtype;
  v_seq bigint;
begin
  if v_actor is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.status = 'closed' then
    select seq into v_seq
    from public.activity_events
    where room_id = p_room_id and event_type = 'room_closed'
    order by seq desc
    limit 1;
    return jsonb_build_object(
      'roomId', p_room_id,
      'revision', v_room.revision,
      'activitySeq', v_seq
    );
  end if;
  update public.rooms
  set status = 'closed', revision = revision + 1, updated_at = now()
  where id = p_room_id
  returning * into v_room;
  update public.room_invites set revoked_at = coalesce(revoked_at, now())
  where room_id = p_room_id;
  v_seq := relay_private.record_activity(p_room_id, 'room_closed', p_room_id::text, v_actor, null);
  return jsonb_build_object(
    'roomId', p_room_id,
    'revision', v_room.revision,
    'activitySeq', v_seq
  );
end;
$$;

create function public.revoke_room_invite(p_room_id uuid, p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private
as $$
begin
  if auth.uid() is null or not relay_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'owner_required';
  end if;
  update public.room_invites
  set revoked_at = coalesce(revoked_at, now())
  where id = p_invite_id and room_id = p_room_id;
  return found;
end;
$$;

create function public.join_room(p_invite_token text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, relay_private, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_invite public.room_invites%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_invite_token is null
    or char_length(p_invite_token) <> 43
    or p_invite_token !~ '^[A-Za-z0-9_-]{43}$'
    or char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80
  then
    raise exception using errcode = '22023', message = 'invalid_or_expired_invite';
  end if;

  select * into v_invite
  from public.room_invites
  where token_hash = extensions.digest(convert_to(p_invite_token, 'UTF8'), 'sha256')
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid_or_expired_invite';
  end if;

  -- A committed join whose HTTP response was lost is idempotently recoverable,
  -- even after a one-use invite reaches max_uses.
  if exists (
    select 1 from public.room_members
    where room_id = v_invite.room_id and user_id = v_actor
  ) then
    return jsonb_build_object('roomId', v_invite.room_id);
  end if;

  if v_invite.revoked_at is not null
    or v_invite.expires_at <= now()
    or v_invite.use_count >= v_invite.max_uses
    or not exists (
      select 1 from public.rooms
      where id = v_invite.room_id and status = 'open'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_or_expired_invite';
  end if;

  insert into public.room_members(room_id, user_id, display_name, role)
  values (v_invite.room_id, v_actor, btrim(p_display_name), 'member');
  update public.room_invites
  set use_count = use_count + 1
  where id = v_invite.id;
  perform relay_private.record_activity(
    v_invite.room_id,
    'member_joined',
    v_actor::text,
    v_actor,
    null
  );
  return jsonb_build_object('roomId', v_invite.room_id);
end;
$$;

revoke all on function public.create_room_with_package(jsonb, jsonb) from public, anon;
revoke all on function public.publish_atlas_version(uuid, jsonb) from public, anon;
revoke all on function public.create_room_invite(uuid, jsonb) from public, anon;
revoke all on function public.close_room(uuid) from public, anon;
revoke all on function public.revoke_room_invite(uuid, uuid) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
grant execute on function public.create_room_with_package(jsonb, jsonb) to authenticated;
grant execute on function public.publish_atlas_version(uuid, jsonb) to authenticated;
grant execute on function public.create_room_invite(uuid, jsonb) to authenticated;
grant execute on function public.close_room(uuid) to authenticated;
grant execute on function public.revoke_room_invite(uuid, uuid) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;

commit;
