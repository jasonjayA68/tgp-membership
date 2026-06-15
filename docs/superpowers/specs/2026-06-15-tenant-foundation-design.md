# Tenant Foundation — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #1 of 6 in the "Organization SaaS OS" upgrade

---

## Context

The current system is a clean, single-tenant **Tau Gamma Phi (TGP)** digital membership
registry on Next.js 16 (App Router, `proxy.ts`) + Supabase (Auth, Postgres, RLS, Storage).
Today's data model is hard-wired to TGP: fixed fraternal columns on `profiles`
(`alexis_name`, `batch_name`, `date_survived`, `gt_name/number`, `mww_name/number`,
`contact_number`), `TGP-NNNN` member IDs, seeded councils, and a single public anon RPC
`get_member_card(slug)` that is the only anonymous read path. Roles
(`super_admin | admin | member`) are global columns on `profiles`, enforced through
`SECURITY DEFINER` helpers (`is_admin`, `is_super_admin`) and a hardened
`protect_profile_columns` trigger.

This sub-project converts that foundation to **multi-tenant** so any organization can become
an isolated tenant. It is the load-bearing wall for the five sub-projects that follow
(tenant resolution middleware, NFC tenant-aware routing, super-admin/onboarding console,
branding + homepage CMS, dynamic dashboard engine). Those are **out of scope here.**

## Decisions locked during brainstorming

1. **Member schema** — *Shared core columns + per-tenant JSONB.* Universal fields stay real
   columns; org-specific fields move into `profiles.custom_fields jsonb`, described by a
   per-tenant `tenant_field_schema`. TGP's fraternal fields migrate into its own schema.
2. **Membership model** — *Slack-style multi-org.* One login can belong to many tenants.
   Role lives in `tenant_users` (`owner | admin | member`), per tenant. A separate
   **platform super-admin** (the SaaS operator) sits above all tenants.
3. **RLS scoping** — *Membership RLS + enforced app filter.* RLS allows rows for any tenant
   the user is a member of; the app always narrows to the active tenant through a single
   typed data-access helper so it can't be forgotten. Membership is the hard backstop.
4. **Data state** — *Pre-launch / disposable.* Clean migration: `tenant_id NOT NULL` from
   the start, TGP reseeded as tenant #1. No backfill gymnastics.
5. **Scope** — *Pure foundation.* DB + RLS + auth/tenant context plumbing + seeds. **No new
   UI.** The app keeps serving TGP via a default active tenant (real domain resolution is
   Sub-project 2). Verified via SQL probes + a throwaway second tenant proving isolation.

One explicit call: `contact_number` moves into `custom_fields` with the rest of the
fraternal fields; the verify-officer RPC reads it from JSONB. (Confirmed.)

---

## 1. Schema

### New tables

**`tenants`**

| column | type | notes |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| name | text not null | |
| slug | text not null unique | lowercased; URL-safe |
| custom_domain | text unique null | for Sub-project 2 |
| status | `tenant_status` enum | `active | suspended | onboarding`, default `active` |
| plan_type | text not null default `'free'` | |
| member_id_prefix | text not null | e.g. `TGP` |
| member_seq | int not null default 0 | per-tenant member numbering counter |
| logo_url | text null | branding (no UI yet; avoids later migration) |
| primary_color | text null | branding |
| secondary_color | text null | branding |
| created_at | timestamptz not null default now() | |

**`platform_admins`** — SaaS operators, above all tenants.

| column | type | notes |
|---|---|---|
| user_id | uuid pk → auth.users on delete cascade | |
| created_at | timestamptz not null default now() | |

**`tenant_users`** — authoritative membership + role.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null → tenants on delete cascade | |
| user_id | uuid not null → auth.users on delete cascade | |
| role | `tenant_role` enum | `owner | admin | member`, default `member` |
| created_at | timestamptz not null default now() | |
| | | `unique(tenant_id, user_id)` |

**`tenant_field_schema`** — defines each tenant's custom member fields.

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null → tenants on delete cascade | |
| key | text not null | JSONB key in `profiles.custom_fields` |
| label | text not null | display label |
| type | text not null | `text | date | number | phone` (extensible) |
| is_public | boolean not null default false | surfaced by `get_member_card` |
| sort_order | int not null default 0 | |
| | | `unique(tenant_id, key)` |

### Reworked tables (all gain `tenant_id NOT NULL → tenants`)

**`profiles`**
- **Drops** `role` (moves to `tenant_users`).
- **Drops** fraternal columns → migrated into new `custom_fields jsonb not null default '{}'`:
  `alexis_name, batch_name, date_survived, gt_name, gt_number, mww_name, mww_number,
  contact_number`.
- **Keeps** `full_name, member_id, chapter_id, batch_year, status, photo_url, created_at,
  updated_at`.
- Uniqueness: `unique(user_id)` → **`unique(tenant_id, user_id)`**; `member_id` →
  **`unique(tenant_id, member_id)`**.

**`chapters`** — `unique(name)` → **`unique(tenant_id, name)`**. Keeps `verify_officer_id`.

**`nfc_cards`** — gains `tenant_id`. `slug` stays **globally unique** (random suffix; keeps the
anon lookup a single-key probe).

**`audit_logs`** — gains `tenant_id`.

**`district_officers`** — gains `tenant_id`; `district` pk → **`unique(tenant_id, district)`**
(needs a surrogate `id` pk).

### Enums

- New: `tenant_status (active, suspended, onboarding)`, `tenant_role (owner, admin, member)`.
- `member_status` unchanged.
- `app_role` removed (superseded by `tenant_role` + `platform_admins`).

## 2. Isolation helpers (`SECURITY DEFINER`, `search_path = public`)

Replace global `is_admin()` / `is_super_admin()` with tenant-scoped helpers:

- `is_platform_admin()` → exists in `platform_admins` for `auth.uid()`.
- `is_tenant_member(tid uuid)` → exists in `tenant_users(user_id=auth.uid(), tenant_id=tid)`.
- `is_tenant_admin(tid uuid)` → role in (`owner`,`admin`) for `tid` **OR** `is_platform_admin()`.
- `is_tenant_owner(tid uuid)` → role = `owner` for `tid` **OR** `is_platform_admin()`.
- `next_member_id(tid uuid)` → atomically bumps `tenants.member_seq` and returns
  `prefix || '-' || lpad(seq, 4, '0')`.

## 3. RLS policies

Anon keeps **zero** direct table access; `get_member_card` remains the only anon path.
General pattern per tenant table:

- **SELECT** — `is_tenant_member(tenant_id)` (plus owner-row shortcuts where relevant).
- **INSERT** — `with check (is_tenant_member(tenant_id) AND …)`.
- **UPDATE** — `is_tenant_admin(tenant_id)` (or self for own profile).
- **DELETE** — `is_tenant_owner(tenant_id)`.

Per table:
- **profiles** — select own (`user_id=auth.uid()`) or `is_tenant_admin`; insert self
  (`user_id=auth.uid()` + membership + `status='pending'`); update own or admin; delete owner.
- **chapters / tenant_field_schema / district_officers** — select member, write admin.
- **nfc_cards** — select own (via profile) or admin; write admin.
- **audit_logs** — select admin only; writes only via `SECURITY DEFINER` triggers (no INSERT policy).
- **tenants** — select if member or platform admin; insert/delete platform admin; update
  platform admin (owner-updates-own-branding deferred to Sub-project 5).
- **tenant_users** — select own rows + tenant admin; write tenant admin or platform admin.
- **platform_admins** — select/write platform admin only.

## 4. Public verification (tenant-aware, JSONB-sourced, shape-stable)

`get_member_card(card_slug)` is rewritten to be **tenant-aware** and to source fraternal values
from `custom_fields` — but it **keeps its existing return shape** (the same named columns the
public ID page already consumes: `full_name, member_id, alexis_name, batch_name, date_survived,
gt_name, gt_number, mww_name, mww_number, chapter, district, region, batch_year, status,
photo_url, card_active, verify_contact_name, verify_contact_number`). This proves the
JSONB-backed model end-to-end **without touching `app/id/[slug]/page.tsx`** — honoring the
"no new UI / TGP unchanged" scope (Decision #5). Internally:
1. Update scan counters, then resolve the card → profile → tenant.
2. Read fraternal fields as `custom_fields ->> '<key>'` (date cast for `date_survived`).
3. Verify-officer contact (chapter officer → district officer fallback) read from the officer's
   `custom_fields->>'contact_number'`; the district join is scoped by `tenant_id`.

A fully **schema-driven** renderer (generic `public_fields jsonb` filtered by
`tenant_field_schema.is_public`, with a generic ID page) is **deferred** to the NFC-tenant-aware
/ CMS sub-projects, where multi-tenant card rendering is actually in scope.
`revoke all from public; grant execute to anon, authenticated`.

## 5. Triggers (reworked)

- **`handle_new_user`** — reads `tenant_id` from signup metadata (defaults to TGP this
  sub-project); creates the `tenant_users(member)` + `profiles(status=pending)` pair; lands
  metadata custom fields into `custom_fields`.
- **`protect_profile_columns`** — `tenant_id` immutable; non-admins still cannot change
  `status / member_id / chapter_id`; `member_id` auto-assigns via `next_member_id(tenant_id)`
  on activation. Role guard removed (role no longer on profiles).
- **`handle_profile_change`** — audit-log rows + NFC-card provisioning now stamp `tenant_id`.

## 6. App layer (the RLS backstop)

- **`lib/tenant/context.ts`** — `getActiveTenant()` cached per request. Returns TGP by default
  now; this is the seam Sub-project 2's middleware plugs into.
- **`lib/tenant/types.ts`** — `Tenant`, `TenantRole`, `TenantFieldSchema`, membership types.
- **`lib/supabase/db.ts`** — `tdb(client, tenantId)` typed wrapper: `.from(table)`
  auto-applies `.eq('tenant_id', …)` on read/update/delete and injects `tenant_id` on insert.
  **All data access goes through it.**
- **`lib/auth.ts`** — `getAuth()` returns `{ user, tenant, role, profile }` (role from
  `tenant_users`, profile scoped to active tenant). `requireAdmin` → `requireTenantAdmin`.
- **`lib/profile.ts`** — `toProfileView()` compat shim: flattens `custom_fields` back onto the
  `ProfileWithChapter` view (named `alexis_name`, etc.) so existing pages keep reading
  `.alexis_name`; `fraternalToCustomFields()` does the inverse for writes. (Replaced by
  schema-driven rendering in a later sub-project.)
- **`lib/constants.ts`, `lib/types.ts`** — role helpers + types updated.
- **`lib/actions/*`** — use `tdb()`/tenant context; `app/id/[slug]/page.tsx` is **unchanged**
  (RPC shape preserved).

## 7. Seeds

- **TGP** — slug `tgp`, prefix `TGP`, councils as chapters, the 8 fraternal fields as
  `tenant_field_schema` rows (correct `is_public` flags matching current public exposure).
- **Org-B** — throwaway, slug `org-b`, prefix `ORG`, a trivial 1–2 field schema, to prove isolation.
- Bootstrap note: register an account, then `insert into platform_admins` + a TGP
  `tenant_users(owner)` row (replaces the old "set role=super_admin" bootstrap).

## 8. Files

- **New:** `supabase/migrations/0007_tenant_foundation.sql`, `lib/tenant/context.ts`,
  `lib/tenant/types.ts`, `lib/supabase/db.ts`.
- **New (also):** `lib/profile.ts` (view shim).
- **Updated:** `lib/auth.ts`, `lib/constants.ts`, `lib/types.ts`, `lib/actions/admin.ts`,
  `lib/actions/profile.ts`, and the pages reading `profile.role` / fraternal fields
  (`app/(app)/layout.tsx`, `app/(app)/admin/layout.tsx`, `app/(app)/profile/page.tsx`,
  `app/(app)/admin/members/[id]/page.tsx`). `lib/actions/auth.ts` and `app/id/[slug]/page.tsx`
  need **no** changes (signup metadata keys + RPC shape are preserved).

## 9. Out of scope (later sub-projects)

Domain/subpath tenant resolution (2), `/[tenant]/id/[slug]` routing (3), create-tenant /
onboarding UI + domain verification (4), branding + homepage CMS (5), dynamic dashboard +
feature flags (6).

## 10. Verification

1. Migration applies clean on a fresh DB; app `next build` passes.
2. SQL probes as **anon**, **TGP member**, **Org-B member** prove no cross-tenant read; an
   Org-B admin cannot see TGP rows and vice versa.
3. `get_member_card` for a TGP card returns only TGP data, with fraternal fields intact
   (sourced from `custom_fields`, same return shape as before).
4. Existing TGP flows (register → approve → activate → NFC card → public scan) work unchanged.
