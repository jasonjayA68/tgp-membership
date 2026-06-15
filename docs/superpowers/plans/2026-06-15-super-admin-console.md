# Super-Admin / Onboarding Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global `/platform` super-admin console — list/create tenants, assign owners by email, suspend/reactivate, edit branding, and view platform stats — replacing the manual SQL bootstrap for tenant lifecycle.

**Architecture:** Purely additive on top of existing RLS (platform admins can already `insert`/`update` `tenants` and write `tenant_users`). One migration adds two platform-admin-gated `SECURITY DEFINER` RPCs (`assign_tenant_owner` for the email→user lookup, `platform_tenant_stats` for counts). A `requirePlatformAdmin()` guard (tenant-independent, via `getSessionUser` + `platform_admins`) protects `app/platform/*`. No existing files break — it's all new.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), `@supabase/ssr`, TypeScript.

---

## Environment & tooling notes (read first)

- **No test runner / no Supabase CLI.** Migration `0010` is applied **manually in the Supabase SQL Editor** (additive over `0007`–`0009`, already live). Verification = a runnable SQL probe, `npx tsc --noEmit`, `npm run build`, and a manual runbook (Task 9).
- Run all commands from repo root: `/Users/jasonjayababao/tgp-membership`. The executor (subagent-driven skill) creates a feature branch first.
- **This sub-project is additive** — it adds new files only; no existing route/file is modified except `lib/types.ts` (RPC signatures). So `tsc` stays clean after each task as long as tasks run in order.
- Patterns to mirror: `lib/actions/admin.ts` (`getAdminContext` + inline-state actions), `components/admin/chapter-form.tsx` (`useActionState` form), `app/(app)/admin/page.tsx` (stat cards + table), `lib/auth.ts` (`getSessionUser`, the two-step `listMemberships`).

## File structure

- **New:** `supabase/migrations/0010_platform_console.sql`, `supabase/tests/0010_platform_checks.sql`, `lib/platform.ts`, `lib/actions/platform.ts`, `components/platform/tenant-status-badge.tsx`, `components/platform/create-tenant-form.tsx`, `components/platform/assign-owner-form.tsx`, `components/platform/branding-form.tsx`, `app/platform/layout.tsx`, `app/platform/page.tsx`, `app/platform/tenants/[id]/page.tsx`.
- **Modify:** `lib/types.ts` (add `TenantStats` + the two RPCs to `Database.Functions`).

---

## Task 1: Migration `0010` — platform RPCs (+ probe)

**Files:**
- Create: `supabase/tests/0010_platform_checks.sql`
- Create: `supabase/migrations/0010_platform_console.sql`

- [ ] **Step 1: Write the probe (fails before migration)**

Create `supabase/tests/0010_platform_checks.sql`:

```sql
-- Run in the Supabase SQL Editor AFTER applying 0010. Transactional; rolls back.
begin;

-- Platform admin (A) and a prospective owner (B).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
 ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555',
  'authenticated','authenticated','probe-padmin@test.dev','', now(), now(), now(), '{}','{}', false),
 ('00000000-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666',
  'authenticated','authenticated','probe-owner@test.dev','', now(), now(), now(), '{}','{}', false);

insert into public.platform_admins (user_id) values ('55555555-5555-5555-5555-555555555555');
insert into public.tenants (name, slug, member_id_prefix) values ('Probe Org', 'probe-org-0010', 'PRB');

-- As platform admin A: assign B as owner by email.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select public.assign_tenant_owner(
  (select id from public.tenants where slug = 'probe-org-0010'), 'probe-owner@test.dev');

do $$
declare r text; p int;
begin
  select role::text into r from public.tenant_users
   where user_id = '66666666-6666-6666-6666-666666666666'
     and tenant_id = (select id from public.tenants where slug='probe-org-0010');
  if r is distinct from 'owner' then raise exception 'FAIL: B is not owner (%)', r; end if;
  select count(*) into p from public.profiles
   where user_id = '66666666-6666-6666-6666-666666666666'
     and tenant_id = (select id from public.tenants where slug='probe-org-0010');
  if p <> 1 then raise exception 'FAIL: owner profile missing (count=%)', p; end if;
  raise notice 'OK: assign_tenant_owner made B an owner with a profile';
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.platform_tenant_stats();
  if n < 1 then raise exception 'FAIL: platform_tenant_stats empty'; end if;
  raise notice 'OK: platform_tenant_stats returned % tenant(s)', n;
end $$;

reset role;

-- As a NON-platform-admin (B): both RPCs must be rejected.
set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
do $$
begin
  begin
    perform * from public.platform_tenant_stats();
    raise exception 'FAIL: non-admin allowed platform_tenant_stats';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.assign_tenant_owner(
      (select id from public.tenants where slug='probe-org-0010'), 'probe-owner@test.dev');
    raise exception 'FAIL: non-admin allowed assign_tenant_owner';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  raise notice 'OK: non-platform-admin rejected by both RPCs';
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Confirm it fails today**

Paste into the SQL Editor, Run. Expected: **FAIL** — `function public.assign_tenant_owner(...) does not exist`. Record that it errored.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0010_platform_console.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0010: Platform console RPCs
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007–0009. Two platform-admin-gated SECURITY DEFINER RPCs:
--  * assign_tenant_owner — look up auth.users by email (not RLS-readable) and
--    make that user the tenant's owner (+ ensure a profile).
--  * platform_tenant_stats — per-tenant member/active counts in one round-trip.
-- Tenant create / suspend / branding need NO RPC (RLS already allows platform
-- admins to insert/update tenants via the authed client).
-- =============================================================================

drop function if exists public.assign_tenant_owner(uuid, text) cascade;
drop function if exists public.platform_tenant_stats()         cascade;

create or replace function public.assign_tenant_owner(p_tenant_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then raise exception 'no account found for %', p_email; end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (p_tenant_id, v_uid, 'owner')
  on conflict (tenant_id, user_id) do update set role = 'owner';

  insert into public.profiles (tenant_id, user_id, status)
  values (p_tenant_id, v_uid, 'active')
  on conflict (tenant_id, user_id) do nothing;
end $$;

revoke all on function public.assign_tenant_owner(uuid, text) from public;
grant execute on function public.assign_tenant_owner(uuid, text) to authenticated;

create or replace function public.platform_tenant_stats()
returns table (tenant_id uuid, member_count bigint, active_count bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;

  return query
  select t.id,
         count(p.id),
         count(p.id) filter (where p.status = 'active')
  from public.tenants t
  left join public.profiles p on p.tenant_id = t.id
  group by t.id;
end $$;

revoke all on function public.platform_tenant_stats() from public;
grant execute on function public.platform_tenant_stats() to authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0010_platform_checks.sql supabase/migrations/0010_platform_console.sql
git commit -m "feat(db): 0010 — platform console RPCs (assign_tenant_owner, platform_tenant_stats)"
```

---

## Task 2: Types — `TenantStats` + RPC signatures

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the `TenantStats` type**

In `lib/types.ts`, after the `Tenant` type, add:

```ts
/** Per-tenant aggregate from `platform_tenant_stats`. */
export type TenantStats = {
  tenant_id: string;
  member_count: number;
  active_count: number;
};
```

- [ ] **Step 2: Register the RPCs in `Database.Functions`**

In `lib/types.ts`, inside `Database.public.Functions`, add:

```ts
      assign_tenant_owner: {
        Args: { p_tenant_id: string; p_email: string };
        Returns: undefined;
      };
      platform_tenant_stats: { Args: Record<string, never>; Returns: TenantStats[] };
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add lib/types.ts
git commit -m "feat(types): TenantStats + platform RPC signatures"
```

---

## Task 3: Platform data helpers — `lib/platform.ts`

**Files:**
- Create: `lib/platform.ts`

- [ ] **Step 1: Create `lib/platform.ts`**

```ts
import "server-only";

import { forbidden, redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Tenant, TenantRole } from "@/lib/types";

/**
 * Page/layout guard: require a platform admin. Tenant-independent — it does NOT
 * use getAuth() (which needs an active tenant). No session → /login; an
 * authenticated non-platform-admin → forbidden().
 */
export async function requirePlatformAdmin(): Promise<{
  id: string;
  email: string | null;
}> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) forbidden();
  return user;
}

export type TenantWithStats = Tenant & {
  member_count: number;
  active_count: number;
};

/** All tenants + per-tenant counts (platform admin reads all via RLS). */
export async function listTenantsWithStats(): Promise<TenantWithStats[]> {
  const supabase = await createClient();
  const [tenantsResult, statsResult] = await Promise.all([
    supabase.from("tenants").select("*").order("created_at", { ascending: true }),
    supabase.rpc("platform_tenant_stats"),
  ]);
  if (tenantsResult.error) throw tenantsResult.error;
  if (statsResult.error) throw statsResult.error;

  const statsById = new Map((statsResult.data ?? []).map((s) => [s.tenant_id, s]));
  return (tenantsResult.data ?? []).map((t) => {
    const s = statsById.get(t.id);
    return {
      ...(t as Tenant),
      member_count: Number(s?.member_count ?? 0),
      active_count: Number(s?.active_count ?? 0),
    };
  });
}

export type TenantAdmin = { user_id: string; role: TenantRole; name: string };

/** A tenant's owners/admins with display names (two-step; no FK / no email). */
export async function listTenantAdmins(tenantId: string): Promise<TenantAdmin[]> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "admin"]);
  if (error) throw error;
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .eq("tenant_id", tenantId)
    .in("user_id", ids);
  const nameByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role as TenantRole,
    name: nameByUser.get(r.user_id) || "—",
  }));
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add lib/platform.ts
git commit -m "feat(platform): requirePlatformAdmin + tenant stats/admins helpers"
```

---

## Task 4: Platform server actions — `lib/actions/platform.ts`

**Files:**
- Create: `lib/actions/platform.ts`

- [ ] **Step 1: Create `lib/actions/platform.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { TenantStatus } from "@/lib/types";

export type PlatformState = { error?: string; notice?: string };

/** Re-verify platform-admin authority inside every action (the real boundary). */
async function getPlatformContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
  return { supabase, user };
}

/** Create a new tenant (name + slug + member-id prefix). */
export async function createTenant(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const prefix = String(formData.get("prefix") ?? "").trim().toUpperCase();

  if (name.length < 2) return { error: "Enter an organization name." };
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    return { error: "Slug must be 2–40 lowercase letters, numbers, or hyphens." };
  }
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
    return { error: "Prefix must be 2–8 uppercase letters or numbers." };
  }

  const { error } = await supabase
    .from("tenants")
    .insert({ name, slug, member_id_prefix: prefix });
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "That slug is already taken."
        : error.message,
    };
  }
  revalidatePath("/platform");
  return { notice: `Organization “${name}” created.` };
}

/** Suspend / reactivate a tenant. */
export async function setTenantStatus(formData: FormData): Promise<void> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  const status = String(formData.get("status") ?? "") as TenantStatus;
  if (!tenantId || (status !== "active" && status !== "suspended")) {
    throw new Error("Invalid request");
  }
  const { error } = await supabase
    .from("tenants")
    .update({ status })
    .eq("id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/platform");
  revalidatePath(`/platform/tenants/${tenantId}`);
}

/** Assign (or promote) a tenant owner by the email of an existing account. */
export async function assignTenantOwner(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  if (!tenantId) return { error: "Missing tenant." };
  if (!email) return { error: "Enter the owner’s email." };

  const { error } = await supabase.rpc("assign_tenant_owner", {
    p_tenant_id: tenantId,
    p_email: email,
  });
  if (error) {
    return {
      error: error.message.includes("no account")
        ? "No account found for that email — they must register first."
        : error.message,
    };
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: `Owner assigned to ${email}.` };
}

/** Set a tenant's raw branding columns (full theming UX is Sub-project #5). */
export async function updateTenantBranding(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const clean = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v.length ? v : null;
  };
  const { error } = await supabase
    .from("tenants")
    .update({
      logo_url: clean("logo_url"),
      primary_color: clean("primary_color"),
      secondary_color: clean("secondary_color"),
    })
    .eq("id", tenantId);
  if (error) return { error: error.message };
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Branding updated." };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add lib/actions/platform.ts
git commit -m "feat(platform): tenant create/suspend/assign-owner/branding actions"
```

---

## Task 5: Platform UI components — `components/platform/*`

**Files:**
- Create: `components/platform/tenant-status-badge.tsx`
- Create: `components/platform/create-tenant-form.tsx`
- Create: `components/platform/assign-owner-form.tsx`
- Create: `components/platform/branding-form.tsx`

- [ ] **Step 1: `components/platform/tenant-status-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import type { TenantStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const META: Record<TenantStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "border-gold/40 bg-gold/15 text-gold-bright" },
  suspended: { label: "Suspended", className: "border-destructive/40 bg-destructive/15 text-destructive" },
  onboarding: { label: "Onboarding", className: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const meta = META[status];
  return <Badge className={cn("border", meta.className)}>{meta.label}</Badge>;
}
```

- [ ] **Step 2: `components/platform/create-tenant-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { createTenant, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function CreateTenantForm() {
  const [state, formAction] = useActionState(createTenant, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{state.notice}</span>
        </Alert>
      )}

      <Field>
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" placeholder="e.g. Acme Alumni Association" required />
      </Field>
      <Field>
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" name="slug" placeholder="acme" required />
      </Field>
      <Field>
        <Label htmlFor="prefix">Member ID prefix</Label>
        <Input id="prefix" name="prefix" placeholder="ACME" required />
      </Field>

      <SubmitButton size="sm" pendingText="Creating…">
        <Plus />
        Create organization
      </SubmitButton>
    </form>
  );
}
```

- [ ] **Step 3: `components/platform/assign-owner-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, UserPlus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { assignTenantOwner, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function AssignOwnerForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useActionState(assignTenantOwner, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{state.notice}</span>
        </Alert>
      )}
      <Field>
        <Label htmlFor="email">Owner email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="owner@example.com"
          required
        />
      </Field>
      <SubmitButton size="sm" pendingText="Assigning…">
        <UserPlus />
        Assign owner
      </SubmitButton>
    </form>
  );
}
```

- [ ] **Step 4: `components/platform/branding-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Paintbrush } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateTenantBranding, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function BrandingForm({
  tenantId,
  logoUrl,
  primaryColor,
  secondaryColor,
}: {
  tenantId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  const [state, formAction] = useActionState(updateTenantBranding, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{state.notice}</span>
        </Alert>
      )}
      <Field>
        <Label htmlFor="logo_url">Logo URL</Label>
        <Input id="logo_url" name="logo_url" defaultValue={logoUrl ?? ""} placeholder="https://…/logo.png" />
      </Field>
      <Field>
        <Label htmlFor="primary_color">Primary color</Label>
        <Input id="primary_color" name="primary_color" defaultValue={primaryColor ?? ""} placeholder="#C8A24B" />
      </Field>
      <Field>
        <Label htmlFor="secondary_color">Secondary color</Label>
        <Input id="secondary_color" name="secondary_color" defaultValue={secondaryColor ?? ""} placeholder="#0B0B0C" />
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        <Paintbrush />
        Save branding
      </SubmitButton>
    </form>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add components/platform/
git commit -m "feat(platform): console form + badge components"
```

---

## Task 6: Platform layout (guard)

**Files:**
- Create: `app/platform/layout.tsx`

- [ ] **Step 1: Create `app/platform/layout.tsx`**

```tsx
import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/platform";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/platform" className="tgp-display text-lg font-bold tracking-wide">
            Platform Console
          </Link>
          <span className="tgp-eyebrow text-[10px] text-gold/70">Super Admin</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add app/platform/layout.tsx
git commit -m "feat(platform): /platform layout with platform-admin guard"
```

---

## Task 7: Platform console page (list + stats + create)

**Files:**
- Create: `app/platform/page.tsx`

- [ ] **Step 1: Create `app/platform/page.tsx`**

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { Building2, Settings2, Users } from "lucide-react";

import { CreateTenantForm } from "@/components/platform/create-tenant-form";
import { TenantStatusBadge } from "@/components/platform/tenant-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listTenantsWithStats } from "@/lib/platform";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Platform Console" };

function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "gold" }) {
  return (
    <Card className="p-4">
      <div className={cn("tgp-display text-2xl font-bold", tone === "gold" ? "text-gold" : "text-foreground")}>
        {value}
      </div>
      <div className="text-[11px] tracking-widest text-muted-foreground uppercase">{label}</div>
    </Card>
  );
}

export default async function PlatformPage() {
  const tenants = await listTenantsWithStats();
  const totalMembers = tenants.reduce((n, t) => n + t.member_count, 0);
  const totalActive = tenants.reduce((n, t) => n + t.active_count, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Organizations" value={tenants.length} tone="gold" />
          <Stat label="Total Members" value={totalMembers} />
          <Stat label="Active Members" value={totalActive} />
        </div>

        <Card className="divide-y divide-border">
          {tenants.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No organizations yet. Create the first one.
            </p>
          ) : (
            tenants.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 p-3">
                <Building2 className="size-5 text-gold" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/platform/tenants/${t.id}`}
                    className="block truncate font-medium text-foreground hover:text-gold"
                  >
                    {t.name}
                  </Link>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="tgp-mono">/{t.slug}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" />
                      {t.active_count}/{t.member_count}
                    </span>
                  </div>
                </div>
                <TenantStatusBadge status={t.status} />
                <Button asChild size="sm" variant="outline">
                  <Link href={`/platform/tenants/${t.id}`}>
                    <Settings2 />
                    Manage
                  </Link>
                </Button>
              </div>
            ))
          )}
        </Card>
      </div>

      <Card className="h-fit p-5">
        <h2 className="tgp-display mb-3 text-sm font-semibold tracking-wide">New organization</h2>
        <CreateTenantForm />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add app/platform/page.tsx
git commit -m "feat(platform): console — tenant list, stats, create form"
```

---

## Task 8: Tenant detail page (owner / suspend / branding)

**Files:**
- Create: `app/platform/tenants/[id]/page.tsx`

- [ ] **Step 1: Create `app/platform/tenants/[id]/page.tsx`**

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Power, ShieldCheck } from "lucide-react";

import { AssignOwnerForm } from "@/components/platform/assign-owner-form";
import { BrandingForm } from "@/components/platform/branding-form";
import { TenantStatusBadge } from "@/components/platform/tenant-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { setTenantStatus } from "@/lib/actions/platform";
import { listTenantAdmins } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types";

export const metadata: Metadata = { title: "Manage Organization" };

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", id)
    .maybeSingle<Tenant>();
  if (error) throw error;
  if (!tenant) notFound();

  const [admins, memberCountResult] = await Promise.all([
    listTenantAdmins(tenant.id),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
  ]);
  if (memberCountResult.error) throw memberCountResult.error;
  const memberCount = memberCountResult.count ?? 0;
  const nextStatus = tenant.status === "suspended" ? "active" : "suspended";

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/platform">
          <ArrowLeft />
          All organizations
        </Link>
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="tgp-display text-2xl font-bold tracking-tight">{tenant.name}</h1>
          <p className="tgp-mono text-xs text-muted-foreground">
            /{tenant.slug} · {tenant.member_id_prefix} · {memberCount} member{memberCount === 1 ? "" : "s"}
          </p>
        </div>
        <TenantStatusBadge status={tenant.status} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Owners &amp; admins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {admins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No owner assigned yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {admins.map((a) => (
                  <li key={a.user_id} className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-gold/70" />
                      {a.name}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{a.role}</span>
                  </li>
                ))}
              </ul>
            )}
            <AssignOwnerForm tenantId={tenant.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {tenant.status === "suspended"
                ? "This organization is suspended — its workspace shows a suspended notice."
                : "This organization is active."}
            </p>
            <form action={setTenantStatus}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <input type="hidden" name="status" value={nextStatus} />
              <SubmitButton
                size="sm"
                variant={nextStatus === "suspended" ? "destructive" : "default"}
                pendingText="…"
              >
                <Power />
                {nextStatus === "suspended" ? "Suspend" : "Reactivate"}
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandingForm
            tenantId={tenant.id}
            logoUrl={tenant.logo_url}
            primaryColor={tenant.primary_color}
            secondaryColor={tenant.secondary_color}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add "app/platform/tenants/[id]/page.tsx"
git commit -m "feat(platform): tenant detail — owners, suspend/reactivate, branding"
```

---

## Task 9: Verification + manual runbook

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` (expect clean) then `npm run build` (expect success; confirm `/platform` and `/platform/tenants/[id]` routes appear).

- [ ] **Step 2: Apply migration `0010` (human, Supabase SQL Editor)**

Paste `supabase/migrations/0010_platform_console.sql` → Run. Then paste
`supabase/tests/0010_platform_checks.sql` → expect only `OK` notices (assign-owner, stats,
non-admin rejection), no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 3: Manual dev runbook (human)**

`npm run dev`, signed in as the bootstrapped platform admin (the account in `platform_admins`):
1. Open `/platform` → see TGP + Org-B with member/active counts and the stat cards.
2. Create a new organization (name + slug + prefix) → it appears in the list.
3. Open its detail page → assign an owner by the email of an existing account → owners list shows them; that account, when it logs in, lands in the new workspace as owner (`/t/<slug>/dashboard`).
4. Suspend the new org → its `/t/<slug>/…` shows the "Workspace suspended" page; reactivate → works again.
5. On TGP's detail page, set `logo_url` (a public image URL) → open a TGP `/t/tgp/id/<slug>` card → the header shows the logo.
6. As a **non**-platform-admin account, open `/platform` → forbidden (403).

Record results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 4: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "chore: super-admin console verified (typecheck, build, probe, runbook)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 access → Tasks 3 (guard), 6 (layout); §2 RPCs → Task 1; §3 console UI → Tasks 7 (list/stats/create), 8 (detail); §4 actions → Task 4; §3 branding edits → Tasks 4 (`updateTenantBranding`) + 5/8 (form); §8 verification → Tasks 1, 9.
- **Additive-only:** every task creates new files except `lib/types.ts` (RPC signatures). No existing route/component is modified, so `tsc` stays green throughout (tasks in order).
- **Type consistency:** `PlatformState` (Task 4) consumed by all three forms (Task 5); `TenantWithStats`/`TenantAdmin`/`requirePlatformAdmin`/`listTenantsWithStats`/`listTenantAdmins` (Task 3) consumed by Tasks 6–8; `TenantStats` (Task 2) used by `platform_tenant_stats` typing (Task 3); `setTenantStatus` form field names (`tenantId`,`status`) match the action (Task 4 ↔ Task 8); `assign_tenant_owner` arg names (`p_tenant_id`,`p_email`) match Task 1 and the action.
- **Out of scope confirmed absent:** no custom-domain/host resolution, no email invites, no co-platform-admin management, no slug/prefix rename. `requirePlatformAdmin` deliberately avoids `getAuth` (no active tenant on global routes).
- **Deferred (noted):** an app-nav link to `/platform` for platform admins (would need exposing platform-admin status through `getAuth`) is intentionally omitted; platform admins navigate to `/platform` directly.
