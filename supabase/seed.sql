-- Dialogue Atlas Relay intentionally has no default data seed.
--
-- In particular, this file never creates auth users, room ownership, provider
-- entitlements, credentials, or demo access. Local fixtures belong in tests.
-- A demo operator entitlement must be provisioned explicitly after its real
-- auth.users identity exists; production must not run a shared demo seed.
begin;
commit;
