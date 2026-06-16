-- =============================================================================
-- SaaS OS — Migration 0017: Fix assign_tenant_owner (min(uuid) does not exist)
-- -----------------------------------------------------------------------------
-- The 0010 version used `min(id)` on auth.users.id (a uuid). Postgres has no
-- `min(uuid)` aggregate, so "Assign owner" always errored. Recreate the function
-- to count and fetch the id in two plain selects (no uuid aggregate).
-- =============================================================================

create or replace function public.assign_tenant_owner(p_tenant_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid;
  v_count int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'unknown tenant %', p_tenant_id;
  end if;

  -- Resolve the account by email, ignoring soft-deleted rows; refuse to guess if
  -- more than one matches (Supabase does not always enforce email uniqueness).
  select count(*) into v_count
  from auth.users
  where lower(email) = lower(p_email) and deleted_at is null;
  if v_count = 0 then raise exception 'no account found for %', p_email; end if;
  if v_count > 1 then raise exception 'multiple accounts found for %', p_email; end if;

  select id into v_uid
  from auth.users
  where lower(email) = lower(p_email) and deleted_at is null
  limit 1;

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
