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
declare v_uid uuid; v_count int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'unknown tenant %', p_tenant_id;
  end if;

  -- Resolve the account by email, ignoring soft-deleted rows; refuse to guess
  -- if more than one matches (Supabase does not always enforce email uniqueness).
  select count(*), min(id) into v_count, v_uid
  from auth.users
  where lower(email) = lower(p_email) and deleted_at is null;
  if v_count = 0 then raise exception 'no account found for %', p_email; end if;
  if v_count > 1 then raise exception 'multiple accounts found for %', p_email; end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (p_tenant_id, v_uid, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';

  -- Audit the assignment (highest-privilege tenant action). No profile is created:
  -- the owner's access is role-based; a profile is optional (normal flow only).
  insert into public.audit_logs (tenant_id, action, performed_by, target_user, metadata)
  values (p_tenant_id, 'owner_assigned', auth.uid(), v_uid,
          jsonb_build_object('email', lower(p_email)));
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
