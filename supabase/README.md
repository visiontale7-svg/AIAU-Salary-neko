# Dialogue Atlas Relay Supabase boundary

The ten numbered migrations define the Relay collaboration projection. Every
table in `public` has RLS enabled; authenticated non-members cannot read room
data, and clients receive SELECT only. Durable writes go through fixed
`search_path` security-definer RPCs. Raw transcripts, local identifiers, model
output, provider settings, invite plaintext, and credentials are outside the
schema.

Atlas packages are immutable. Mutable layout, team overlays, stances, and
proposals carry `atlas_version_id`, so regenerated IDs such as `n001` never bind
old discussion to a new package. The repository loads only current-version
state; old proposal/comment/decision rows remain member-readable history.

Room creation is capped at 20 rooms per authenticated identity and serialized
transactionally. The initial invitation is one idempotent row: a retry rotates
its 32-byte bearer hash and invalidates the earlier token without storing
plaintext or creating a duplicate record. Joining is recoverable after a lost
response, and closed rooms reject new invites, joins, collaboration writes,
ActionBriefs, Devin starts, and follow-ups.

Private Realtime channels are `room:<uuid>`. Direct client inserts are Presence
only. Focus/typing/drag events use `broadcast_relay_ephemeral`, which derives
`userId` from `auth.uid()`; durable activity triggers broadcast only sequence,
type, and target hints. Presence names and roles are untrusted client metadata;
the adapter decorates presence keys with durable names, roles, and stable color
identities from RLS-visible `room_members`, while the key itself remains
non-authoritative visual state. The atomic `get_room_bundle` result includes the
same member directory so team-item authors remain displayable while offline.
Clients replay `activity_events` as the source of truth.

The Devin boundary additionally requires an out-of-band private operator
entitlement and daily/ACU quotas. Provider-derived run status, PR URL, cursors,
and events are writable only by service-role RPCs; ordinary owners can reserve
a request and send an approved follow-up but cannot forge provider results.
Provider health and provider retry timing are stored independently from the
monotonic Session lifecycle, and a durable `Retry-After` blocks further calls
until its deadline. See
`functions/devin-relay/README.md` for configuration and revocation.

`seed.sql` is deliberately empty: it creates no fake auth user, demo room,
entitlement, or secret. Production must never install a shared demo operator.
Anonymous-signup/IP rate limits and abuse monitoring are deployment settings
outside these migrations and must be configured before public exposure.

Configured verification commands are:

```sh
npm run relay:supabase:up
npm run relay:supabase:reset
npm run relay:supabase:test
npm run relay:supabase:smoke
supabase functions serve devin-relay
```

On 2026-08-16 the local Docker stack was reset from an empty database, all ten
migrations applied successfully, and the 48-test pgTAP suite passed with no
schema diff. This is a
local verification receipt only: the workspace is not yet linked to a cloud
project, and deployed Anonymous Auth, private Realtime, Vercel, and live Devin
remain separate acceptance gates. TypeScript tests use structural clients and
mocked fetches; they never contact Supabase, Devin, or GitHub.

See `docs/relay-supabase-setup.md` for local env generation, macOS/Web startup,
cloud linking, and the release checklist.
