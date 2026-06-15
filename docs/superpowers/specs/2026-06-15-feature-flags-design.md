# Per-Tenant Feature Flags — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #6 of the "Organization SaaS OS" upgrade (follows [[saas-os-roadmap]] #1–#5b)

---

## Context

The original mega-spec's #6 was "dynamic widget dashboard engine + feature flags for NFC /
attendance / messaging / announcements / analytics." Four of those five modules **don't exist**, and
the member dashboard is a fixed ~3-widget portal — so a widget-layout engine and flags for
nonexistent modules would be speculative (YAGNI). This sub-project delivers the **valuable,
non-speculative core**: per-tenant feature flags that toggle the **real optional modules**, so each
organization configures its own feature set and the nav + relevant surfaces adapt.

## Decisions locked during brainstorming

1. **Scope:** feature flags for the real optional modules only. **Cut** the widget-dashboard engine
   and flags for nonexistent modules.
2. **Control:** **tenant-admin self-serve** — each org's owner/admin toggles their own modules from a
   new `/t/[slug]/admin/settings` page. (No platform entitlement ceiling.)
3. **Flag set:** four flags — `chapters`, `audit`, `homepage`, `verify_officer`. All **default on**
   (existing tenants, incl. TGP, are unaffected).
4. **Storage:** a `feature_flags` table with `is_tenant_admin` write RLS (tenant admins write their
   own; `tenants` is platform-admin-write only, so flags can't live there).
5. **Non-destructive:** disabling a module hides its UI/routes; underlying data is never deleted and
   re-enabling restores it.

---

## 1. Storage — migration `0013_feature_flags.sql`

- **`feature_flags`** table: `id uuid pk, tenant_id uuid not null → tenants on delete cascade,
  feature_key text not null, enabled boolean not null, updated_at timestamptz not null default
  now()`, `unique(tenant_id, feature_key)`. RLS: `select = is_tenant_member(tenant_id)`,
  `write (for all) = is_tenant_admin(tenant_id)`. Anon has no direct access.
- A row exists only when a tenant **overrides** a default; a **missing key = the catalog default**.
- The two public RPCs that drive anon surfaces gain one flag each so disabling takes effect publicly:
  - `get_member_card` → add `verify_officer_enabled boolean` =
    `coalesce((select enabled from feature_flags f where f.tenant_id = p.tenant_id and
    f.feature_key = 'verify_officer'), true)`.
  - `get_tenant_homepage` → add `homepage_enabled boolean` (same shape, key `'homepage'`).
  Both are additive re-declarations of the existing pure-read RPCs.

## 2. Catalog + helper — `lib/features.ts` (pure, Node-testable)

```ts
export const FEATURES = [
  { key: "chapters",       label: "Chapters & Districts",   default: true },
  { key: "audit",          label: "Audit Log",              default: true },
  { key: "homepage",       label: "Public Homepage",        default: true },
  { key: "verify_officer", label: "Verify-officer contact", default: true },
] as const;
export type FeatureKey = (typeof FEATURES)[number]["key"];
```
`isFeatureEnabled(flags: Record<string, boolean>, key: FeatureKey): boolean` =
`flags[key] ?? <catalog default for key>`. Pure (no imports); a `lib/features.check.mts` Node test
(tsconfig-excluded, like the others) asserts: missing key → default true, explicit `false` overrides,
explicit `true` stays.

## 3. Server access — `lib/tenant/features.ts`

- `getActiveTenantFeatures(): Promise<Record<string, boolean>>` — cached per request: reads the
  active tenant's `feature_flags` rows (authed client; RLS member-read) into a key→enabled map.
- `requireFeature(key: FeatureKey): Promise<void>` — reads the map; `notFound()` if the feature is
  disabled. The functional gate for routes (not just hiding the nav link).

## 4. Settings UI + action

- **`app/(app)/admin/settings/page.tsx`** (`requireTenantAdmin`) loads `getActiveTenantFeatures()`
  and renders a `FeatureSettings` client component: the `FEATURES` catalog as labeled toggles,
  prefilled (default-on when unset).
- **`lib/actions/settings.ts` `setTenantFeature(formData)`** — re-verify tenant admin; validate
  `key` ∈ catalog + `enabled` boolean; `upsert feature_flags (tenant_id, feature_key, enabled)
  on conflict (tenant_id, feature_key) do update`. `revalidatePath` the workspace.
- A **"Settings"** link is added to `components/admin/admin-nav.tsx`.

## 5. Gating (each flag — UI **and** functional)

| flag off | hides nav | route guard | other surfaces |
|---|---|---|---|
| `chapters` | Chapters | `/admin/chapters` → `notFound` (`requireFeature`) | hide the chapter-assignment control on `admin/members/[id]` |
| `audit` | Audit Log | `/admin/audit` → `notFound` | — |
| `homepage` | Homepage | `/admin/homepage` → `notFound` | public `/t/[slug]/home` → `notFound` (via `homepage_enabled`) |
| `verify_officer` | — | — | hide officer assignment on the chapters page; verify card omits the "call officer" CTA (via `verify_officer_enabled`) |

`components/admin/admin-nav.tsx` becomes server-aware of the flag map (the admin layout passes the
enabled set as a prop; the nav filters `chapters`/`audit`/`homepage` links). Gated server routes call
`requireFeature`.

## 6. Out of scope

The dynamic widget-dashboard engine; flags for nonexistent modules (attendance/messaging/analytics);
platform-admin entitlement ceilings; gating core modules (Members, Profile, NFC/cards). The
fraternal-record chapter rows on the member dashboard are **not** separately gated (they already show
"—" when no chapter is assigned) — keeping the chapters gate to nav + route + assignment control.

## 7. Files

- **New:** `supabase/migrations/0013_feature_flags.sql`, `supabase/tests/0013_feature_flags_checks.sql`,
  `lib/features.ts`, `lib/features.check.mts`, `lib/tenant/features.ts`, `lib/actions/settings.ts`,
  `components/admin/feature-settings.tsx`, `app/(app)/admin/settings/page.tsx`.
- **Updated:** `tsconfig.json` (exclude the new `.mts`), `lib/types.ts` (`feature_flags` table + the
  two RPC return additions + a `FeatureFlag` type), `components/admin/admin-nav.tsx` (Settings link +
  flag-aware filtering), `app/(app)/admin/layout.tsx` (load + pass the flag map),
  `app/(app)/admin/chapters/page.tsx` + `app/(app)/admin/audit/page.tsx` +
  `app/(app)/admin/homepage/page.tsx` (`requireFeature`), `app/(app)/admin/members/[id]/page.tsx`
  (hide chapter assignment when off), `app/t/[tenant]/home/page.tsx` (404 when `homepage_enabled`
  false), `app/t/[tenant]/id/[slug]/page.tsx` (CTA respects `verify_officer_enabled`), `MemberCard`
  + `HomepageResult` types (the two new fields).

## 8. Verification

1. `0013` probe: a tenant admin upserts a `feature_flags` row; a non-admin member's write is RLS-
   blocked; `get_member_card`/`get_tenant_homepage` return `verify_officer_enabled`/`homepage_enabled`
   defaulting `true` (no row) and `false` when a row sets it off.
2. `lib/features.check.mts` (Node): `isFeatureEnabled` defaults true for a missing key; `false`/`true`
   overrides honored.
3. `tsc` + `build` clean.
4. Manual runbook: as an Org-B admin, open `/t/org-b/admin/settings` → turn **Homepage** off → the
   Homepage nav link disappears and `/t/org-b/home` 404s; turn **Audit Log** off → its nav + route
   gone; turn **verify-officer** off → an Org-B verify card drops the "call officer" CTA; re-enable
   each → restored; TGP (no rows) is unchanged with everything on.
