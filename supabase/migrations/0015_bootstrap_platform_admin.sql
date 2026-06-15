-- =============================================================================
-- SaaS OS — Migration 0015: Bootstrap the first platform admin
-- -----------------------------------------------------------------------------
-- The DB gates platform access on a platform_admins ROW (is_platform_admin()).
-- The very first admin can't be granted through the app (no existing admin, no
-- service-role key), so we provide safe bootstrap paths:
--   A. A server-side bootstrap-email allowlist table (gates the self-claim RPC).
--   B. A direct grant for the known first admin email (idempotent).
--   C. claim_platform_admin(): a SECURITY DEFINER self-claim the app calls for
--      env-allowlisted users. Authorization is enforced INSIDE the function —
--      it grants only when the caller's email is in the allowlist table AND no
--      OTHER admin exists — so a logged-in non-allowlisted user can NEVER use it
--      to self-promote, even while platform_admins is empty.
-- =============================================================================

-- A. Bootstrap-email allowlist (the server-side source of truth for the RPC).
create table if not exists public.platform_admin_bootstrap_emails (
  email text primary key
);
-- RLS on, NO policies → unreadable/unwritable by anon + authenticated. Only the
-- SECURITY DEFINER function below (running as owner) and service_role can read it.
alter table public.platform_admin_bootstrap_emails enable row level security;

insert into public.platform_admin_bootstrap_emails (email)
values (lower('jasonjay.ababao1968@gmail.com'))
on conflict do nothing;

-- B. Direct grant for the known first admin (idempotent; no-op if no match).
insert into public.platform_admins (user_id)
select id from auth.users
where lower(email) = lower('jasonjay.ababao1968@gmail.com')
on conflict do nothing;

-- C. Self-heal RPC — authorization enforced inside the function.
drop function if exists public.claim_platform_admin() cascade;

create or replace function public.claim_platform_admin()
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  caller_email text;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- The caller must be on the server-side bootstrap allowlist. This is the real
  -- authorization gate — it cannot be bypassed by calling the RPC directly.
  select lower(email) into caller_email from auth.users where id = auth.uid();
  if caller_email is null
     or not exists (select 1 from public.platform_admin_bootstrap_emails
                    where email = caller_email) then
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
