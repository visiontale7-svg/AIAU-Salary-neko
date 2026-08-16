begin;

alter table public.room_members
  add column color_key text;

with ranked_members as (
  select
    member.room_id,
    member.user_id,
    row_number() over (
      partition by member.room_id
      order by member.joined_at, member.user_id
    ) - 1 as color_slot
  from public.room_members member
)
update public.room_members member
set color_key = 'member-' || ranked.color_slot::text
from ranked_members ranked
where ranked.room_id = member.room_id
  and ranked.user_id = member.user_id;

alter table public.room_members
  alter column color_key set not null,
  add constraint room_members_color_key_format
    check (color_key ~ '^member-[0-9]+$'),
  add constraint room_members_room_color_key_unique
    unique (room_id, color_key);

create function relay_private.assign_room_member_color_key()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_slot bigint;
begin
  -- Room joins can happen concurrently. Serialize only assignments for the
  -- same room, then allocate a durable monotonic slot that is never derived
  -- from ephemeral Presence order.
  perform pg_advisory_xact_lock(hashtextextended(new.room_id::text, 20260816));

  select coalesce(max(substring(member.color_key from 8)::bigint), -1) + 1
  into v_slot
  from public.room_members member
  where member.room_id = new.room_id;

  new.color_key := 'member-' || v_slot::text;
  return new;
end;
$$;

revoke all on function relay_private.assign_room_member_color_key() from public, anon, authenticated;

create trigger room_members_assign_color_key
before insert on public.room_members
for each row execute function relay_private.assign_room_member_color_key();

-- Keep the member directory in the same statement snapshot as the room,
-- current atlas version, collaboration rows, and activity watermark.
create or replace function public.get_room_bundle(p_room_id uuid)
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
    'members', coalesce((
      select jsonb_agg(to_jsonb(room_member) order by room_member.joined_at, room_member.user_id)
      from public.room_members room_member
      where room_member.room_id = room.id
    ), '[]'::jsonb),
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
      select jsonb_agg(to_jsonb(stance_row) order by stance_row.node_id, stance_row.user_id)
      from public.node_stances stance_row
      where stance_row.room_id = room.id
        and stance_row.atlas_version_id = room.current_version_id
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
      select jsonb_agg(to_jsonb(decision_row) order by decision_row.decided_at, decision_row.id)
      from public.proposal_decisions decision_row
      join public.proposals proposal
        on proposal.room_id = decision_row.room_id and proposal.id = decision_row.proposal_id
      where decision_row.room_id = room.id
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

commit;
