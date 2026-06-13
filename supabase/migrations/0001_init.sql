-- =============================================================================
-- TAU GAMMA PHI — Digital Membership Registry
-- Schema · Row Level Security · Triggers · Storage
-- =============================================================================
-- Run this once in the Supabase SQL Editor (it runs as the `postgres` superuser,
-- which is required for the trigger on `auth.users` and the storage policies).
-- Idempotent where practical so it is safe to re-run during setup.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Clean slate.
-- Drops any earlier/partial version of these objects so the script can be
-- (re)run from scratch. SAFE on a fresh project — these tables hold no data
-- yet. If you later have REAL data, remove this block before re-running.
-- -----------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.audit_logs cascade;
drop table if exists public.nfc_cards  cascade;
drop table if exists public.profiles   cascade;
drop table if exists public.chapters   cascade;

drop function if exists public.get_member_card(text)        cascade;
drop function if exists public.handle_profile_change()      cascade;
drop function if exists public.protect_profile_columns()    cascade;
drop function if exists public.handle_new_user()            cascade;
drop function if exists public.generate_nfc_slug(text)      cascade;
drop function if exists public.generate_member_id()         cascade;
drop function if exists public.is_super_admin()             cascade;
drop function if exists public.is_admin()                   cascade;
drop function if exists public.current_app_role()           cascade;

drop type if exists public.member_status cascade;
drop type if exists public.app_role      cascade;

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('super_admin', 'admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('pending', 'active', 'inactive', 'suspended', 'rejected');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.chapters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  district    text,
  region      text,   -- council
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  full_name   text not null default '',
  member_id   text unique,
  chapter_id  uuid references public.chapters (id) on delete set null,
  batch_year  int  check (batch_year is null or batch_year between 1968 and 2100),
  status      public.member_status not null default 'pending',
  photo_url   text,
  role        public.app_role not null default 'member',
  -- Fraternal information
  alexis_name   text,   -- fraternal alias ("Alexis")
  batch_name    text,   -- name of initiation batch
  date_survived date,    -- date the member "survived"
  -- Lineage / other information
  gt_name       text,   -- Grand Triskelion (when survived)
  gt_number     text,   -- GT's number
  mww_name      text,   -- MWW (when survived)
  mww_number    text,   -- MWW's number
  -- Contact
  contact_number text,  -- phone (shown publicly for legitimacy verification)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_status_idx  on public.profiles (status);
create index if not exists profiles_chapter_idx on public.profiles (chapter_id);

create table if not exists public.nfc_cards (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  slug              text not null unique,
  active            boolean not null default true,
  scan_count        integer not null default 0,
  last_verified_at  timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists nfc_cards_profile_idx on public.nfc_cards (profile_id);

create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  action        text not null,
  performed_by  uuid references auth.users (id) on delete set null,
  target_user   uuid references auth.users (id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_logs_target_idx  on public.audit_logs (target_user);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- Sequential, human-readable member identifiers: TGP-0001, TGP-0002, ...
create sequence if not exists public.member_id_seq start 1;

-- =============================================================================
-- Helper functions  (SECURITY DEFINER → bypass RLS → no policy recursion)
-- =============================================================================
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role in ('admin', 'super_admin')
  )
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'super_admin'
  )
$$;

create or replace function public.generate_member_id()
returns text
language sql volatile as $$
  select 'TGP-' || lpad(nextval('public.member_id_seq')::text, 4, '0')
$$;

create or replace function public.generate_nfc_slug(p_member_id text)
returns text
language sql volatile set search_path = public as $$
  select lower(coalesce(p_member_id, 'tgp')) || '-' ||
         substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)
$$;

-- =============================================================================
-- Triggers
-- =============================================================================

-- 1) Auto-create a pending profile whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Optional fraternal fields arrive via sign-up metadata (see registration form).
  insert into public.profiles (
    user_id, full_name, alexis_name, batch_name, date_survived,
    gt_name, gt_number, mww_name, mww_number, contact_number
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    nullif(new.raw_user_meta_data ->> 'alexis_name', ''),
    nullif(new.raw_user_meta_data ->> 'batch_name', ''),
    nullif(new.raw_user_meta_data ->> 'date_survived', '')::date,
    nullif(new.raw_user_meta_data ->> 'gt_name', ''),
    nullif(new.raw_user_meta_data ->> 'gt_number', ''),
    nullif(new.raw_user_meta_data ->> 'mww_name', ''),
    nullif(new.raw_user_meta_data ->> 'mww_number', ''),
    nullif(new.raw_user_meta_data ->> 'contact_number', '')
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Guard privileged columns + maintain updated_at + auto-assign member_id.
--    Non-admins can NEVER change role / status / member_id / chapter_id, even
--    if they craft a request — the values are reset to their previous state.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  caller_is_admin boolean := public.is_admin();
  caller_is_super boolean := public.is_super_admin();
begin
  -- Restrict only authenticated, NON-admin users. A NULL uid is a trusted
  -- server context (service role / SQL Editor) used for bootstrapping, and
  -- the anon role cannot update profiles at all (blocked by RLS), so it never
  -- reaches this trigger.
  if uid is not null and not caller_is_admin then
    new.role       := old.role;
    new.status     := old.status;
    new.member_id  := old.member_id;
    new.chapter_id := old.chapter_id;
  end if;

  -- Only super admins (or the trusted server context) may alter roles.
  if uid is not null and not caller_is_super
     and new.role is distinct from old.role then
    new.role := old.role;
  end if;

  -- Assign a permanent member id the first time a member becomes active.
  if new.status = 'active' and new.member_id is null then
    new.member_id := public.generate_member_id();
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_protect_profile_columns on public.profiles;
create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- 3) After a privileged change: write audit logs + ensure an NFC card exists.
create or replace function public.handle_profile_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (action, performed_by, target_user, metadata)
    values ('status_change', auth.uid(), new.user_id,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.role is distinct from old.role then
    insert into public.audit_logs (action, performed_by, target_user, metadata)
    values ('role_change', auth.uid(), new.user_id,
            jsonb_build_object('from', old.role, 'to', new.role));
  end if;

  if new.chapter_id is distinct from old.chapter_id then
    insert into public.audit_logs (action, performed_by, target_user, metadata)
    values ('chapter_change', auth.uid(), new.user_id,
            jsonb_build_object('from', old.chapter_id, 'to', new.chapter_id));
  end if;

  -- Provision the NFC card the moment a member is active and has a member id.
  if new.status = 'active' and new.member_id is not null then
    insert into public.nfc_cards (profile_id, slug)
    select new.id, public.generate_nfc_slug(new.member_id)
    where not exists (select 1 from public.nfc_cards where profile_id = new.id);
  end if;

  return new;
end $$;

drop trigger if exists trg_handle_profile_change on public.profiles;
create trigger trg_handle_profile_change
  after update on public.profiles
  for each row execute function public.handle_profile_change();

-- =============================================================================
-- Public verification RPC
-- The ONLY way the anonymous public can read membership data. It exposes a
-- strict whitelist of columns and records each scan. No direct table access.
-- =============================================================================
create or replace function public.get_member_card(card_slug text)
returns table (
  full_name      text,
  member_id      text,
  alexis_name    text,
  batch_name     text,
  date_survived  date,
  contact_number text,
  gt_name        text,
  gt_number      text,
  mww_name       text,
  mww_number     text,
  chapter        text,
  district       text,
  region         text,
  batch_year     int,
  status         public.member_status,
  photo_url      text,
  card_active    boolean
)
language plpgsql security definer set search_path = public as $$
begin
  -- Record the scan (only for live cards).
  update public.nfc_cards
     set scan_count = scan_count + 1,
         last_verified_at = now()
   where slug = card_slug and active = true;

  return query
  select p.full_name,
         p.member_id,
         p.alexis_name,
         p.batch_name,
         p.date_survived,
         p.contact_number,
         p.gt_name,
         p.gt_number,
         p.mww_name,
         p.mww_number,
         c.name,
         c.district,
         c.region,
         p.batch_year,
         p.status,
         p.photo_url,
         n.active
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  left join public.chapters c on c.id = p.chapter_id
  where n.slug = card_slug;
end $$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles   enable row level security;
alter table public.chapters   enable row level security;
alter table public.nfc_cards  enable row level security;
alter table public.audit_logs enable row level security;

-- ---- profiles --------------------------------------------------------------
drop policy if exists profiles_select_own    on public.profiles;
drop policy if exists profiles_select_admin  on public.profiles;
drop policy if exists profiles_insert_self   on public.profiles;
drop policy if exists profiles_update_own    on public.profiles;
drop policy if exists profiles_update_admin  on public.profiles;
drop policy if exists profiles_delete_admin  on public.profiles;

create policy profiles_select_own   on public.profiles for select using (user_id = auth.uid());
create policy profiles_select_admin on public.profiles for select using (public.is_admin());
create policy profiles_insert_self  on public.profiles for insert
  with check (user_id = auth.uid() and role = 'member' and status = 'pending');
create policy profiles_update_own   on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_update_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());
create policy profiles_delete_admin on public.profiles for delete using (public.is_super_admin());

-- ---- chapters --------------------------------------------------------------
drop policy if exists chapters_select_auth on public.chapters;
drop policy if exists chapters_write_admin on public.chapters;

create policy chapters_select_auth on public.chapters for select using (auth.uid() is not null);
create policy chapters_write_admin on public.chapters for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- nfc_cards -------------------------------------------------------------
drop policy if exists nfc_select_own   on public.nfc_cards;
drop policy if exists nfc_select_admin on public.nfc_cards;
drop policy if exists nfc_write_admin  on public.nfc_cards;

create policy nfc_select_own on public.nfc_cards for select using (
  exists (
    select 1 from public.profiles p
    where p.id = nfc_cards.profile_id and p.user_id = auth.uid()
  )
);
create policy nfc_select_admin on public.nfc_cards for select using (public.is_admin());
create policy nfc_write_admin  on public.nfc_cards for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- audit_logs ------------------------------------------------------------
-- Read: admins only. Writes happen exclusively via SECURITY DEFINER triggers,
-- so there is intentionally no INSERT policy (direct inserts are blocked).
drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin on public.audit_logs for select using (public.is_admin());

-- =============================================================================
-- Storage: member photos (public-read bucket, owner-scoped writes)
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists avatars_insert_own  on storage.objects;
drop policy if exists avatars_update_own  on storage.objects;
drop policy if exists avatars_delete_own  on storage.objects;

create policy avatars_public_read on storage.objects for select
  using (bucket_id = 'avatars');

create policy avatars_insert_own on storage.objects for insert with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_update_own on storage.objects for update using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

create policy avatars_delete_own on storage.objects for delete using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- =============================================================================
-- Seed data
-- =============================================================================
insert into public.chapters (name, region) values
  ('Tau Gamma Phi — National Headquarters', 'National'),
  ('Northern Luzon Council',                'Luzon'),
  ('Metro Manila Council',                  'NCR'),
  ('Southern Luzon Council',                'Luzon'),
  ('Visayas Council',                       'Visayas'),
  ('Mindanao Council',                      'Mindanao')
on conflict (name) do nothing;

-- =============================================================================
-- Bootstrap your first administrator
-- -----------------------------------------------------------------------------
-- 1. Register an account through the app at /register.
-- 2. Run the statement below (replace the email) in the SQL Editor:
--
--   update public.profiles
--      set role = 'super_admin', status = 'active'
--    where user_id = (select id from auth.users where email = 'you@example.com');
--
-- That account can then approve members and promote other admins from /admin.
-- =============================================================================
