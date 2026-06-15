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

-- =============================================================================
-- Triggers
-- =============================================================================

-- 1) On signup: create the membership + profile for the user's tenant.
--    Tenant resolved from metadata (tenant_id → tenant_slug → default 'tgp').
--    Known fraternal metadata keys are landed into custom_fields.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t_id uuid;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  cf   jsonb := '{}'::jsonb;
  k    text;
  fraternal_keys text[] := array[
    'alexis_name','batch_name','date_survived',
    'gt_name','gt_number','mww_name','mww_number','contact_number'
  ];
begin
  if meta ? 'tenant_id' then
    t_id := (meta ->> 'tenant_id')::uuid;
  elsif meta ? 'tenant_slug' then
    select id into t_id from public.tenants where slug = meta ->> 'tenant_slug';
  end if;
  if t_id is null then
    select id into t_id from public.tenants where slug = 'tgp';
  end if;
  if t_id is null then
    return new;  -- no tenants seeded yet; nothing to attach to
  end if;

  foreach k in array fraternal_keys loop
    if nullif(meta ->> k, '') is not null then
      cf := cf || jsonb_build_object(k, meta ->> k);
    end if;
  end loop;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (t_id, new.id, 'member')
  on conflict (tenant_id, user_id) do nothing;

  insert into public.profiles (tenant_id, user_id, full_name, custom_fields)
  values (t_id, new.id, coalesce(nullif(meta ->> 'full_name', ''), ''), cf)
  on conflict (tenant_id, user_id) do nothing;

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Guard privileged columns + updated_at + auto member_id on activation.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  caller_is_admin boolean := public.is_tenant_admin(old.tenant_id);
begin
  -- tenant_id is immutable.
  new.tenant_id := old.tenant_id;

  -- NULL uid = trusted server/SQL context. Authenticated non-admins cannot
  -- change their own standing / member_id / chapter.
  if uid is not null and not caller_is_admin then
    new.status     := old.status;
    new.member_id  := old.member_id;
    new.chapter_id := old.chapter_id;
  end if;

  -- Permanent, tenant-prefixed member id the first time a member goes active.
  if new.status = 'active' and new.member_id is null then
    new.member_id := public.next_member_id(new.tenant_id);
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- 3) After a privileged change: write audit logs + provision the NFC card.
create or replace function public.handle_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (tenant_id, action, performed_by, target_user, metadata)
    values (new.tenant_id, 'status_change', auth.uid(), new.user_id,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.chapter_id is distinct from old.chapter_id then
    insert into public.audit_logs (tenant_id, action, performed_by, target_user, metadata)
    values (new.tenant_id, 'chapter_change', auth.uid(), new.user_id,
            jsonb_build_object('from', old.chapter_id, 'to', new.chapter_id));
  end if;

  if new.status = 'active' and new.member_id is not null then
    insert into public.nfc_cards (tenant_id, profile_id, slug)
    select new.tenant_id, new.id,
           lower(new.member_id) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)
    where not exists (select 1 from public.nfc_cards where profile_id = new.id);
  end if;

  return new;
end $$;

create trigger trg_handle_profile_change
  after update on public.profiles
  for each row execute function public.handle_profile_change();

-- =============================================================================
-- Public verification RPC — the ONLY anon read path. Shape preserved; fraternal
-- values sourced from custom_fields. Tenant-aware (district join scoped by tenant).
-- =============================================================================
create or replace function public.get_member_card(card_slug text)
returns table (
  full_name      text,
  member_id      text,
  alexis_name    text,
  batch_name     text,
  date_survived  date,
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
  card_active    boolean,
  verify_contact_name   text,
  verify_contact_number text
)
language plpgsql security definer set search_path = public as $$
begin
  update public.nfc_cards
     set scan_count = scan_count + 1,
         last_verified_at = now()
   where slug = card_slug and active = true;

  return query
  select p.full_name,
         p.member_id,
         p.custom_fields ->> 'alexis_name',
         p.custom_fields ->> 'batch_name',
         nullif(p.custom_fields ->> 'date_survived', '')::date,
         p.custom_fields ->> 'gt_name',
         p.custom_fields ->> 'gt_number',
         p.custom_fields ->> 'mww_name',
         p.custom_fields ->> 'mww_number',
         c.name,
         c.district,
         c.region,
         p.batch_year,
         p.status,
         p.photo_url,
         n.active,
         coalesce(chap_officer.full_name, dist_officer.full_name),
         coalesce(nullif(chap_officer.custom_fields ->> 'contact_number', ''),
                  nullif(dist_officer.custom_fields ->> 'contact_number', ''))
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  left join public.chapters c on c.id = p.chapter_id
  left join public.profiles chap_officer
         on chap_officer.id = c.verify_officer_id
        and nullif(chap_officer.custom_fields ->> 'contact_number', '') is not null
  left join public.district_officers d_off
         on d_off.tenant_id = p.tenant_id and d_off.district = c.district
  left join public.profiles dist_officer
         on dist_officer.id = d_off.officer_id
        and nullif(dist_officer.custom_fields ->> 'contact_number', '') is not null
  where n.slug = card_slug;
end $$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;

-- =============================================================================
-- Row Level Security  (anon has ZERO direct table access; RPC is the only path)
-- =============================================================================
alter table public.tenants             enable row level security;
alter table public.platform_admins     enable row level security;
alter table public.tenant_users        enable row level security;
alter table public.tenant_field_schema enable row level security;
alter table public.chapters            enable row level security;
alter table public.profiles            enable row level security;
alter table public.nfc_cards           enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.district_officers   enable row level security;

-- ---- platform_admins (platform operators only) -----------------------------
create policy platform_admins_select on public.platform_admins for select using (public.is_platform_admin());
create policy platform_admins_all    on public.platform_admins for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---- tenants ---------------------------------------------------------------
create policy tenants_select on public.tenants for select using (public.is_tenant_member(id));
create policy tenants_insert on public.tenants for insert with check (public.is_platform_admin());
create policy tenants_update on public.tenants for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy tenants_delete on public.tenants for delete using (public.is_platform_admin());

-- ---- tenant_users ----------------------------------------------------------
create policy tenant_users_select on public.tenant_users for select
  using (user_id = auth.uid() or public.is_tenant_admin(tenant_id));
create policy tenant_users_write on public.tenant_users for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- ---- tenant_field_schema ---------------------------------------------------
create policy tfs_select on public.tenant_field_schema for select using (public.is_tenant_member(tenant_id));
create policy tfs_write  on public.tenant_field_schema for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- ---- chapters --------------------------------------------------------------
create policy chapters_select on public.chapters for select using (public.is_tenant_member(tenant_id));
create policy chapters_write  on public.chapters for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- ---- profiles --------------------------------------------------------------
create policy profiles_select_own   on public.profiles for select using (user_id = auth.uid());
create policy profiles_select_admin on public.profiles for select using (public.is_tenant_admin(tenant_id));
create policy profiles_insert_self  on public.profiles for insert
  with check (user_id = auth.uid() and public.is_tenant_member(tenant_id) and status = 'pending');
create policy profiles_update_own   on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_update_admin on public.profiles for update
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));
create policy profiles_delete_owner on public.profiles for delete using (public.is_tenant_owner(tenant_id));

-- ---- nfc_cards -------------------------------------------------------------
create policy nfc_select_own on public.nfc_cards for select using (
  exists (select 1 from public.profiles p where p.id = nfc_cards.profile_id and p.user_id = auth.uid())
);
create policy nfc_select_admin on public.nfc_cards for select using (public.is_tenant_admin(tenant_id));
create policy nfc_write_admin  on public.nfc_cards for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- ---- audit_logs (read admin; writes only via SECURITY DEFINER triggers) ----
create policy audit_select_admin on public.audit_logs for select using (public.is_tenant_admin(tenant_id));

-- ---- district_officers -----------------------------------------------------
create policy district_officers_select on public.district_officers for select using (public.is_tenant_member(tenant_id));
create policy district_officers_write  on public.district_officers for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

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

create policy avatars_public_read on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_insert_own on storage.objects for insert with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy avatars_update_own on storage.objects for update using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_platform_admin())
);
create policy avatars_delete_own on storage.objects for delete using (
  bucket_id = 'avatars'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_platform_admin())
);

-- =============================================================================
-- Seeds
-- =============================================================================
-- TGP — tenant #1
insert into public.tenants (name, slug, member_id_prefix)
values ('Tau Gamma Phi', 'tgp', 'TGP')
on conflict (slug) do nothing;

-- TGP councils
insert into public.chapters (tenant_id, name, region)
select t.id, c.name, c.region
from public.tenants t,
     (values
       ('Tau Gamma Phi — National Headquarters', 'National'),
       ('Northern Luzon Council',                'Luzon'),
       ('Metro Manila Council',                  'NCR'),
       ('Southern Luzon Council',                'Luzon'),
       ('Visayas Council',                       'Visayas'),
       ('Mindanao Council',                      'Mindanao')
     ) as c(name, region)
where t.slug = 'tgp'
on conflict (tenant_id, name) do nothing;

-- TGP fraternal field schema (is_public mirrors current public exposure:
-- contact_number is NOT publicly shown — it only feeds verify-officer contact).
insert into public.tenant_field_schema (tenant_id, key, label, type, is_public, sort_order)
select t.id, f.key, f.label, f.type, f.is_public, f.sort_order
from public.tenants t,
     (values
       ('alexis_name',    'Alexis Name',           'text',  true,  1),
       ('batch_name',     'Batch Name',            'text',  true,  2),
       ('date_survived',  'Date Survived',         'date',  true,  3),
       ('gt_name',        'Grand Triskelion (GT)', 'text',  true,  4),
       ('gt_number',      'GT Number',             'phone', true,  5),
       ('mww_name',       'MWW',                   'text',  true,  6),
       ('mww_number',     'MWW Number',            'phone', true,  7),
       ('contact_number', 'Contact Number',        'phone', false, 8)
     ) as f(key, label, type, is_public, sort_order)
where t.slug = 'tgp'
on conflict (tenant_id, key) do nothing;

-- Org-B — throwaway second tenant to prove isolation
insert into public.tenants (name, slug, member_id_prefix)
values ('Org B (test)', 'org-b', 'ORG')
on conflict (slug) do nothing;

insert into public.tenant_field_schema (tenant_id, key, label, type, is_public, sort_order)
select t.id, 'employee_no', 'Employee No', 'text', true, 1
from public.tenants t where t.slug = 'org-b'
on conflict (tenant_id, key) do nothing;

-- =============================================================================
-- Bootstrap your first platform admin + TGP owner (replaces old super_admin step)
-- -----------------------------------------------------------------------------
-- 1. Register an account at /register (creates a TGP 'member' membership).
-- 2. Run (replace the email):
--
--   with u as (select id from auth.users where email = 'you@example.com')
--   insert into public.platform_admins (user_id) select id from u
--     on conflict do nothing;
--
--   with u as (select id from auth.users where email = 'you@example.com'),
--        t as (select id from public.tenants where slug = 'tgp')
--   update public.tenant_users tu set role = 'owner'
--     from u, t where tu.user_id = u.id and tu.tenant_id = t.id;
-- =============================================================================
