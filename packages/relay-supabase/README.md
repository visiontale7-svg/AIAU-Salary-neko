# `@dialogue-atlas/relay-supabase`

This package implements the shared `RelayRoomRepository` and
`RelayRealtimeAdapter` ports from `@dialogue-atlas/relay-contract`.

The factories accept a `SupabaseClientLike` structural interface. A production
composition should create a normal Supabase JS client, complete anonymous sign
in, then inject that client:

```ts
const repository = createRelaySupabaseRepository(client);
const realtime = createRelaySupabaseRealtimeAdapter(client);
```

The package intentionally does not construct a client or embed a URL/key. This
keeps auth/session ownership in the app and lets the repository typecheck and be
tested offline without installing or calling the Supabase SDK here. Structural
assignability against a real SDK client remains a configured-integration gate;
the current Relay Web bridge already accepts `SupabaseClientLike`.

Durable mutations use RPCs. `fetchRoom` uses one `get_room_bundle` RPC so the
projection and its activity watermark share a database snapshot. Realtime
Broadcast/Presence is ephemeral and only prompts replay from `activity_events`;
it is never treated as the source of truth. Presence metadata is untrusted:
the adapter loads RLS-visible `room_members` and uses those durable rows for
`displayName`, `role`, and the stable server-assigned `colorKey`; Presence
contributes only online/editing state. The atomic room bundle carries the same
member directory so offline contribution authors remain resolvable. A Presence
key is visual routing data rather than proof of identity and never authorizes a
durable action.

The repository also exposes `publishAtlasVersion`, `createRoomInvite`, and
`refreshDevinRun`. Current-version layout/team/proposal state is filtered by
`atlas_version_id`; archived rows remain protected and readable in Supabase but
are not misapplied to the current graph. `refreshDevinRun` invokes the Edge
`status` operation so an entitled owner can advance provider status and import
incremental, redacted events. Room members can read the resulting run/event log
directly, while only owners can start or follow up. Provider health, successful
poll/event timestamps, failure count, and `Retry-After` are a separate
service-maintained projection; they never overwrite the monotonic Devin Session
lifecycle. The Edge boundary checks a durable future retry deadline before a
status request or before reserving an owner follow-up. Ordinary failures use a
5/10/20/40/60-second bounded schedule, while 429 honors Devin's Retry-After;
stale and recovered durable activities are emitted once per actual transition.
