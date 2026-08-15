-- Extend the shared-content privacy boundary without rewriting already-shipped
-- migrations. The same credential shapes are rejected by RelayPackageV1 and
-- the devin-relay Edge policy.

create or replace function relay_private.assert_safe_shared_text(p_value text, p_context text)
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
    or position(E'\\\\' in p_value) > 0
    or p_value ~* '(sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN( [A-Z0-9]+)* PRIVATE KEY-----|authorization[[:space:]]*[:=][[:space:]]*[^,;[:cntrl:]]{8,}|(^|[^[:alnum:]_])bearer[[:space:]]+[A-Za-z0-9][A-Za-z0-9._~+/=-]{7,}|(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}([^A-Za-z0-9_-]|$)|(api[_-]?key|authorization|bearer|token|secret|password)[[:space:]]*[:=][[:space:]]*[^[:space:],;]{8,})'
  then
    raise exception using errcode = '22023', message = p_context || ' contains unsafe shared content';
  end if;
end;
$$;

-- The original package validator contains the full structural validation and
-- remains immutable. Wrap it so every package string also passes the hardened
-- shared-text assertion, including fields added to existing allowlists later.
alter function relay_private.assert_relay_package(jsonb)
  rename to assert_relay_package_before_credential_hardening;

create function relay_private.assert_relay_package(p_package jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, relay_private
as $$
begin
  perform relay_private.assert_safe_shared_text(p_package::text, 'Relay package');
  perform relay_private.assert_relay_package_before_credential_hardening(p_package);
end;
$$;

revoke all on function relay_private.assert_safe_shared_text(text, text) from public, anon, authenticated;
revoke all on function relay_private.assert_relay_package(jsonb) from public, anon, authenticated;
revoke all on function relay_private.assert_relay_package_before_credential_hardening(jsonb) from public, anon, authenticated;

-- A trigger protects the durable package write even if a long-lived pooled
-- backend had cached the pre-rename validator function OID before this
-- migration. A rejected insert rolls back the entire room/version RPC.
create function relay_private.enforce_atlas_version_credential_privacy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, relay_private
as $$
begin
  perform relay_private.assert_safe_shared_text(new.package::text, 'Relay package');
  return new;
end;
$$;

create trigger atlas_versions_credential_privacy
before insert or update of package on public.atlas_versions
for each row execute function relay_private.enforce_atlas_version_credential_privacy();

revoke all on function relay_private.enforce_atlas_version_credential_privacy() from public, anon, authenticated;
