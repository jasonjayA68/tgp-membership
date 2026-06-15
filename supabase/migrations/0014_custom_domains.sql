-- =============================================================================
-- SaaS OS — Migration 0014: Custom Domains (#4b)
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe on a DB that already has 0007–0013. Adds:
--  * tenants.domain_verify_token + tenants.domain_verified_at (the verify gate)
--  * resolve_tenant_by_host(text) — anon host→tenant resolver returning ONLY
--    verified, active custom domains (parallels resolve_tenant_by_slug, 0008).
-- =============================================================================

alter table public.tenants
  add column if not exists domain_verify_token text,
  add column if not exists domain_verified_at  timestamptz;

drop function if exists public.resolve_tenant_by_host(text) cascade;

-- Public whitelist resolver by host. Returns ONLY verified + active domains.
create or replace function public.resolve_tenant_by_host(p_host text)
returns table (
  id              uuid,
  name            text,
  slug            text,
  status          public.tenant_status,
  logo_url        text,
  primary_color   text,
  secondary_color text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color
  from public.tenants t
  where t.custom_domain = lower(p_host)
    and t.domain_verified_at is not null
    and t.status = 'active'
  limit 1
$$;

revoke all on function public.resolve_tenant_by_host(text) from public;
grant execute on function public.resolve_tenant_by_host(text) to anon, authenticated;
