# Tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-tenant TGP registry into a multi-tenant foundation — `tenant_id` on every table, tenant-scoped RLS, a Slack-style membership model, and an app-layer tenant filter — with TGP reseeded as tenant #1 and all existing TGP flows working unchanged.

**Architecture:** A single clean migration (`0007`) supersedes `0001`–`0006`: new tenant tables (`tenants`, `platform_admins`, `tenant_users`, `tenant_field_schema`), `tenant_id` added to every entity table, fraternal columns moved into `profiles.custom_fields jsonb`, global `is_admin/is_super_admin` replaced by tenant-scoped `SECURITY DEFINER` helpers, and membership-based RLS. The app gains a `getActiveTenant()` seam (defaults to TGP), a `tdb()` tenant-scoped query helper, and a `toProfileView()` shim that flattens `custom_fields` back to named fields so existing pages are untouched. The public `get_member_card` RPC keeps its exact return shape (sourced from JSONB), so the public ID page needs no changes.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), Supabase (Postgres + RLS + Auth + Storage), `@supabase/ssr`, TypeScript, zod.

---

## Environment & tooling notes (read first)

- **No test runner and no local Supabase CLI exist.** Migrations are applied **manually in the Supabase SQL Editor** (or via `psql $DATABASE_URL`). The project's verification mechanisms are therefore: (a) a runnable **SQL isolation probe** (`supabase/tests/0007_isolation_checks.sql`), (b) `npx tsc --noEmit` for the app layer, and (c) `npm run build`. TDD is adapted accordingly: the SQL probe is written first (Task 1) and fails before the migration exists; app-layer tasks are gated by `tsc`.
- **The migration is one file built incrementally** across Tasks 2–8 (each appends a section). It is not applied until Task 9. Intermediate commits of a not-yet-applied SQL file are expected and fine.
- **`0007` is self-contained** — it drops all app objects from `0001`–`0006` and recreates them with tenancy. On a fresh database you run only `0007` (it does not depend on the earlier migrations having run).
- Run all commands from the repo root: `/Users/jasonjayababao/tgp-membership`.

## File structure

**Create:**
- `supabase/migrations/0007_tenant_foundation.sql` — the full multi-tenant schema, helpers, RLS, triggers, RPC, seeds.
- `supabase/tests/0007_isolation_checks.sql` — runnable RLS isolation probe (transactional, rolls back).
- `lib/tenant/types.ts` — re-exports of tenant-related types + small membership helpers.
- `lib/tenant/context.ts` — `getActiveTenant()` (defaults to TGP; Sub-project 2's seam).
- `lib/supabase/db.ts` — `tdb(client, tenantId)` tenant-scoped query helper.
- `lib/profile.ts` — `toProfileView()` / `fraternalToCustomFields()` compat shims.

**Modify:**
- `lib/types.ts` — new tenant types; `Profile` loses fraternal columns, gains `tenant_id` + `custom_fields`; `ProfileWithChapter` becomes a flattened view type; `Database` updated.
- `lib/constants.ts` — replace `AppRole` `ROLE_META`/`isAdminRole` with `TenantRole` `TENANT_ROLE_META`/`isTenantAdminRole`.
- `lib/auth.ts` — `getAuth()` returns `{ user, tenant, role, profile }`; `requireAdmin` → `requireTenantAdmin`.
- `lib/actions/profile.ts` — write fraternal inputs into `custom_fields`; tenant-scope the update.
- `lib/actions/admin.ts` — admin authority via `tenant_users`; tenant-scope queries; `setMemberRole` rewritten for `tenant_users`.
- `app/(app)/layout.tsx`, `app/(app)/admin/layout.tsx`, `app/(app)/profile/page.tsx`, `app/(app)/admin/members/[id]/page.tsx` — read role from membership; flatten target profile.

**Unchanged (verify, do not edit):** `lib/actions/auth.ts` (signup metadata keys preserved), `app/id/[slug]/page.tsx` (RPC shape preserved), `components/id-card.tsx`, `components/profile/profile-form.tsx`, `proxy.ts`, `lib/supabase/{server,proxy,client}.ts`.

---

## Task 1: Write the RLS isolation probe (fails before migration)

**Files:**
- Create: `supabase/tests/0007_isolation_checks.sql`

- [ ] **Step 1: Write the probe**

This transactional script creates two auth users in different tenants (the `handle_new_user`
trigger wires their membership + profile), then asserts cross-tenant reads are blocked under RLS.
It `ROLLBACK`s so it never mutates real data. Create `supabase/tests/0007_isolation_checks.sql`:

```sql
-- Run in the Supabase SQL Editor (as postgres) AFTER applying 0007.
-- Self-contained: creates two throwaway auth users, asserts isolation, then rolls back.
begin;

-- Two fake authenticated users in different tenants (tenant resolved from metadata).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','probe-a@test.dev','', now(), now(), now(),
   '{}'::jsonb, jsonb_build_object('full_name','Probe A','tenant_slug','tgp',
                                   'alexis_name','Andromeda','contact_number','0917-000-0001'), false),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','probe-b@test.dev','', now(), now(), now(),
   '{}'::jsonb, jsonb_build_object('full_name','Probe B','tenant_slug','org-b'), false);

-- Sanity: the trigger created exactly one profile per user, in the right tenant.
do $$
declare a_tenant text; b_tenant text;
begin
  select tn.slug into a_tenant from public.profiles p
    join public.tenants tn on tn.id = p.tenant_id
   where p.user_id = '11111111-1111-1111-1111-111111111111';
  select tn.slug into b_tenant from public.profiles p
    join public.tenants tn on tn.id = p.tenant_id
   where p.user_id = '22222222-2222-2222-2222-222222222222';
  if a_tenant is distinct from 'tgp' then raise exception 'FAIL: A not in tgp (got %)', a_tenant; end if;
  if b_tenant is distinct from 'org-b' then raise exception 'FAIL: B not in org-b (got %)', b_tenant; end if;
  raise notice 'OK: trigger placed each user in the correct tenant';
end $$;

-- Sanity: A's fraternal signup metadata landed in custom_fields.
do $$
declare alexis text;
begin
  select custom_fields ->> 'alexis_name' into alexis from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111';
  if alexis is distinct from 'Andromeda' then raise exception 'FAIL: custom_fields not populated (got %)', alexis; end if;
  raise notice 'OK: signup metadata flattened into custom_fields';
end $$;

-- As user A (TGP member), under RLS: must see own profile, must NOT see org-b rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare visible int; foreign_visible int;
begin
  select count(*) into visible from public.profiles where user_id = '11111111-1111-1111-1111-111111111111';
  if visible <> 1 then raise exception 'FAIL: A cannot see own profile (count=%)', visible; end if;

  select count(*) into foreign_visible from public.profiles
   where user_id = '22222222-2222-2222-2222-222222222222';
  if foreign_visible <> 0 then raise exception 'FAIL: A can see org-b profile (count=%)', foreign_visible; end if;

  -- A is a plain member, not admin: cannot see other TGP members' rows either.
  select count(*) into foreign_visible from public.chapters
   where tenant_id = (select id from public.tenants where slug = 'org-b');
  if foreign_visible <> 0 then raise exception 'FAIL: A can see org-b chapters (count=%)', foreign_visible; end if;

  raise notice 'OK: TGP member is isolated from org-b under RLS';
end $$;

reset role;
rollback;
```

- [ ] **Step 2: Confirm it fails today (no migration yet)**

Open the Supabase SQL Editor, paste the file, run it.
Expected: **FAIL** — e.g. `relation "public.tenants" does not exist` (or `column "custom_fields" does not exist`), because `0007` has not been applied. Record that it errored.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/0007_isolation_checks.sql
git commit -m "test: RLS tenant-isolation probe for tenant foundation"
```

---

## Task 2: Migration — extensions, clean slate, enums, tenant core tables

**Files:**
- Create: `supabase/migrations/0007_tenant_foundation.sql`

- [ ] **Step 1: Write the header + clean slate + enums + core tenant tables**

Create `supabase/migrations/0007_tenant_foundation.sql` with:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 1 — tenant core tables, enums, clean slate"
```

---

## Task 3: Migration — reworked entity tables (tenant_id everywhere)

**Files:**
- Modify: `supabase/migrations/0007_tenant_foundation.sql` (append)

- [ ] **Step 1: Append the entity tables**

Append to `supabase/migrations/0007_tenant_foundation.sql`:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 2 — entity tables with tenant_id + custom_fields"
```

---

## Task 4: Migration — isolation helper functions

**Files:**
- Modify: `supabase/migrations/0007_tenant_foundation.sql` (append)

- [ ] **Step 1: Append the helpers**

These are `SECURITY DEFINER` so they bypass RLS (no policy recursion). Append:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 3 — tenant-scoped SECURITY DEFINER helpers"
```

---

## Task 5: Migration — triggers

**Files:**
- Modify: `supabase/migrations/0007_tenant_foundation.sql` (append)

- [ ] **Step 1: Append the triggers**

Append:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 4 — tenant-aware triggers"
```

---

## Task 6: Migration — public verification RPC (shape-stable)

**Files:**
- Modify: `supabase/migrations/0007_tenant_foundation.sql` (append)

- [ ] **Step 1: Append the RPC**

Keeps the **exact** return shape the public ID page consumes; sources fraternal values from
`custom_fields`. Append:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 5 — tenant-aware get_member_card (shape-stable)"
```

---

## Task 7: Migration — Row Level Security

**Files:**
- Modify: `supabase/migrations/0007_tenant_foundation.sql` (append)

- [ ] **Step 1: Append RLS enablement + policies**

Append:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 6 — membership-based RLS policies"
```

---

## Task 8: Migration — storage policies + seeds + bootstrap

**Files:**
- Modify: `supabase/migrations/0007_tenant_foundation.sql` (append)

- [ ] **Step 1: Append storage, seeds, bootstrap notes**

Append (note: avatar admin-override now uses `is_platform_admin()`):

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_tenant_foundation.sql
git commit -m "feat(db): 0007 part 7 — storage policies, seeds, bootstrap"
```

---

## Task 9: Apply migration and run the isolation probe (must pass)

**Files:** none (operational)

- [ ] **Step 1: Apply the migration**

In the Supabase SQL Editor (or `psql "$DATABASE_URL" -f supabase/migrations/0007_tenant_foundation.sql`),
paste and run the entire `supabase/migrations/0007_tenant_foundation.sql`.
Expected: completes with no error; `tenants` shows `tgp` and `org-b`.

- [ ] **Step 2: Verify seeds**

Run in SQL Editor:

```sql
select slug, member_id_prefix from public.tenants order by slug;
select count(*) from public.tenant_field_schema
 where tenant_id = (select id from public.tenants where slug='tgp');
```

Expected: two rows (`org-b`/`ORG`, `tgp`/`TGP`); field-schema count = **8**.

- [ ] **Step 3: Run the isolation probe — must pass**

Paste `supabase/tests/0007_isolation_checks.sql` into the SQL Editor and run it.
Expected: only `NOTICE: OK ...` lines, **no** `FAIL`, and it ends with `ROLLBACK` (no rows persisted).

- [ ] **Step 4: Commit (no code change — record completion in the next task's commit)**

No file change here. If the probe required a tweak to `0007`, amend the relevant Task 2–8 file and re-run Steps 1–3 before proceeding.

---

## Task 10: App types — `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (full rewrite)

- [ ] **Step 1: Replace `lib/types.ts` with the multi-tenant types**

Replace the entire file contents with:

```ts
/**
 * Database types for the SaaS OS (multi-tenant). Hand-authored to mirror
 * supabase/migrations/0007_tenant_foundation.sql.
 *
 * Row shapes are `type` aliases (not `interface`) to satisfy supabase-js's
 * `Record<string, unknown>` schema constraint.
 */

export type TenantStatus = "active" | "suspended" | "onboarding";
export type TenantRole = "owner" | "admin" | "member";

export type MemberStatus =
  | "pending"
  | "active"
  | "inactive"
  | "suspended"
  | "rejected";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  status: TenantStatus;
  plan_type: string;
  member_id_prefix: string;
  member_seq: number;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  created_at: string;
};

export type PlatformAdmin = { user_id: string; created_at: string };

export type TenantUser = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  created_at: string;
};

export type TenantFieldSchema = {
  id: string;
  tenant_id: string;
  key: string;
  label: string;
  type: string;
  is_public: boolean;
  sort_order: number;
  created_at: string;
};

export type Chapter = {
  id: string;
  tenant_id: string;
  name: string;
  district: string | null;
  region: string | null; // council
  verify_officer_id: string | null;
  created_at: string;
};

export type DistrictOfficer = {
  id: string;
  tenant_id: string;
  district: string;
  officer_id: string | null;
  created_at: string;
};

/** DB row. Fraternal/custom data lives in `custom_fields`. */
export type Profile = {
  id: string;
  tenant_id: string;
  user_id: string;
  full_name: string;
  member_id: string | null;
  chapter_id: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  custom_fields: Record<string, string | null>;
  created_at: string;
  updated_at: string;
};

export type NfcCard = {
  id: string;
  tenant_id: string;
  profile_id: string;
  slug: string;
  active: boolean;
  scan_count: number;
  last_verified_at: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  tenant_id: string;
  action: string;
  performed_by: string | null;
  target_user: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Whitelisted shape returned by the public `get_member_card` RPC (unchanged). */
export type MemberCard = {
  full_name: string;
  member_id: string | null;
  alexis_name: string | null;
  batch_name: string | null;
  date_survived: string | null;
  gt_name: string | null;
  gt_number: string | null;
  mww_name: string | null;
  mww_number: string | null;
  chapter: string | null;
  district: string | null;
  region: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  card_active: boolean;
  verify_contact_name: string | null;
  verify_contact_number: string | null;
};

/**
 * View type used throughout the authed app: the profile row joined with its
 * chapter AND with TGP's fraternal `custom_fields` flattened to named props
 * (compat shim — see lib/profile.ts). Replaced by schema-driven rendering later.
 */
export type ProfileWithChapter = Profile & {
  chapter: Pick<Chapter, "id" | "name" | "district" | "region"> | null;
  alexis_name: string | null;
  batch_name: string | null;
  date_survived: string | null;
  gt_name: string | null;
  gt_number: string | null;
  mww_name: string | null;
  mww_number: string | null;
  contact_number: string | null;
};

type Generated<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      tenants: Generated<Tenant>;
      platform_admins: Generated<PlatformAdmin>;
      tenant_users: Generated<TenantUser>;
      tenant_field_schema: Generated<TenantFieldSchema>;
      chapters: Generated<Chapter>;
      district_officers: Generated<DistrictOfficer>;
      profiles: {
        Row: Profile;
        Insert: Partial<Profile>;
        Update: Partial<Profile>;
        Relationships: [
          {
            foreignKeyName: "profiles_chapter_id_fkey";
            columns: ["chapter_id"];
            isOneToOne: false;
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };
      nfc_cards: {
        Row: NfcCard;
        Insert: Partial<NfcCard>;
        Update: Partial<NfcCard>;
        Relationships: [
          {
            foreignKeyName: "nfc_cards_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: Generated<AuditLog>;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_member_card: { Args: { card_slug: string }; Returns: MemberCard[] };
      is_platform_admin: { Args: Record<string, never>; Returns: boolean };
      is_tenant_member: { Args: { tid: string }; Returns: boolean };
      is_tenant_admin: { Args: { tid: string }; Returns: boolean };
      is_tenant_owner: { Args: { tid: string }; Returns: boolean };
      next_member_id: { Args: { tid: string }; Returns: string };
    };
    Enums: {
      tenant_status: TenantStatus;
      tenant_role: TenantRole;
      member_status: MemberStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
```

- [ ] **Step 2: Typecheck (expect errors elsewhere — they are fixed in later tasks)**

Run: `npx tsc --noEmit`
Expected: errors only in files that still reference `AppRole` / fraternal columns / `is_admin`
(`lib/constants.ts`, `lib/auth.ts`, `lib/actions/*`, the four pages). `lib/types.ts` itself must
have **no** error. (These cascade errors are resolved by Tasks 11–18.)

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): multi-tenant database types"
```

---

## Task 11: `lib/constants.ts` — tenant role meta

**Files:**
- Modify: `lib/constants.ts`

- [ ] **Step 1: Swap the role types/helpers**

Change the import and replace the `ROLE_META` + `isAdminRole` block.

Replace line 1:

```ts
import type { MemberStatus, TenantRole } from "@/lib/types";
```

Replace the `ROLE_META` constant and `isAdminRole` function (the block starting
`export const ROLE_META` through the end of the file) with:

```ts
export const TENANT_ROLE_META: Record<
  TenantRole,
  { label: string; rank: number }
> = {
  owner: { label: "Owner", rank: 3 },
  admin: { label: "Administrator", rank: 2 },
  member: { label: "Member", rank: 1 },
};

export const MEMBER_STATUSES: MemberStatus[] = [
  "pending",
  "active",
  "inactive",
  "suspended",
  "rejected",
];

export function isTenantAdminRole(
  role: TenantRole | null | undefined,
): boolean {
  return role === "admin" || role === "owner";
}
```

(Keep the existing `SITE` and `STATUS_META` definitions above unchanged — `SITE` remains TGP-branded; dynamic per-tenant branding is a later sub-project.)

- [ ] **Step 2: Typecheck this file's exports resolve**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/constants.ts` internals (remaining errors are in consumers updated next).

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat: tenant role metadata + isTenantAdminRole"
```

---

## Task 12: Tenant context — `lib/tenant/types.ts` + `lib/tenant/context.ts`

**Files:**
- Create: `lib/tenant/types.ts`
- Create: `lib/tenant/context.ts`

- [ ] **Step 1: Create `lib/tenant/types.ts`**

```ts
export type {
  Tenant,
  TenantRole,
  TenantStatus,
  TenantUser,
  TenantFieldSchema,
} from "@/lib/types";
```

- [ ] **Step 2: Create `lib/tenant/context.ts`**

```ts
import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types";

/**
 * Default tenant for the foundation phase. Real per-request resolution
 * (custom domain / `/t/[slug]`) arrives in Sub-project 2 — this function is
 * the seam it will replace.
 */
export const DEFAULT_TENANT_SLUG = "tgp";

/** The active tenant for the current request. Memoised per request. */
export const getActiveTenant = cache(async (): Promise<Tenant> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("slug", DEFAULT_TENANT_SLUG)
    .single();
  if (error) {
    throw new Error(`Active tenant "${DEFAULT_TENANT_SLUG}" not found: ${error.message}`);
  }
  return data as Tenant;
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add lib/tenant/types.ts lib/tenant/context.ts
git commit -m "feat(tenant): active-tenant context (defaults to TGP)"
```

---

## Task 13: Tenant-scoped query helper — `lib/supabase/db.ts`

**Files:**
- Create: `lib/supabase/db.ts`

- [ ] **Step 1: Create `lib/supabase/db.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types";

type DB = SupabaseClient<Database>;

/** Tables that carry a tenant_id and must always be tenant-scoped. */
export type TenantTable =
  | "profiles"
  | "chapters"
  | "nfc_cards"
  | "audit_logs"
  | "district_officers"
  | "tenant_users"
  | "tenant_field_schema";

/**
 * Wraps a Supabase client so every access to a tenant table is automatically
 * scoped to `tenantId`: reads/updates/deletes get `.eq('tenant_id', …)` and
 * inserts get `tenant_id` injected. This is the app-layer backstop behind RLS —
 * ALL tenant-table access in Server Actions/Components should go through it.
 */
export function tdb(supabase: DB, tenantId: string) {
  return {
    select(table: TenantTable, columns = "*") {
      return supabase.from(table).select(columns).eq("tenant_id", tenantId);
    },
    insert(
      table: TenantTable,
      values: Record<string, unknown> | Record<string, unknown>[],
    ) {
      const stamp = (v: Record<string, unknown>) => ({ ...v, tenant_id: tenantId });
      const payload = Array.isArray(values) ? values.map(stamp) : stamp(values);
      // Cast: the hand-authored Database type can't narrow per-table inserts.
      return supabase.from(table).insert(payload as never);
    },
    update(table: TenantTable, values: Record<string, unknown>) {
      return supabase
        .from(table)
        .update(values as never)
        .eq("tenant_id", tenantId);
    },
    delete(table: TenantTable) {
      return supabase.from(table).delete().eq("tenant_id", tenantId);
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/supabase/db.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/db.ts
git commit -m "feat(db): tdb() tenant-scoped query helper"
```

---

## Task 14: Profile view shim — `lib/profile.ts`

**Files:**
- Create: `lib/profile.ts`

- [ ] **Step 1: Create `lib/profile.ts`**

```ts
import type { Chapter, Profile, ProfileWithChapter } from "@/lib/types";

/**
 * TGP's fraternal custom-field keys. Foundation-era compat shim: these are
 * flattened onto the profile view so existing pages keep reading `.alexis_name`
 * etc. Sub-project 5 replaces this with schema-driven field rendering.
 */
export const TGP_FRATERNAL_KEYS = [
  "alexis_name",
  "batch_name",
  "date_survived",
  "gt_name",
  "gt_number",
  "mww_name",
  "mww_number",
  "contact_number",
] as const;

type ProfileRow = Profile & {
  chapter?: Pick<Chapter, "id" | "name" | "district" | "region"> | null;
};

/** Flatten `custom_fields` onto named props for the authed-app view type. */
export function toProfileView(row: ProfileRow): ProfileWithChapter {
  const cf = row.custom_fields ?? {};
  return {
    ...row,
    chapter: row.chapter ?? null,
    alexis_name: cf.alexis_name ?? null,
    batch_name: cf.batch_name ?? null,
    date_survived: cf.date_survived ?? null,
    gt_name: cf.gt_name ?? null,
    gt_number: cf.gt_number ?? null,
    mww_name: cf.mww_name ?? null,
    mww_number: cf.mww_number ?? null,
    contact_number: cf.contact_number ?? null,
  };
}

/** Inverse: build a `custom_fields` object from profile-form inputs (nulls/empties dropped). */
export function fraternalToCustomFields(input: {
  alexisName: string | null;
  batchName: string | null;
  dateSurvived: string | null;
  gtName: string | null;
  gtNumber: string | null;
  mwwName: string | null;
  mwwNumber: string | null;
  contactNumber: string | null;
}): Record<string, string> {
  const map: Record<string, string | null> = {
    alexis_name: input.alexisName,
    batch_name: input.batchName,
    date_survived: input.dateSurvived,
    gt_name: input.gtName,
    gt_number: input.gtNumber,
    mww_name: input.mwwName,
    mww_number: input.mwwNumber,
    contact_number: input.contactNumber,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v != null && v !== "") out[k] = v;
  }
  return out;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/profile.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/profile.ts
git commit -m "feat(profile): custom_fields <-> named-field view shim"
```

---

## Task 15: `lib/auth.ts` — tenant-aware auth context

**Files:**
- Modify: `lib/auth.ts` (full rewrite)

- [ ] **Step 1: Replace `lib/auth.ts`**

```ts
import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";
import { isTenantAdminRole } from "@/lib/constants";
import { toProfileView } from "@/lib/profile";
import type { Profile, ProfileWithChapter, Tenant, TenantRole } from "@/lib/types";

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: Tenant;
  role: TenantRole | null;
  profile: ProfileWithChapter | null;
}

/**
 * Loads the verified user, the active tenant, the user's membership role in
 * that tenant, and their (flattened) profile. Memoised per request. Uses
 * `getUser()` (server-verified) for authorization-grade identity.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenant = await getActiveTenant();

  const [membershipResult, profileResult] = await Promise.all([
    supabase
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("*, chapter:chapters!profiles_chapter_id_fkey(*)")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;

  const row = profileResult.data as
    | (Profile & { chapter: ProfileWithChapter["chapter"] })
    | null;

  return {
    user: { id: user.id, email: user.email ?? null },
    tenant,
    role: (membershipResult.data?.role as TenantRole | null) ?? null,
    profile: row ? toProfileView(row) : null,
  };
});

/** Require an authenticated user; redirect to /login otherwise. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** Require a tenant admin/owner (or platform admin); redirect/forbid otherwise. */
export async function requireTenantAdmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!isTenantAdminRole(auth.role)) forbidden();
  return auth;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `lib/auth.ts` clean; remaining errors only in `lib/actions/*` and the four pages (next tasks).

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "feat(auth): tenant-aware getAuth + requireTenantAdmin"
```

---

## Task 16: `lib/actions/profile.ts` — write to custom_fields

**Files:**
- Modify: `lib/actions/profile.ts`

- [ ] **Step 1: Update imports**

After the existing imports, add:

```ts
import { getActiveTenant } from "@/lib/tenant/context";
import { fraternalToCustomFields } from "@/lib/profile";
```

- [ ] **Step 2: Rewrite the `updateProfile` DB write**

In `updateProfile`, replace the block from `const supabase = await createClient();` down to the
`if (error) return { error: error.message };` line with:

```ts
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const tenant = await getActiveTenant();

  // Fraternal/custom fields are stored in custom_fields (the tenant's schema).
  // Privileged columns (status/member_id/chapter/tenant) are guarded by a DB
  // trigger, so this can only ever touch the member's own biographical fields.
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      batch_year: parsed.data.batchYear,
      custom_fields: fraternalToCustomFields({
        alexisName: parsed.data.alexisName,
        batchName: parsed.data.batchName,
        dateSurvived: parsed.data.dateSurvived,
        gtName: parsed.data.gtName,
        gtNumber: parsed.data.gtNumber,
        mwwName: parsed.data.mwwName,
        mwwNumber: parsed.data.mwwNumber,
        contactNumber: parsed.data.contactNumber,
      }),
    })
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
```

(`uploadAvatar` is unchanged — it writes `photo_url` scoped by `user_id`, which RLS already
restricts to the owner.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/actions/profile.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/profile.ts
git commit -m "feat(profile): persist fraternal fields into custom_fields"
```

---

## Task 17: `lib/actions/admin.ts` — tenant-scoped admin authority

**Files:**
- Modify: `lib/actions/admin.ts`

- [ ] **Step 1: Update imports**

Replace `import type { AppRole, MemberStatus } from "@/lib/types";` with:

```ts
import { getActiveTenant } from "@/lib/tenant/context";
import type { MemberStatus, TenantRole } from "@/lib/types";
```

- [ ] **Step 2: Rewrite `getAdminClient` → `getAdminContext` (tenant-scoped)**

Replace the entire `getAdminClient` function with:

```ts
/**
 * Re-verifies tenant-admin authority inside every action against the ACTIVE
 * tenant's membership. Page guards do NOT protect Server Actions, so this is
 * the real enforcement boundary (backed by RLS, which independently rejects
 * non-admin writes).
 */
async function getAdminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const tenant = await getActiveTenant();

  const { data, error } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .single();
  if (error) throw new Error("Unauthorized");

  const role = data?.role as TenantRole | undefined;
  if (!role || (role !== "admin" && role !== "owner")) {
    throw new Error("Forbidden");
  }
  return { supabase, user, tenant, role };
}
```

- [ ] **Step 3: Update each action to use `getAdminContext` + tenant scoping**

Apply these edits (each action currently calls `await getAdminClient()`):

`setMemberStatus`, `assignChapter`, `regenerateSlug`, `setCardActive` — change
`const { supabase } = await getAdminClient();` to
`const { supabase, tenant } = await getAdminContext();` and add `.eq("tenant_id", tenant.id)`
to every `.from("profiles" | "nfc_cards")` mutation/select in those functions. For example,
`setMemberStatus`'s update becomes:

```ts
  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", profileId)
    .eq("tenant_id", tenant.id);
```

Apply the same `.eq("tenant_id", tenant.id)` addition to:
- `assignChapter` → the `profiles` update.
- `regenerateSlug` → the `profiles` select, the `nfc_cards` select, and both `nfc_cards`
  update/insert (for the insert, also add `tenant_id: tenant.id` to the inserted object:
  `.insert({ profile_id: profileId, slug, tenant_id: tenant.id })`).
- `setCardActive` → the `nfc_cards` update.

`createChapter`, `updateChapter`, `deleteChapter`, `setChapterOfficer` — change to
`const { supabase, tenant } = await getAdminContext();`. For `createChapter`'s insert, add
`tenant_id`:

```ts
  const { error } = await supabase
    .from("chapters")
    .insert({ name, district: district || null, region: region || null, tenant_id: tenant.id });
```

and add `.eq("tenant_id", tenant.id)` to the `chapters` update/delete in `updateChapter`,
`deleteChapter`, and `setChapterOfficer`.

`setDistrictOfficer` — change to `getAdminContext`, and scope the district by tenant:

```ts
export async function setDistrictOfficer(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const district = required(formData, "district");
  const raw = formData.get("officerId");
  const officerId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = officerId
    ? await supabase
        .from("district_officers")
        .upsert(
          { district, officer_id: officerId, tenant_id: tenant.id },
          { onConflict: "tenant_id,district" },
        )
    : await supabase
        .from("district_officers")
        .delete()
        .eq("tenant_id", tenant.id)
        .eq("district", district);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
}
```

- [ ] **Step 4: Rewrite `setMemberRole` for `tenant_users`**

Roles now live in `tenant_users`. Replace the whole `setMemberRole` function with:

```ts
/** Change a member's tenant role — owners only. */
export async function setMemberRole(formData: FormData): Promise<void> {
  const { supabase, tenant, role } = await getAdminContext();
  if (role !== "owner") {
    throw new Error("Only an Owner can change roles.");
  }
  const profileId = required(formData, "profileId");
  const newRole = required(formData, "role") as TenantRole;
  if (!["member", "admin", "owner"].includes(newRole)) {
    throw new Error("Invalid role");
  }

  // Resolve the target user from their profile (scoped to this tenant).
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("id", profileId)
    .eq("tenant_id", tenant.id)
    .single();
  if (targetError || !target) throw new Error("Member not found");

  const { error } = await supabase
    .from("tenant_users")
    .update({ role: newRole })
    .eq("tenant_id", tenant.id)
    .eq("user_id", target.user_id);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/actions/admin.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/admin.ts
git commit -m "feat(admin): tenant-scoped admin authority + role via tenant_users"
```

---

## Task 18: Pages — read role from membership; flatten target profile

**Files:**
- Modify: `app/(app)/layout.tsx`
- Modify: `app/(app)/admin/layout.tsx`
- Modify: `app/(app)/profile/page.tsx`
- Modify: `app/(app)/admin/members/[id]/page.tsx`

- [ ] **Step 1: `app/(app)/layout.tsx` — admin flag from role**

Replace `import { isAdminRole, SITE } from "@/lib/constants";` with:

```ts
import { isTenantAdminRole, SITE } from "@/lib/constants";
```

This layout calls `requireUser()`/`getAuth()` and currently passes `isAdminRole(profile?.role)`.
Change the `AppNav` prop to use the membership role from the auth context. Find the destructure
of the auth result and ensure `role` is included, then:

```tsx
      <AppNav isAdmin={isTenantAdminRole(role)} />
```

(If the file destructures `const { profile } = await requireUser();`, change it to
`const { profile, role } = await requireUser();`.)

- [ ] **Step 2: `app/(app)/admin/layout.tsx` — requireTenantAdmin + role label**

Replace:

```ts
import { requireAdmin } from "@/lib/auth";
import { ROLE_META } from "@/lib/constants";
```

with:

```ts
import { requireTenantAdmin } from "@/lib/auth";
import { TENANT_ROLE_META } from "@/lib/constants";
```

Change `const { profile } = await requireAdmin();` to `const { profile, role } = await requireTenantAdmin();`
(keep `profile` in the destructure in case the layout uses it elsewhere — e.g. an avatar/name)
and change the label render `{ROLE_META[profile?.role ?? "admin"].label}` to:

```tsx
          {TENANT_ROLE_META[role ?? "admin"].label}
```

- [ ] **Step 3: `app/(app)/profile/page.tsx` — role label from auth**

Replace `import { ROLE_META, STATUS_META } from "@/lib/constants";` with:

```ts
import { STATUS_META } from "@/lib/constants";
import { TENANT_ROLE_META } from "@/lib/constants";
```

Change the destructure `const { profile, user } = auth;` to `const { profile, user, role } = auth;`
and change the registry Role line:

```ts
    { label: "Role", value: TENANT_ROLE_META[role ?? "member"].label },
```

(The `defaults` object already reads `profile?.alexis_name` etc.; these now resolve via the
flattened `ProfileWithChapter` view from `getAuth()`, so no change is needed there.)

- [ ] **Step 4: `app/(app)/admin/members/[id]/page.tsx` — flatten target + role dropdown**

Four changes:

(a) Update imports — replace:

```ts
import { MEMBER_STATUSES, ROLE_META, STATUS_META } from "@/lib/constants";
```

with:

```ts
import { MEMBER_STATUSES, STATUS_META, TENANT_ROLE_META } from "@/lib/constants";
import { toProfileView } from "@/lib/profile";
import type { TenantRole } from "@/lib/types";
```

(b) Replace the `ROLE_OPTIONS` constant with tenant roles:

```ts
const ROLE_OPTIONS = [
  { value: "member", label: TENANT_ROLE_META.member.label },
  { value: "admin", label: TENANT_ROLE_META.admin.label },
  { value: "owner", label: TENANT_ROLE_META.owner.label },
];
```

(c) Change the acting-admin role check and flatten the target profile. Replace:

```ts
  const isSuperAdmin = auth?.profile?.role === "super_admin";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*, chapter:chapters!profiles_chapter_id_fkey(*)")
    .eq("id", id)
    .maybeSingle<ProfileWithChapter>();
  if (profileError) throw profileError;
  if (!profile) notFound();
```

with:

```ts
  const isOwner = auth?.role === "owner";

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("*, chapter:chapters!profiles_chapter_id_fkey(*)")
    .eq("id", id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profileRow) notFound();
  const profile = toProfileView(profileRow as Parameters<typeof toProfileView>[0]);

  // The target member's tenant role (for the role <select> default).
  const { data: targetMembership } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", profile.tenant_id)
    .eq("user_id", profile.user_id)
    .maybeSingle();
  const targetRole = (targetMembership?.role as TenantRole) ?? "member";
```

(d) In the role-management JSX, replace `isSuperAdmin` with `isOwner`, and replace the two
`profile.role` references (`defaultValue={profile.role}` and `{ROLE_META[profile.role].label}`)
with `targetRole` / `TENANT_ROLE_META[targetRole].label`:

```tsx
                    defaultValue={targetRole}
```
```tsx
                    {TENANT_ROLE_META[targetRole].label}
```

(The `cardData` and `fraternalRecord` blocks already read `profile.alexis_name` etc.; these now
resolve via the flattened `profile`, so they need no change.)

- [ ] **Step 5: Typecheck — must be fully clean now**

Run: `npx tsc --noEmit`
Expected: **no errors** anywhere.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/layout.tsx" "app/(app)/admin/layout.tsx" "app/(app)/profile/page.tsx" "app/(app)/admin/members/[id]/page.tsx"
git commit -m "feat(app): read role from tenant membership; flatten profile views"
```

---

## Task 19: Full verification + final commit

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build completes successfully (no type or compile errors).

- [ ] **Step 3: Confirm the unchanged surfaces still compile against the new types**

Verify there are **no** remaining references to removed symbols:

```bash
grep -rns -E "isAdminRole|ROLE_META\b|AppRole|requireAdmin\b|is_admin\b|is_super_admin\b" app components lib
```

Expected: **no matches** (all replaced). If any remain, fix them and re-run Steps 1–2.

- [ ] **Step 4: Re-run the DB isolation probe (regression)**

Re-run `supabase/tests/0007_isolation_checks.sql` in the SQL Editor.
Expected: all `OK` notices, no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 5: Manual smoke (the foundation must not regress TGP)**

With `npm run dev` and a bootstrapped owner account (see Task 8 bootstrap notes):
1. Register a new member → confirm a `pending` TGP profile + a `tenant_users(member)` row exist.
2. As owner, approve the member at `/admin` → a `TGP-NNNN` `member_id` and an NFC card are created.
3. Open `/id/<slug>` → the public card renders with fraternal fields and (if a chapter/district
   officer is set) the "Call officer to verify" contact.
4. Edit the member's profile at `/profile` → fraternal fields persist (now in `custom_fields`).

Record the results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: tenant foundation verified (typecheck, build, isolation probe)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 schema → Tasks 2–3; §2 helpers → Task 4; §3 RLS → Task 7; §4 RPC → Task 6;
  §5 triggers → Task 5; §6 app layer → Tasks 10–18; §7 seeds → Task 8; §10 verification → Tasks 1, 9, 19.
- **Out of scope confirmed absent:** no domain resolution, no `/[tenant]/id` route, no tenant-management UI.
- **Type consistency:** `getAdminContext` (not `getAdminClient`) used consistently in Task 17;
  `toProfileView`/`fraternalToCustomFields` signatures match between Tasks 14, 15, 16, 18;
  `TENANT_ROLE_META`/`isTenantAdminRole` names consistent across Tasks 11, 15, 18; RPC return shape
  matches `MemberCard` (Task 10) and the untouched ID page.
- **Known intentional deviation from spec wording:** the RPC keeps its existing flat return shape
  (sourced from JSONB) rather than emitting a generic `public_fields jsonb` — reconciled in spec §4
  to honor the "no new UI" scope; the schema-driven renderer is deferred.
