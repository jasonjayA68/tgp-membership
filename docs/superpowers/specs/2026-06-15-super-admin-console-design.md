# Super-Admin / Onboarding Console — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #4 of 6 in the "Organization SaaS OS" upgrade (follows [[saas-os-roadmap]] #1–#3)

---

## Context

The platform layer's **data foundation already exists** from Sub-project #1: a `platform_admins`
table, the `is_platform_admin()` helper, and RLS that already lets a platform admin
`insert`/`update`/`delete` `tenants` and write `tenant_users` (the `tenants_insert/update/delete`
and `tenant_users_write` policies). What's missing is the **app layer**: there is no `/platform`
route, no `requirePlatformAdmin` guard, and creating a tenant / assigning an owner / suspending a
tenant is still done by hand in the SQL editor.

This sub-project builds the **super-admin console** — the "see and manage tenant organizations"
surface the user originally asked for. It is almost entirely app-layer work on top of the existing
DB primitives, plus one small RPC for the one thing the client cannot do (look up a user by email,
since `auth.users` isn't RLS-readable).

**Custom-domain verification + TLS + host resolution is explicitly OUT of scope** — that is a
separable subsystem (#4b) with external dependencies (DNS challenge, Vercel Domains API). This
spec is the console + tenant lifecycle only.

## Decisions locked during brainstorming

1. **Scope:** console + tenant lifecycle — list tenants (with member counts), create a tenant,
   assign/change its owner, suspend/reactivate, platform stats. Custom-domain verification → #4b.
2. **Owner assignment:** assign an owner by the **email of an existing account**, via a
   platform-admin-gated `SECURITY DEFINER` RPC that looks up `auth.users`. No invites/email infra.
3. **Branding edits allowed (added):** the tenant detail page lets the platform admin set
   `logo_url` / `primary_color` / `secondary_color` as **plain text inputs** — enough to fix the
   verify-card logo now. The full theming/upload/live-preview experience remains #5.

---

## 1. Access & routing

New global route tree `app/platform/…` (above all tenants), guarded by a new
**`requirePlatformAdmin()`**:

- It is **tenant-independent** — it uses `getSessionUser()` + a `platform_admins` membership check,
  **NOT** `getAuth()` (which requires an active tenant header and returns null on a global route).
- Behavior: no session → redirect `/login`; authenticated non-platform-admin → `forbidden()`.

Routes:
- `/platform` — the console (stats + tenant list + create-tenant form).
- `/platform/tenants/[id]` — tenant detail (owner assignment, suspend/reactivate, branding).

The #2 middleware already passes global routes through (session refresh + spoofed-header strip);
`/platform`'s own layout enforces the guard. `/platform` is not a `/t/[slug]` path, so none of the
tenant-resolution logic touches it.

## 2. Database — migration `0010_platform_console.sql`

Two `SECURITY DEFINER` (`search_path = public`) RPCs, **each gated** by
`if not public.is_platform_admin() then raise exception 'forbidden'; end if;`:

- **`assign_tenant_owner(p_tenant_id uuid, p_email text) returns void`** —
  - validate the tenant exists (`raise exception 'unknown tenant %'` otherwise);
  - resolve the user from `auth.users` by `lower(email) = lower(p_email)` **ignoring soft-deleted
    rows** (`deleted_at is null`); raise `'no account found for %'` if none and
    `'multiple accounts found for %'` if more than one (don't silently pick);
  - `insert into tenant_users (tenant_id, user_id, role) values (p_tenant_id, v_uid, 'owner')
     on conflict (tenant_id, user_id) do update set role = 'owner'` (promotes an existing member);
  - write an `audit_logs` row (`action 'owner_assigned'`, `performed_by = auth.uid()`,
    `target_user = v_uid`) — owner assignment is the highest-privilege tenant action and is audited
    like the others.
  **No profile is created** — the owner's access is role-based (`tenant_users`); a profile is
  optional and they create one through the normal flow. (Creating an `active` profile with no
  `member_id` would be a state the normal member flow never produces.) Granted to `authenticated`.

- **`platform_tenant_stats() returns table (tenant_id uuid, member_count bigint, active_count bigint)`** —
  `select t.id, count(p.id), count(p.id) filter (where p.status = 'active') from tenants t
   left join profiles p on p.tenant_id = t.id group by t.id`. One aggregate round-trip instead of
  N per-tenant counts. Granted to `authenticated`.

`revoke all from public; grant execute to authenticated` on both. **No other DB change** — create
tenant and suspend/reactivate and branding edits all go through the normal authed client (RLS
`tenants_insert`/`tenants_update` already allow platform admins).

## 3. Console UI (follows existing `/admin` patterns + components)

- **`/platform` (`app/platform/page.tsx`):**
  - Stat cards: total tenants, total members, total active members (summed from
    `platform_tenant_stats`).
  - Tenant table: name, slug, status badge, member/active counts, "Manage" link to the detail page.
    Reads `tenants` (RLS returns all for a platform admin) joined in-app with `platform_tenant_stats`.
  - "New organization" form: name, slug, member-ID prefix (inline-state form like `createChapter`).
- **`/platform/tenants/[id]` (`app/platform/tenants/[id]/page.tsx`):**
  - Header: name, slug, status, created date, member/active counts.
  - **Owners/admins list:** the tenant's `tenant_users` rows with role `owner`/`admin`, paired with
    each user's profile **name** for display via a two-step lookup (`tenant_users` then `profiles`
    by `user_id` — there's no FK between them, and email lives in `auth.users` which isn't
    RLS-readable, so name + role is what's shown).
  - **Assign owner** form: email input → `assignTenantOwner`.
  - **Suspend / Reactivate** toggle → `setTenantStatus`.
  - **Branding** form: `logo_url`, `primary_color`, `secondary_color` text inputs →
    `updateTenantBranding` (plain column writes; full theming UX is #5).
- **Layout (`app/platform/layout.tsx`):** calls `requirePlatformAdmin()`, renders a minimal
  platform nav + heading.

## 4. Server actions (`lib/actions/platform.ts` — each re-checks `is_platform_admin`)

A shared `getPlatformContext()` (verifies session user + platform-admin) mirrors the admin actions'
`getAdminContext` pattern. Actions:
- `createTenant(prev, formData)` — validate `name` (≥2), `slug` (lowercase `[a-z0-9-]`, unique),
  `member_id_prefix` (uppercase, short); `insert into tenants`; returns `{error|notice}`.
- `setTenantStatus(formData)` — `tenantId` + `status` ∈ {`active`,`suspended`}; `update tenants`.
- `assignTenantOwner(prev, formData)` — `tenantId` + `email`; calls `assign_tenant_owner` RPC;
  maps the RPC's "no account" error to a friendly message.
- `updateTenantBranding(prev, formData)` — `tenantId` + optional `logo_url`/`primary_color`/
  `secondary_color`; `update tenants`.
Each `revalidatePath('/platform')` (+ the detail path) as appropriate.

## 5. Deliberate boundaries (YAGNI)

- **No hard delete** in the UI — suspend only (deletion cascades to all members/cards; stays a
  manual SQL operation).
- **No rename / no slug or prefix edit** — slug and prefix are URL/member-ID load-bearing; set once
  at creation. (Branding columns are editable per Decision #3; identity columns are not.)
- **First platform admin stays SQL-bootstrapped** (chicken-and-egg). Managing *co*-platform-admins
  is out of scope.
- New tenants start with an **empty `tenant_field_schema`** (members have core fields only until a
  schema editor exists — a later concern).
- Branding inputs here are **raw column writes**; applying `primary/secondary_color` across the app
  UI, custom seal, typography, uploads, and live preview is **#5**. Setting `logo_url` does
  immediately fix the public verify-card logo (#3 already reads it).

## 6. Out of scope (later sub-projects)

Custom-domain verification + TLS + host-based resolution (**#4b**); full branding/theming editor +
homepage CMS (**#5**); email invites; platform-admin member management.

## 7. Files

- **New:** `supabase/migrations/0010_platform_console.sql`,
  `supabase/tests/0010_platform_checks.sql`, `lib/platform.ts` (`requirePlatformAdmin`,
  `getPlatformContext`, `listTenantsWithStats`), `lib/actions/platform.ts`,
  `app/platform/layout.tsx`, `app/platform/page.tsx`, `app/platform/tenants/[id]/page.tsx`,
  and small presentational components as needed (e.g. `components/platform/*`).
- **Updated:** `lib/types.ts` (`assign_tenant_owner` + `platform_tenant_stats` in
  `Database.Functions`; a `TenantStats` type). Optionally a link to `/platform` from the app nav
  for platform admins (small, can be deferred).

## 8. Verification

1. `0010` applies; probe confirms: a platform admin can `assign_tenant_owner` by email (creates an
   `owner` membership + active profile; promotes an existing member); an unknown email raises; a
   **non**-platform-admin calling either RPC is rejected; `platform_tenant_stats` returns correct
   per-tenant counts.
2. `tsc` + `build` clean.
3. Manual runbook: as the bootstrapped platform admin, open `/platform` → see TGP + Org-B with
   counts; create a new tenant; assign an owner by the email of an existing account; that owner logs
   in and lands in the new workspace as owner; suspend the tenant → its `/t/[slug]` shows the
   "suspended" page; set TGP's `logo_url` and confirm the verify card shows it. As a
   non-platform-admin, `/platform` is forbidden.
