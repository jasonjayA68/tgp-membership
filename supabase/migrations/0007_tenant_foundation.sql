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
