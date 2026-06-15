# Per-Tenant Feature Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-tenant feature flags (chapters / audit / homepage / verify-officer) that tenant admins self-serve, gating each module's nav, routes, and surfaces — non-destructively, all default-on.

**Architecture:** A `feature_flags` table (tenant-admin write RLS) holds overrides; a missing row = the catalog default. A pure `lib/features.ts` catalog + `isFeatureEnabled` decides; `getActiveTenantFeatures()`/`requireFeature()` enforce server-side. The two anon RPCs (`get_member_card`, `get_tenant_homepage`) return one flag each so disabling takes effect on public surfaces.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), TypeScript. Node 24 runs the `.mts` catalog test (type-stripping).

---

## Environment & tooling notes (read first)

- **No test runner / no Supabase CLI.** Migration `0013` is applied manually in the Supabase SQL Editor (additive over `0007`–`0012`, already live). Verification = the SQL probe, `node lib/features.check.mts`, `npx tsc --noEmit`, `npm run build`, and a manual runbook (Task 7).
- Run all commands from repo root. The executor (subagent-driven skill) creates a feature branch first.
- Patterns to mirror: `lib/cms/blocks.ts` + `lib/cms/blocks.check.mts` + the `tsconfig.json` exclude (pure module + Node test); `lib/tenant/context.ts` (`cache()`d server helper); `lib/actions/admin.ts` (`getAdminContext` + void action); `components/admin/admin-nav.tsx` (the LINKS array); the `0011`/`0012` migrations (re-declaring the anon RPCs).
- `lib/features.ts` MUST stay pure (no imports) so the Node test can run it.

## File structure

- **New:** `supabase/migrations/0013_feature_flags.sql`, `supabase/tests/0013_feature_flags_checks.sql`, `lib/features.ts`, `lib/features.check.mts`, `lib/tenant/features.ts`, `lib/actions/settings.ts`, `components/admin/feature-settings.tsx`, `app/(app)/admin/settings/page.tsx`.
- **Modify:** `tsconfig.json` (exclude the `.mts`), `lib/types.ts` (`FeatureFlag` + `feature_flags` table + the two RPC return fields), `components/admin/admin-nav.tsx`, `app/(app)/admin/layout.tsx`, `app/(app)/admin/chapters/page.tsx`, `app/(app)/admin/audit/page.tsx`, `app/(app)/admin/homepage/page.tsx`, `app/(app)/admin/members/[id]/page.tsx`, `app/t/[tenant]/home/page.tsx`, `app/t/[tenant]/id/[slug]/page.tsx`.

---

## Task 1: Migration `0013` — feature_flags + RPC flags (+ probe)

**Files:**
- Create: `supabase/tests/0013_feature_flags_checks.sql`
- Create: `supabase/migrations/0013_feature_flags.sql`

- [ ] **Step 1: Write the probe (fails before migration)**

Create `supabase/tests/0013_feature_flags_checks.sql`:

```sql
-- Run in the Supabase SQL Editor AFTER applying 0013. Transactional; rolls back.
begin;

-- Defaults: no flag rows → enabled flags default true.
do $$
declare r record;
begin
  select * into r from public.get_tenant_homepage('tgp');
  if r.homepage_enabled is not true then raise exception 'FAIL: homepage default not true'; end if;
  raise notice 'OK: homepage_enabled defaults true';
end $$;

-- Setting a flag off is reflected by the RPC.
insert into public.feature_flags (tenant_id, feature_key, enabled)
select id, 'homepage', false from public.tenants where slug = 'tgp'
on conflict (tenant_id, feature_key) do update set enabled = excluded.enabled;

do $$
declare r record;
begin
  select * into r from public.get_tenant_homepage('tgp');
  if r.homepage_enabled is not false then raise exception 'FAIL: homepage flag off not honored'; end if;
  raise notice 'OK: homepage_enabled reflects the flag';
end $$;

-- verify_officer_enabled defaults true on a card with no flag row.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999999',
        'authenticated','authenticated','probe-ff@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb, false);
insert into public.nfc_cards (tenant_id, profile_id, slug)
select tenant_id, id, 'probe-card-0013'
from public.profiles where user_id = '99999999-9999-9999-9999-999999999999';

do $$
declare r record;
begin
  select * into r from public.get_member_card('probe-card-0013');
  if r.verify_officer_enabled is not true then raise exception 'FAIL: verify_officer default not true'; end if;
  raise notice 'OK: verify_officer_enabled defaults true';
end $$;

-- A non-admin tgp member cannot write feature_flags (RLS write = is_tenant_admin).
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
do $$
begin
  begin
    insert into public.feature_flags (tenant_id, feature_key, enabled)
    select id, 'probe-flag', true from public.tenants where slug = 'tgp';
    raise exception 'FAIL: non-admin wrote feature_flags';
  exception
    when insufficient_privilege then raise notice 'OK: RLS blocked non-admin write';
  end;
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Confirm it fails today**

Paste into the SQL Editor, Run. Expected: **FAIL** — `column "homepage_enabled" does not exist` (the RPC doesn't return it yet). Record that it errored.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0013_feature_flags.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0013: per-tenant feature flags
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007–0012. feature_flags table (tenant-admin write) + the two
-- public RPCs re-declared to return one flag each (default true when no row).
-- =============================================================================

create table if not exists public.feature_flags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, feature_key)
);
create index if not exists feature_flags_tenant_idx on public.feature_flags (tenant_id);

alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_select on public.feature_flags;
drop policy if exists feature_flags_write  on public.feature_flags;
create policy feature_flags_select on public.feature_flags for select
  using (public.is_tenant_member(tenant_id));
create policy feature_flags_write on public.feature_flags for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- ---- get_member_card + verify_officer_enabled -----------------------------
drop function if exists public.get_member_card(text) cascade;
create or replace function public.get_member_card(card_slug text)
returns table (
  full_name             text,
  member_id             text,
  batch_year            int,
  status                public.member_status,
  photo_url             text,
  chapter               text,
  district              text,
  region                text,
  card_active           boolean,
  verify_contact_name   text,
  verify_contact_number text,
  tenant_name           text,
  tenant_slug           text,
  tenant_logo_url       text,
  tenant_primary_color  text,
  tenant_secondary_color text,
  public_fields         jsonb,
  verify_officer_enabled boolean
)
language sql stable security definer set search_path = public as $$
  select p.full_name,
         p.member_id,
         p.batch_year,
         p.status,
         p.photo_url,
         c.name,
         c.district,
         c.region,
         n.active,
         coalesce(chap_officer.full_name, dist_officer.full_name),
         coalesce(nullif(chap_officer.custom_fields ->> 'contact_number', ''),
                  nullif(dist_officer.custom_fields ->> 'contact_number', '')),
         t.name,
         t.slug,
         t.logo_url,
         t.primary_color,
         t.secondary_color,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object('key', s.key, 'label', s.label,
                                       'type', s.type, 'value', p.custom_fields ->> s.key)
                    order by s.sort_order)
           from public.tenant_field_schema s
           where s.tenant_id = p.tenant_id and s.is_public
             and nullif(p.custom_fields ->> s.key, '') is not null
         ), '[]'::jsonb),
         coalesce((select f.enabled from public.feature_flags f
                    where f.tenant_id = p.tenant_id and f.feature_key = 'verify_officer'), true)
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  join public.tenants   t on t.id = p.tenant_id
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
$$;
revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;

-- ---- get_tenant_homepage + homepage_enabled -------------------------------
drop function if exists public.get_tenant_homepage(text) cascade;
create or replace function public.get_tenant_homepage(p_slug text)
returns table (
  tenant_name            text,
  tenant_slug            text,
  tenant_status          public.tenant_status,
  tenant_logo_url        text,
  tenant_primary_color   text,
  tenant_secondary_color text,
  content_json           jsonb,
  member_count           bigint,
  homepage_enabled       boolean
)
language sql stable security definer set search_path = public as $$
  select t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color,
         coalesce(p.content_json, '{"blocks":[]}'::jsonb),
         (select count(*) from public.profiles pr
           where pr.tenant_id = t.id and pr.status = 'active'),
         coalesce((select f.enabled from public.feature_flags f
                    where f.tenant_id = t.id and f.feature_key = 'homepage'), true)
  from public.tenants t
  left join public.tenant_pages p on p.tenant_id = t.id and p.page_type = 'home'
  where t.slug = p_slug;
$$;
revoke all on function public.get_tenant_homepage(text) from public;
grant execute on function public.get_tenant_homepage(text) to anon, authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0013_feature_flags_checks.sql supabase/migrations/0013_feature_flags.sql
git commit -m "feat(db): 0013 — feature_flags + verify_officer/homepage flags on RPCs"
```

---

## Task 2: Types — `FeatureFlag` + RPC fields

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `FeatureFlag` + the RPC fields**

In `lib/types.ts`, after the `TenantPage` type, add:

```ts
export type FeatureFlag = {
  id: string;
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  updated_at: string;
};
```

Add `verify_officer_enabled: boolean;` to the `MemberCard` type (after `public_fields`). Add
`homepage_enabled: boolean;` to the `HomepageResult` type (after `member_count`).

- [ ] **Step 2: Register the table**

In `Database.public.Tables`, add `feature_flags: Generated<FeatureFlag>;`. (The two RPC `Returns`
types already point at `MemberCard[]`/`HomepageResult[]`, which now include the new fields — no
`Functions` change needed.)

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean. (The verify/homepage pages **cast** the RPC results — `as MemberCard`/`as HomepageResult` — rather than building typed literals, and don't reference the new fields until Task 6, so adding the required fields doesn't break them.)

```bash
git add lib/types.ts
git commit -m "feat(types): FeatureFlag + verify_officer_enabled/homepage_enabled"
```

---

## Task 3: Catalog (pure) + Node test

**Files:**
- Create: `lib/features.ts`
- Create: `lib/features.check.mts`
- Modify: `tsconfig.json`

- [ ] **Step 0: Exclude the test script from `tsc`**

In `tsconfig.json`, add the new `.mts` to `"exclude"`:

```json
  "exclude": ["node_modules", "lib/branding/theme.check.mts", "lib/cms/blocks.check.mts", "lib/features.check.mts"]
```

- [ ] **Step 1: Write the failing test**

Create `lib/features.check.mts`:

```ts
import { isFeatureEnabled, FEATURES } from "./features.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

assert(FEATURES.length === 4, "four features");
assert(isFeatureEnabled({}, "homepage") === true, "missing key defaults true");
assert(isFeatureEnabled({ homepage: false }, "homepage") === false, "false override honored");
assert(isFeatureEnabled({ homepage: true }, "homepage") === true, "true stays true");
assert(isFeatureEnabled({ chapters: false }, "audit") === true, "unrelated key untouched");

console.log("OK: feature flag checks pass");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node lib/features.check.mts`
Expected: FAIL — `Cannot find module './features.ts'`.

- [ ] **Step 3: Implement `lib/features.ts`**

```ts
/** Pure feature-flag catalog + resolver (no imports — Node-testable). */

export const FEATURES = [
  {
    key: "chapters",
    label: "Chapters & Districts",
    description: "Chapter/district structure, member assignment, and verifying officers.",
  },
  { key: "audit", label: "Audit Log", description: "Record of administrative actions." },
  { key: "homepage", label: "Public Homepage", description: "The organization's public /home page." },
  {
    key: "verify_officer",
    label: "Verify-officer contact",
    description: "The 'call officer to verify' contact shown on member verification cards.",
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

const DEFAULTS: Record<FeatureKey, boolean> = {
  chapters: true,
  audit: true,
  homepage: true,
  verify_officer: true,
};

/** A flag is on unless a tenant has explicitly set it to false. */
export function isFeatureEnabled(flags: Record<string, boolean>, key: FeatureKey): boolean {
  return flags[key] ?? DEFAULTS[key];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node lib/features.check.mts`
Expected: `OK: feature flag checks pass`

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect: clean).

```bash
git add lib/features.ts lib/features.check.mts tsconfig.json
git commit -m "feat(features): feature-flag catalog + resolver (+ node test)"
```

---

## Task 4: Server access — `lib/tenant/features.ts`

**Files:**
- Create: `lib/tenant/features.ts`

- [ ] **Step 1: Create `lib/tenant/features.ts`**

```ts
import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";

import { isFeatureEnabled, type FeatureKey } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";

/** The active tenant's feature-flag overrides (key → enabled). Memoised per request. */
export const getActiveTenantFeatures = cache(async (): Promise<Record<string, boolean>> => {
  const tenant = await getActiveTenant();
  if (!tenant) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("feature_key, enabled")
    .eq("tenant_id", tenant.id);
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.feature_key] = row.enabled;
  return map;
});

/** Functional gate for a route: 404 if the active tenant has the feature disabled. */
export async function requireFeature(key: FeatureKey): Promise<void> {
  const flags = await getActiveTenantFeatures();
  if (!isFeatureEnabled(flags, key)) notFound();
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expect: clean).

```bash
git add lib/tenant/features.ts
git commit -m "feat(features): getActiveTenantFeatures + requireFeature"
```

---

## Task 5: Settings page + action

**Files:**
- Create: `lib/actions/settings.ts`
- Create: `components/admin/feature-settings.tsx`
- Create: `app/(app)/admin/settings/page.tsx`

- [ ] **Step 1: Create `lib/actions/settings.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { FEATURES } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";

/** Toggle a feature flag for the active tenant (tenant admin only). */
export async function setTenantFeature(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const tenant = await getActiveTenant();
  if (!tenant) throw new Error("No active tenant");

  const { data } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .single();
  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    throw new Error("Forbidden");
  }

  const key = String(formData.get("key") ?? "");
  if (!FEATURES.some((f) => f.key === key)) throw new Error("Unknown feature");
  const enabled = formData.get("enabled") === "true";

  const { error } = await supabase
    .from("feature_flags")
    .upsert(
      { tenant_id: tenant.id, feature_key: key, enabled, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,feature_key" },
    );
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePath("/admin");
}
```

- [ ] **Step 2: Create `components/admin/feature-settings.tsx`**

```tsx
import { CheckCircle2, Circle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { setTenantFeature } from "@/lib/actions/settings";
import { FEATURES, isFeatureEnabled } from "@/lib/features";

export function FeatureSettings({ flags }: { flags: Record<string, boolean> }) {
  return (
    <Card className="divide-y divide-border">
      {FEATURES.map((f) => {
        const on = isFeatureEnabled(flags, f.key);
        return (
          <div key={f.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{f.label}</div>
              <div className="text-xs text-muted-foreground">{f.description}</div>
            </div>
            <form action={setTenantFeature}>
              <input type="hidden" name="key" value={f.key} />
              <input type="hidden" name="enabled" value={(!on).toString()} />
              <SubmitButton size="sm" variant={on ? "secondary" : "outline"} pendingText="…">
                {on ? <CheckCircle2 /> : <Circle />}
                {on ? "Enabled" : "Disabled"}
              </SubmitButton>
            </form>
          </div>
        );
      })}
    </Card>
  );
}
```

- [ ] **Step 3: Create `app/(app)/admin/settings/page.tsx`**

```tsx
import type { Metadata } from "next";

import { FeatureSettings } from "@/components/admin/feature-settings";
import { requireTenantAdmin } from "@/lib/auth";
import { getActiveTenantFeatures } from "@/lib/tenant/features";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireTenantAdmin();
  const flags = await getActiveTenantFeatures();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="tgp-display text-xl font-bold tracking-tight">Modules</h2>
        <p className="text-sm text-muted-foreground">
          Enable or disable features for your organization. Changes apply immediately and never
          delete data.
        </p>
      </div>
      <FeatureSettings flags={flags} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expect: clean).

```bash
git add lib/actions/settings.ts components/admin/feature-settings.tsx "app/(app)/admin/settings/page.tsx"
git commit -m "feat(features): tenant-admin module settings page + toggle action"
```

---

## Task 6: Gating — nav, route guards, surfaces

**Files:**
- Modify: `components/admin/admin-nav.tsx`
- Modify: `app/(app)/admin/layout.tsx`
- Modify: `app/(app)/admin/chapters/page.tsx`
- Modify: `app/(app)/admin/audit/page.tsx`
- Modify: `app/(app)/admin/homepage/page.tsx`
- Modify: `app/(app)/admin/members/[id]/page.tsx`
- Modify: `app/t/[tenant]/home/page.tsx`
- Modify: `app/t/[tenant]/id/[slug]/page.tsx`

- [ ] **Step 1: `components/admin/admin-nav.tsx` — flag-aware links + Settings**

Replace the file with a version that takes a `features` map, filters flagged links, and adds Settings:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Building2, ScrollText, LayoutTemplate, Settings } from "lucide-react";

import { isFeatureEnabled, type FeatureKey } from "@/lib/features";
import { tenantHref } from "@/lib/tenant/links";
import { cn } from "@/lib/utils";

const LINKS: {
  href: string;
  label: string;
  icon: typeof Users;
  exact?: boolean;
  feature?: FeatureKey;
}[] = [
  { href: "/admin", label: "Members", icon: Users, exact: true },
  { href: "/admin/chapters", label: "Chapters", icon: Building2, feature: "chapters" },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText, feature: "audit" },
  { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate, feature: "homepage" },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminNav({
  basePath,
  features,
}: {
  basePath: string;
  features: Record<string, boolean>;
}) {
  const pathname = usePathname();
  const membersHref = tenantHref(basePath, "/admin/members");
  const links = LINKS.filter((l) => !l.feature || isFeatureEnabled(features, l.feature));

  return (
    <nav className="flex flex-wrap gap-1.5">
      {links.map((link) => {
        const href = tenantHref(basePath, link.href);
        const active = link.exact
          ? pathname === href || pathname.startsWith(membersHref)
          : pathname === href || pathname.startsWith(href + "/");
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-gold/40 bg-gold/15 text-gold-bright"
                : "border-border text-muted-foreground hover:border-gold/30 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: `app/(app)/admin/layout.tsx` — load + pass the flag map**

Add the import and load the flags, then pass to `AdminNav`:

```tsx
import { getActiveTenantFeatures } from "@/lib/tenant/features";
```

```tsx
  const { role } = await requireTenantAdmin();
  const basePath = await getActiveTenantBasePath();
  const features = await getActiveTenantFeatures();
```

```tsx
      <AdminNav basePath={basePath} features={features} />
```

- [ ] **Step 3: Route guards on the gated admin pages**

In each of these three pages, add the import and call `requireFeature` as the FIRST line of the
component (before any data loading):

`app/(app)/admin/chapters/page.tsx`:
```tsx
import { requireFeature } from "@/lib/tenant/features";
// …inside the component, first line:
  await requireFeature("chapters");
```
`app/(app)/admin/audit/page.tsx`:
```tsx
import { requireFeature } from "@/lib/tenant/features";
  await requireFeature("audit");
```
`app/(app)/admin/homepage/page.tsx`:
```tsx
import { requireFeature } from "@/lib/tenant/features";
  await requireFeature("homepage");
```

- [ ] **Step 4: `app/(app)/admin/members/[id]/page.tsx` — hide chapter assignment when off**

Add the imports:
```tsx
import { isFeatureEnabled } from "@/lib/features";
import { getActiveTenantFeatures } from "@/lib/tenant/features";
```
Load the flags near the top of the component (after `requireTenantAdmin`/the existing auth):
```tsx
  const features = await getActiveTenantFeatures();
  const chaptersEnabled = isFeatureEnabled(features, "chapters");
```
Find the JSX block that renders the **chapter assignment** control (the `ActionSelect`/`FieldRow`
wired to the `assignChapter` action — read the file to locate it) and wrap that whole block in
`{chaptersEnabled && ( … )}`. (Leave the read-only chapter display in the ID-card/fraternal area
alone; only the *assignment control* is gated.)

- [ ] **Step 5: `app/t/[tenant]/home/page.tsx` — 404 when homepage disabled**

After `const home = await getHomepage(tenant); if (!home) notFound();`, add:
```tsx
  if (!home.homepage_enabled) notFound();
```

- [ ] **Step 6: `app/t/[tenant]/id/[slug]/page.tsx` — CTA respects verify_officer**

Find the verify-officer CTA conditional (currently `{card.verify_contact_number && (`) and add the
flag:
```tsx
        {card.verify_contact_number && card.verify_officer_enabled && (
```

- [ ] **Step 7: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed — the new `MemberCard`/`HomepageResult`
fields are now consumed/produced consistently).

```bash
git add components/admin/admin-nav.tsx "app/(app)/admin/layout.tsx" "app/(app)/admin/chapters/page.tsx" "app/(app)/admin/audit/page.tsx" "app/(app)/admin/homepage/page.tsx" "app/(app)/admin/members/[id]/page.tsx" "app/t/[tenant]/home/page.tsx" "app/t/[tenant]/id/[slug]/page.tsx"
git commit -m "feat(features): gate nav, routes, and surfaces by feature flags"
```

---

## Task 7: Verification + manual runbook

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Static gates**

Run: `node lib/features.check.mts` (expect `OK`), `npx tsc --noEmit` (clean), `npm run build` (success; confirm `/admin/settings` appears).

- [ ] **Step 2: Apply migration `0013` (human, Supabase SQL Editor)**

Paste `supabase/migrations/0013_feature_flags.sql` → Run. Then `supabase/tests/0013_feature_flags_checks.sql`
→ expect only `OK` notices (homepage default+override, verify_officer default, **RLS non-admin write blocked**),
no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 3: Manual dev runbook (human)**

`npm run dev`, as an **Org-B admin**:
1. Open `/t/org-b/admin/settings` → see the four module toggles, all Enabled.
2. Turn **Homepage** off → the Homepage link disappears from the admin nav, `/t/org-b/admin/homepage`
   404s, and `/t/org-b/home` (logged-out) 404s. Re-enable → all restored.
3. Turn **Audit Log** off → its nav link + `/t/org-b/admin/audit` are gone.
4. Turn **Chapters** off → Chapters nav + `/admin/chapters` gone; on a member's detail page the
   chapter-assignment control is hidden.
5. Turn **Verify-officer** off → an Org-B member's verify card no longer shows the "call officer to
   verify" CTA. Re-enable → it returns.
6. **TGP** (no flag rows) is unchanged — everything on.

Record results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 4: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "chore: feature flags verified (catalog test, build, probe, runbook)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 DB → Task 1; §2 catalog → Task 3; §3 server access → Task 4; §4 settings → Task 5; §5 gating → Task 6; §7 types → Task 2; §8 verification → Tasks 1, 3, 7.
- **Catalog is genuinely tested** (Task 3, Node): default-true on missing key, false/true overrides, unrelated-key isolation.
- **Type consistency:** `FEATURES`/`FeatureKey`/`isFeatureEnabled` (Task 3) consumed by `lib/tenant/features.ts` (4), the settings action+component (5), and the admin-nav + member page (6); `getActiveTenantFeatures`/`requireFeature` (4) consumed by Tasks 5–6; `MemberCard.verify_officer_enabled`/`HomepageResult.homepage_enabled` (Task 2) produced by the RPCs (Task 1) and consumed by the verify/homepage pages (Task 6); `AdminNav({basePath, features})` (6) matches its caller in the admin layout (6).
- **Defaults / non-destructive:** missing flag row = default-on (so TGP and all existing tenants are unaffected); toggles only upsert a boolean; no data is deleted.
- **Out of scope confirmed absent:** no widget-dashboard engine, no flags for nonexistent modules, no platform entitlement ceiling, no gating of core modules. The dashboard fraternal chapter rows are intentionally not gated.
