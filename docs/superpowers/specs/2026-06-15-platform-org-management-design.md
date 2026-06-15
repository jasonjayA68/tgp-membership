# Platform Org Management — CRUD + Logo Upload + Logout — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** Platform-console enhancement (follows #7b Part A; same `feat/platform-login-redirect`
branch). See [[saas-os-roadmap]], [[saas-two-plane-hierarchy]].

---

## Context

The `/platform` super-admin console can create tenants, assign owners, suspend/reactivate, manage
custom domains, and edit branding (colors + a raw `logo_url` text field). It lacks: **editing** an
org's core fields, **deleting** an org, **uploading** a logo (only a URL paste today), and a
**sign-out** button. This sub-project adds those. Supabase **Storage is already in use** (member
avatars: `avatars` bucket + `storage.objects` policies in `0001`/`0007`, upload flow in
`lib/actions/profile.ts`), so logo upload mirrors a proven pattern. `signOut` already exists
(`lib/actions/auth.ts`).

## Decisions locked during brainstorming

1. **Delete = soft delete (archive).** A new `archived` tenant status; data is preserved and
   restorable. No hard delete.
2. **Edit fields:** `name`, `member_id_prefix`, **and `slug`** — slug editable **with a clear UI
   warning** that it breaks existing `/t/<old-slug>` links/QR codes (custom domains unaffected).
3. **Logo upload to Storage**, replacing the URL field. The migration **creates the `branding`
   bucket** (like `avatars`).
4. **Archived scope:** workspace **blocked** (middleware) + **hidden** from the console list (moved to
   an "Archived" section with Restore). **No** public NFC/homepage blackout for archived (mirrors the
   existing suspended-tenant policy) — out of scope.
5. **Sign-out button** in the console header.

---

## 1. Data + Storage — migration `0016_platform_org_mgmt.sql`

- **Enum:** `alter type public.tenant_status add value if not exists 'archived';` (the value is only
  *used* later at runtime by the archive action — never in this migration — so there is no
  same-transaction "unsafe use of new enum value" issue).
- **Storage bucket + policies** (mirror `avatars`, but writes gated to platform admins):
  ```sql
  insert into storage.buckets (id, name, public) values ('branding', 'branding', true)
  on conflict (id) do nothing;

  drop policy if exists branding_public_read on storage.objects;
  drop policy if exists branding_admin_insert on storage.objects;
  drop policy if exists branding_admin_update on storage.objects;
  drop policy if exists branding_admin_delete on storage.objects;

  create policy branding_public_read on storage.objects for select using (bucket_id = 'branding');
  create policy branding_admin_insert on storage.objects for insert
    with check (bucket_id = 'branding' and public.is_platform_admin());
  create policy branding_admin_update on storage.objects for update
    using (bucket_id = 'branding' and public.is_platform_admin());
  create policy branding_admin_delete on storage.objects for delete
    using (bucket_id = 'branding' and public.is_platform_admin());
  ```
  Public read (logos are public-facing); only platform admins write. Object path:
  `<tenantId>/logo-<stamp>.<ext>`.

## 2. `lib/types.ts`

- `TenantStatus` gains `"archived"`: `"active" | "suspended" | "onboarding" | "archived"`.

## 3. Actions — `lib/actions/platform.ts`

All use `getPlatformContext()` (platform-admin gate) + the authed client (tenants writes are
RLS-gated to platform admins) + an `audit_logs` insert. `PlatformState = { error?; notice? }`.

- **`updateTenant(_prev, formData)`** — `tenantId`, `name`, `slug`, `prefix`. Same validation as
  `createTenant` (`name ≥ 2`; slug `^[a-z0-9-]{2,40}$`; prefix `^[A-Z0-9]{2,8}$`). `update tenants set
  name, slug, member_id_prefix`. Map slug unique-violation (`23505`/"duplicate") → "That slug is
  already taken." Audit `tenant_updated`. `revalidatePath` the tenant page + `/platform`.
- **`archiveTenant(formData)` / `restoreTenant(formData)`** — void form actions: set `status =
  'archived'` / `'active'`; audit `tenant_archived` / `tenant_restored`; revalidate. (Distinct from
  `setTenantStatus`, which stays for suspend/reactivate.)
- **`uploadTenantLogo(_prev, formData)`** — `tenantId` + `logo` (File). Validate type
  (`image/png|jpeg|webp|svg+xml`) + size (≤ 2 MB). Upload to `branding` at
  `<tenantId>/logo-<Date.now()>.<ext>` (`upsert: true, contentType`); `getPublicUrl`; `update tenants
  set logo_url`; prune superseded files under `<tenantId>/` (avatar pattern). Audit
  `branding_updated`. Revalidate.
- **`removeTenantLogo(formData)`** — null `tenants.logo_url` (and remove the stored object(s)); audit
  `branding_updated`; revalidate.
- **`updateTenantBranding`** — **drops `logo_url`**; now only `primary_color` / `secondary_color`
  (logo is handled by the upload actions above).

## 4. UI

- **`components/platform/branding-form.tsx`** splits into two concerns:
  - **Logo:** current-logo preview (`Brandmark name logoUrl`), a `<form action={uploadTenantLogo}>`
    with `<input type="file" name="logo" accept="image/*">` + submit, and a "Remove logo"
    `<form action={removeTenantLogo}>`. (File uploads ride the FormData server-action path.)
  - **Colors:** the existing `updateTenantBranding` form (color pickers), minus the logo URL input.
- **`app/platform/(console)/tenants/[id]/page.tsx`:**
  - New **"Edit organization"** card — a client form (`EditOrgForm`) for `name` / `slug` / `prefix`
    via `updateTenant`, with an inline warning under the slug field.
  - **Danger zone:** an **Archive** button (`archiveTenant`) for an active org; a **Restore** button
    (`restoreTenant`) shown when the org is archived.
- **`app/platform/(console)/page.tsx`** (the list): partition tenants — active/suspended in the main
  list; **archived** rows in a separate "Archived organizations" section with a **Restore** button.
  (`listTenantsWithStats` already returns all; partition in the page.)
- **`app/platform/(console)/layout.tsx`:** add a **Sign out** button (`<form action={signOut}>`) in
  the header, beside the "Super Admin" label.

## 5. Middleware — `lib/supabase/proxy.ts`

Where the `/t/[slug]` branch already does `if (tenant.status === "suspended") → /workspace-suspended`,
add `if (tenant.status === "archived") → /workspace-not-found` (an archived org reads as gone). Host
mode needs no change: `resolve_tenant_by_host` already filters `status = 'active'`, so an archived
org's custom domain stops resolving automatically. (Public `/t/[slug]/id|home` passthroughs are left
as-is per the agreed scope — archived blocks the workspace, not the public pages.)

## 6. Verification

1. **`0016` probe (`supabase/tests/0016_platform_org_mgmt_checks.sql`)** — transactional: a tenant can
   be `update`d to `status='archived'` and back (enum accepts the value); `select 1 from
   storage.buckets where id='branding'` returns a row; the four `branding_*` policies exist
   (`select count(*) from pg_policies where policyname like 'branding_%'` = 4). Rolls back.
2. **`tsc` + `build`** clean.
3. **Manual runbook (super admin):** edit an org's name/prefix → reflected; change slug → warning
   shown, `/t/<new-slug>` works; **archive** an org → it leaves the main list into "Archived", its
   `/t/<slug>` workspace → not-found; **restore** → back in the main list and reachable; **upload a
   logo** → appears on that tenant's surfaces (verify card, workspace) and in the console; **remove
   logo** → falls back to the monogram; **Sign out** → returns to `/platform/login`. TGP and other
   orgs unaffected.

## 7. Files

- **New:** `supabase/migrations/0016_platform_org_mgmt.sql`,
  `supabase/tests/0016_platform_org_mgmt_checks.sql`, `components/platform/edit-org-form.tsx`.
- **Updated:** `lib/types.ts` (`TenantStatus`), `lib/actions/platform.ts` (`updateTenant`,
  `archiveTenant`, `restoreTenant`, `uploadTenantLogo`, `removeTenantLogo`; `updateTenantBranding`
  loses `logo_url`), `components/platform/branding-form.tsx` (logo upload + colors split),
  `app/platform/(console)/tenants/[id]/page.tsx` (edit card + archive/restore),
  `app/platform/(console)/page.tsx` (archived section), `app/platform/(console)/layout.tsx` (sign
  out), `lib/supabase/proxy.ts` (archived → not-found).

## 8. Out of scope (YAGNI)

Hard delete; image cropping/resizing (stored as-uploaded behind a type+size guard); public NFC/
homepage blackout for archived tenants (mirrors the existing suspended policy); bulk org operations;
per-tenant Storage quotas.
