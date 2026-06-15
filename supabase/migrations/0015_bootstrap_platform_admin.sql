-- =============================================================================
-- SaaS OS — Migration 0015: Bootstrap the first platform admin
-- -----------------------------------------------------------------------------
-- The DB gates platform access on a platform_admins ROW (is_platform_admin()).
-- The very first admin can't be granted through the app (no existing admin, no
-- service-role key), so we provide two safe bootstrap paths:
--   A. A direct grant for the known first admin email (idempotent).
--   B. claim_platform_admin(): a SECURITY DEFINER self-claim the app calls for
--      env-allowlisted users (PLATFORM_ADMIN_EMAILS). It creates the row from
--      auth.uid() — immune to email-string mismatches — and only while no OTHER
--      admin exists, so it can never be used for self-promotion afterward.
-- =============================================================================

-- A. Direct grant (idempotent; a no-op if the email doesn't match a user).
insert into public.platform_admins (user_id)
select id from auth.users
where lower(email) = lower('jasonjay.ababao1968@gmail.com')
on conflict do nothing;

-- B. Self-heal RPC.
drop function if exists public.claim_platform_admin() cascade;

create or replace function public.claim_platform_admin()
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  -- Bootstrap only: refuse if a DIFFERENT user is already an admin.
  if exists (select 1 from public.platform_admins where user_id <> auth.uid()) then
    return false;
  end if;
  insert into public.platform_admins (user_id)
  values (auth.uid())
  on conflict do nothing;
  return true;
end $$;

revoke all on function public.claim_platform_admin() from public;
grant execute on function public.claim_platform_admin() to authenticated;
