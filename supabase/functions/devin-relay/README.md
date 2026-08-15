# `devin-relay` boundary

`devin-relay` is the only component allowed to call Devin v3. Request bodies
are exact-key allowlists for `start`, `status`, and `follow_up`; callers cannot
supply a repository, organization, secret, prompt, ACU limit, or provider URL.
The function loads an owner-approved ActionBrief with the caller JWT, sanitizes
it again, and pins every Session to `visiontale7-svg/AIAU-Salary-neko`.

Runtime configuration is server-only:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: user-scoped owner/RLS checks.
- `SUPABASE_SERVICE_ROLE_KEY`: provider-derived status/event persistence only;
  never expose it to a browser or desktop bundle.
- `RELAY_ALLOWED_ORIGINS`: comma-separated exact browser/desktop origins. A
  packaged Tauri client commonly emits `tauri://localhost` (and some targets
  use `http://tauri.localhost`); verify the built app's actual `Origin` and add
  that exact value alongside the deployed web origin. Never use `*`.
- `DEVIN_API_KEY`: an organization credential with a `cog_` prefix.
- `DEVIN_ORG_ID`: the fixed `org-...` organization identifier.
- `DEVIN_REPO`: must exactly equal the canonical repository above.
- `DEVIN_MAX_ACU_LIMIT`: integer global ceiling. The actual request uses the
  lower of this value and the operator entitlement ceiling.

Missing or malformed configuration returns `not_configured` and cannot issue a
Devin request. CORS is defense in depth, not authorization.

## Paid-provider entitlement

Anonymous room ownership is intentionally insufficient. A server operator must
provision a row in `relay_private.devin_entitlements` after the real
`auth.users` identity exists. The row controls enablement, expiry, daily Session
count, and per-Session ACU ceiling. It is not readable or writable by `anon` or
`authenticated` roles. Example operator-side SQL using a psql variable:

```sql
insert into relay_private.devin_entitlements(
  user_id, enabled, expires_at, max_runs_per_day, max_acu_limit
) values (
  :'operator_user_id'::uuid, true, now() + interval '1 day', 2, 5
)
on conflict (user_id) do update set
  enabled = excluded.enabled,
  expires_at = excluded.expires_at,
  max_runs_per_day = excluded.max_runs_per_day,
  max_acu_limit = excluded.max_acu_limit,
  updated_at = now();
```

Revoke immediately with `update relay_private.devin_entitlements set enabled =
false, updated_at = now() where user_id = :'operator_user_id'::uuid;`.

The database atomically reserves one active run per ActionBrief. Before the
paid POST, a service-role-only claim records `provider_attempted_at` and the
fail-closed `provider_result_unknown` state. A timeout, 5xx, malformed success,
or process crash therefore never causes an automatic second POST for the same
or a newly generated client request ID; an operator must reconcile using the
fixed `client-request:<id>` Session tag.

The pinned v3 contract supplied for this MVP includes create, get-by-session,
messages, and follow-up endpoints, but no authoritative tag-search endpoint.
Accordingly a `provider_result_unknown` run remains permanently blocked in the
product: there is deliberately no retry button or guessed provider lookup.
Provisioning a live paid credential is release-blocked until an official
organization Session lookup-by-tag contract is verified and implemented as a
service-role-only reconciliation path (or the operator closes the run after
out-of-band reconciliation).

Follow-up text is sent from the browser to this Edge Function. The function
scans it before storing an append-only `devin_events` attempted record or
sending it onward to Devin; the stored text is visible to room members who can
read that run. The delivery outcome is then service-confirmed as `sent`,
`rejected`, or `unknown` without copying the message body into the outcome
record. Unknown delivery is never silently retried.

Status and message reads use the official organization-scoped v3 endpoints.
Message pagination persists the provider cursor and is capped at five pages
(1,000 events) per poll. Provider text is redacted before database insertion.
Status responses use an authorization-scoped five-second cache and
`Cache-Control: private, max-age=5`. Devin-reported PR URLs are accepted only
for the canonical GitHub repository. CI/check state remains `unknown` until a
separate authenticated GitHub Checks integration verifies it.

The organization Service User is release-gated on all three permissions:

- `UseDevinSessions` for the Session-use/create entitlement;
- `ViewOrgSessions` for status and message reads;
- `ManageOrgSessions` for organization Session creation and follow-up management.

This repository contains no real credential and no test makes a live request.
The adapter is covered with a mocked `fetch`; deployed permissions, billing,
and the live response contract remain explicit integration gates.
