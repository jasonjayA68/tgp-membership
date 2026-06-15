-- =============================================================================
-- SaaS OS — Migration 0010: Platform console RPCs
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007–0009. Two platform-admin-gated SECURITY DEFINER RPCs:
--  * assign_tenant_owner — look up auth.users by email (not RLS-readable) and
--    make that user the tenant's owner (+ ensure a profile).
--  * platform_tenant_stats — per-tenant member/active counts in one round-trip.
-- Tenant create / suspend / branding need NO RPC (RLS already allows platform
-- admins to insert/update tenants via the authed client).
-- =============================================================================

drop function if exists public.assign_tenant_owner(uuid, text) cascade;
drop function if exists public.platform_tenant_stats()         cascade;

create or replace function public.assign_tenant_owner(p_tenant_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then raise exception 'no account found for %', p_email; end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (p_tenant_id, v_uid, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';

  insert into public.profiles (tenant_id, user_id, status)
  values (p_tenant_id, v_uid, 'active')
  on conflict (tenant_id, user_id) do nothing;
end $$;

revoke all on function public.assign_tenant_owner(uuid, text) from public;
grant execute on function public.assign_tenant_owner(uuid, text) to authenticated;

create or replace function public.platform_tenant_stats()
returns table (tenant_id uuid, member_count bigint, active_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  return query
  select t.id,
         count(p.id),
         count(p.id) filter (where p.status = 'active')
  from public.tenants t
  left join public.profiles p on p.tenant_id = t.id
  group by t.id;
end $$;

revoke all on function public.platform_tenant_stats() from public;
grant execute on function public.platform_tenant_stats() to authenticated;
