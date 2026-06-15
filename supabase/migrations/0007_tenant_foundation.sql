-- =============================================================================
-- SaaS OS — Migration 0007: Tenant Foundation
-- -----------------------------------------------------------------------------
-- Self-contained. SUPERSEDES 0001–0006: on a fresh DB run ONLY this file.
-- Pre-launch / disposable data → clean rebuild (tenant_id NOT NULL from start).
-- Run once in the Supabase SQL Editor (postgres superuser: needed for the
-- auth.users trigger and storage policies).
-- =============================================================================

create extension if not exists pgcrypto;

-- ---- clean slate ------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.audit_logs         cascade;
drop table if exists public.nfc_cards           cascade;
drop table if exists public.district_officers   cascade;
drop table if exists public.profiles            cascade;
drop table if exists public.chapters            cascade;
drop table if exists public.tenant_field_schema cascade;
drop table if exists public.tenant_users        cascade;
drop table if exists public.platform_admins     cascade;
drop table if exists public.tenants             cascade;

drop function if exists public.get_member_card(text)      cascade;
drop function if exists public.handle_profile_change()    cascade;
drop function if exists public.protect_profile_columns()  cascade;
drop function if exists public.handle_new_user()          cascade;
drop function if exists public.generate_nfc_slug(text)    cascade;
drop function if exists public.generate_member_id()       cascade;
drop function if exists public.next_member_id(uuid)       cascade;
drop function if exists public.is_super_admin()           cascade;
drop function if exists public.is_admin()                 cascade;
drop function if exists public.current_app_role()         cascade;
drop function if exists public.is_platform_admin()        cascade;
drop function if exists public.is_tenant_member(uuid)     cascade;
drop function if exists public.is_tenant_admin(uuid)      cascade;
drop function if exists public.is_tenant_owner(uuid)      cascade;

drop type if exists public.member_status cascade;
drop type if exists public.app_role      cascade;
drop type if exists public.tenant_role   cascade;
drop type if exists public.tenant_status cascade;

-- ---- enums ------------------------------------------------------------------
create type public.tenant_status as enum ('active', 'suspended', 'onboarding');
create type public.tenant_role   as enum ('owner', 'admin', 'member');
create type public.member_status as enum ('pending', 'active', 'inactive', 'suspended', 'rejected');

-- ---- tenants ----------------------------------------------------------------
create table public.tenants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  custom_domain    text unique,
  status           public.tenant_status not null default 'active',
  plan_type        text not null default 'free',
  member_id_prefix text not null,
  member_seq       int  not null default 0,
  logo_url         text,
  primary_color    text,
  secondary_color  text,
  created_at       timestamptz not null default now()
);

-- ---- platform_admins (SaaS operators, above all tenants) --------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---- tenant_users (authoritative membership + role) -------------------------
create table public.tenant_users (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.tenant_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index tenant_users_user_idx   on public.tenant_users (user_id);
create index tenant_users_tenant_idx on public.tenant_users (tenant_id);

-- ---- tenant_field_schema (per-tenant custom member fields) ------------------
create table public.tenant_field_schema (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  key        text not null,
  label      text not null,
  type       text not null default 'text',
  is_public  boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

-- ---- chapters ---------------------------------------------------------------
create table public.chapters (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null,
  district    text,
  region      text,   -- council
  verify_officer_id uuid,  -- FK to profiles added after that table exists
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create index chapters_tenant_idx on public.chapters (tenant_id);

-- ---- profiles (fraternal fields now live in custom_fields) ------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  full_name     text not null default '',
  member_id     text,
  chapter_id    uuid references public.chapters (id) on delete set null,
  batch_year    int check (batch_year is null or batch_year between 1968 and 2100),
  status        public.member_status not null default 'pending',
  photo_url     text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, member_id)
);
create index profiles_tenant_idx  on public.profiles (tenant_id);
create index profiles_status_idx  on public.profiles (tenant_id, status);
create index profiles_chapter_idx on public.profiles (chapter_id);

-- chapters.verify_officer_id → profiles (added now that profiles exists)
alter table public.chapters
  add constraint chapters_verify_officer_fk
  foreign key (verify_officer_id) references public.profiles (id) on delete set null;

-- ---- nfc_cards --------------------------------------------------------------
create table public.nfc_cards (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  slug             text not null unique,
  active           boolean not null default true,
  scan_count       integer not null default 0,
  last_verified_at timestamptz,
  created_at       timestamptz not null default now()
);
create index nfc_cards_profile_idx on public.nfc_cards (profile_id);
create index nfc_cards_tenant_idx  on public.nfc_cards (tenant_id);

-- ---- audit_logs -------------------------------------------------------------
create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  action       text not null,
  performed_by uuid references auth.users (id) on delete set null,
  target_user  uuid references auth.users (id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_tenant_idx on public.audit_logs (tenant_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_user);

-- ---- district_officers ------------------------------------------------------
create table public.district_officers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  district   text not null,
  officer_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, district)
);

-- =============================================================================
-- Isolation helpers (SECURITY DEFINER → bypass RLS → no policy recursion)
-- =============================================================================
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.is_tenant_member(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.tenant_users
                  where user_id = auth.uid() and tenant_id = tid)
$$;

create or replace function public.is_tenant_admin(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.tenant_users
                  where user_id = auth.uid() and tenant_id = tid
                    and role in ('owner', 'admin'))
$$;

create or replace function public.is_tenant_owner(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.tenant_users
                  where user_id = auth.uid() and tenant_id = tid and role = 'owner')
$$;

-- Per-tenant member numbering: <prefix>-NNNN (atomic via UPDATE ... RETURNING).
create or replace function public.next_member_id(tid uuid)
returns text language plpgsql volatile security definer set search_path = public as $$
declare seq int; pfx text;
begin
  update public.tenants
     set member_seq = member_seq + 1
   where id = tid
   returning member_seq, member_id_prefix into seq, pfx;
  if pfx is null then raise exception 'next_member_id: unknown tenant %', tid; end if;
  return pfx || '-' || lpad(seq::text, 4, '0');
end $$;
