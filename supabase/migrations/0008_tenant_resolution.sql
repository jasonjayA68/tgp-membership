-- =============================================================================
-- SaaS OS — Migration 0008: Tenant Resolution RPCs
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe on a DB that already has 0007. Adds two SECURITY DEFINER RPCs:
--  * resolve_tenant_by_slug — public whitelist lookup so middleware can resolve
--    ANY tenant by slug (tenants RLS is membership-gated, so this is required).
--  * join_tenant_by_slug — lets an authenticated user self-join a tenant as a
--    pending member (RLS blocks a non-member from inserting their own rows).
-- =============================================================================

drop function if exists public.resolve_tenant_by_slug(text) cascade;
drop function if exists public.join_tenant_by_slug(text)   cascade;

-- Public whitelist resolver (anon + authenticated). No sensitive columns.
create or replace function public.resolve_tenant_by_slug(p_slug text)
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
  where t.slug = p_slug
$$;

revoke all on function public.resolve_tenant_by_slug(text) from public;
grant execute on function public.resolve_tenant_by_slug(text) to anon, authenticated;

-- Authenticated self-join: pending membership + profile for the calling user.
create or replace function public.join_tenant_by_slug(p_slug text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  t_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select id into t_id from public.tenants
   where slug = p_slug and status = 'active';
  if t_id is null then raise exception 'tenant % not found or inactive', p_slug; end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (t_id, uid, 'member')
  on conflict (tenant_id, user_id) do nothing;

  insert into public.profiles (tenant_id, user_id, status)
  values (t_id, uid, 'pending')
  on conflict (tenant_id, user_id) do nothing;
end $$;

revoke all on function public.join_tenant_by_slug(text) from public;
grant execute on function public.join_tenant_by_slug(text) to authenticated;
