# Dialogue Atlas Relay Web

In development and tests, `RelayWebApp` starts with a validated, redacted `RelayPackageV1` fixture and makes no network request by default. The production entry uses `RelayProductionApp`: it requires `VITE_SUPABASE_URL` plus `VITE_SUPABASE_PUBLISHABLE_KEY`, starts or reuses an anonymous Auth session, and then injects the Supabase adapters. A development server uses the same adapter only when `VITE_RELAY_LOCAL_INTEGRATION=1`; that mode accepts exact loopback HTTP/WS and rejects remote plaintext origins. Missing configuration, failed Auth, or a missing room/invite route renders a fail-closed state rather than the demo.

The first B2 constellation visual slice is available at `/?demo=b2`. It is a deterministic, frontend-only fixture: it does not create a Supabase client, call an LLM, or start Devin. Real `/room/:id` and `#invite=:token` routes always take precedence over this visual entry.

Hosts can inject the shared ports:

```tsx
<RelayWebApp
  repository={relayRoomRepository}
  realtime={relayRealtimeAdapter}
  initialRoomId={roomId}
/>
```

The shared UI never imports Tauri, SQLite, the desktop store, ELK, credentials, or a concrete network client. `@dialogue-atlas/relay-supabase` creates injected adapters from a host-supplied structural Supabase client. The Web production entry owns anonymous Auth/bootstrap and `/room/:id` routing. Canonical guest links use `/room/:id#invite=:token`; query-string invite tokens are intentionally ignored. Successful redemption replaces the address with `/room/:id` before room loading continues.

The controller subscribes before its first room snapshot, then replays durable activity after the snapshot cursor. Reconnect follows the same sequence before retained mutations are replayed. Broadcast focus/typing/drag data is ephemeral decoration only; persistent edits stay disabled unless the runtime is live.

The desktop owner surface can render the same runtime inside its existing React tree:

```tsx
<RelayRoomRuntime
  repository={relayRoomRepository}
  realtime={relayRealtimeAdapter}
  initialRoomId={roomId}
  storage={window.localStorage}
/>
```

For an invite launch, also pass `initialInviteToken` and an `onInviteRedeemed(roomId)` host callback so the host can clear its own transient route state. The desktop host should create/inject its repository and realtime adapter once; it does not need to embed or navigate to the Web app.

`RelayRoomRuntime` is exported by `@dialogue-atlas/relay-room` and has no router, iframe, navigation, Supabase SDK, or Tauri dependency. A host that needs custom layout can call `useRelayRoomController` and render `RelayRoom` directly.

Production builds receive an exact-origin CSP from `VITE_SUPABASE_URL`; malformed or absent URLs produce a self-only `connect-src`, never a wildcard. The static badge and `not_configured` Devin state are intentional: the fixture does not claim a deployment, external session, pull request, or live service connection.
