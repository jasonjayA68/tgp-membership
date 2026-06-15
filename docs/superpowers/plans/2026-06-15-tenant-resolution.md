# Tenant Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `tgp` tenant seam with real per-request resolution — `/t/[slug]` subpath routing via middleware (rewrite + trusted headers), a global workspace-list landing, tenant-aware auth/join, and `tenantHref` link threading — while keeping flat route files and all existing TGP flows working.

**Architecture:** `proxy.ts` middleware resolves `/t/[slug]` → tenant (via a public `SECURITY DEFINER` RPC, TTL-cached), strips client `x-tenant-*` headers, injects trusted `x-tenant-{id,slug,basepath}`, and rewrites `/t/[slug]/rest` → `/rest` so the existing flat routes render. `getActiveTenant()` reads the header; `getAuth()` requires an active tenant; the root `/` becomes the 0/1/many workspace switcher; `tenantHref(basePath, path)` prefixes every workspace link. Custom domains/onboarding stay out of scope (Sub-project #4) but the header contract is the seam.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), Supabase (Postgres + RLS + Auth), `@supabase/ssr`, `@supabase/supabase-js`, TypeScript, zod.

---

## Environment & tooling notes (read first)

- **No test runner / no Supabase CLI.** Migrations are applied **manually in the Supabase SQL Editor**. Verification = a runnable SQL probe (written first), `npx tsc --noEmit`, `npm run build`, and a **manual dev runbook** (Task 14) the human runs against their Supabase. Middleware behavior cannot be unit-tested here; it is verified by build + manual routing checks.
- Migration `0008` is **additive** (only adds two RPCs + grants) — safe on the live DB that already has `0007` applied.
- Run all commands from repo root: `/Users/jasonjayababao/tgp-membership`. Current branch is `main`; the executor (subagent-driven skill) creates a feature branch before starting.
- Prior art to mirror: `get_member_card` (anon `SECURITY DEFINER` RPC), `lib/supabase/proxy.ts` `updateSession` (session refresh + cookie carry), `lib/tenant/context.ts` (the `getActiveTenant` seam), `lib/auth.ts` (`getAuth`/`requireUser`).

## File structure

**Create:**
- `supabase/migrations/0008_tenant_resolution.sql` — `resolve_tenant_by_slug` + `join_tenant_by_slug` RPCs.
- `supabase/tests/0008_resolution_checks.sql` — runnable probe for both RPCs.
- `lib/tenant/resolve.ts` — middleware-side `resolveTenantForMiddleware(slug)` (anon client + TTL cache).
- `lib/tenant/links.ts` — `tenantHref(basePath, path)`.
- `app/workspace-not-found/page.tsx`, `app/workspace-suspended/page.tsx` — edge states.
- `components/app/join-workspace.tsx` — "Request to join" CTA for logged-in non-members.

**Modify:**
- `lib/types.ts` — add `ResolvedTenant` type + the two new `Database.Functions` entries.
- `lib/tenant/context.ts` — `getActiveTenant()` reads the header (returns `ResolvedTenant | null`) + `getActiveTenantBasePath()`.
- `lib/supabase/proxy.ts` — `updateSession` extended with resolution/rewrite/gate.
- `lib/auth.ts` — `getAuth()` requires active tenant (`tenant: ResolvedTenant`), add `listMemberships()`, `getSessionUser()`, `requestToJoin()` is in actions.
- `lib/actions/auth.ts` — `signUp` reads `tenantSlug`; `signIn` `next` defaults to `/`; add `requestToJoin`.
- `components/auth/auth-form.tsx`, `components/auth/register-form.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx` — thread `tenant` + `next`.
- `app/page.tsx` — landing = marketing | workspace list | redirect | empty.
- `app/(app)/layout.tsx` — non-member → join CTA; basePath → `AppNav`.
- `app/(app)/admin/layout.tsx`, `components/app/app-nav.tsx`, `components/admin/admin-nav.tsx` — basePath + `tenantHref` + active-state.
- `app/(app)/admin/page.tsx`, `app/(app)/admin/members/[id]/page.tsx`, `app/(app)/dashboard/page.tsx`, `app/(app)/profile/page.tsx` — internal links/redirects via `tenantHref`.

**Unchanged (verify, do not edit):** `app/id/[slug]/page.tsx`, `lib/site.ts`'s `verificationUrl` (the public `/id/<slug>` card URL stays un-prefixed), `proxy.ts` matcher (already matches `/t/*`).

---

## Task 1: Migration `0008` — resolution + self-join RPCs (+ probe)

**Files:**
- Create: `supabase/tests/0008_resolution_checks.sql`
- Create: `supabase/migrations/0008_tenant_resolution.sql`

- [ ] **Step 1: Write the probe (fails before migration)**

Create `supabase/tests/0008_resolution_checks.sql`:

```sql
-- Run in the Supabase SQL Editor AFTER applying 0008. Transactional; rolls back.
begin;

-- resolve_tenant_by_slug returns the active TGP tenant whitelist.
do $$
declare r record;
begin
  select * into r from public.resolve_tenant_by_slug('tgp');
  if r.id is null then raise exception 'FAIL: tgp did not resolve'; end if;
  if r.slug <> 'tgp' then raise exception 'FAIL: wrong slug %', r.slug; end if;
  raise notice 'OK: resolve_tenant_by_slug(tgp) -> %', r.name;
end $$;

-- Unknown slug resolves to no row.
do $$
declare n int;
begin
  select count(*) into n from public.resolve_tenant_by_slug('does-not-exist');
  if n <> 0 then raise exception 'FAIL: unknown slug returned % rows', n; end if;
  raise notice 'OK: unknown slug -> 0 rows';
end $$;

-- join_tenant_by_slug: a fresh user joins org-b as a pending member.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',
        'authenticated','authenticated','probe-join@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{"full_name":"Probe Join"}'::jsonb, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select public.join_tenant_by_slug('org-b');

reset role;
do $$
declare m int; p text;
begin
  select count(*) into m from public.tenant_users
   where user_id = '33333333-3333-3333-3333-333333333333'
     and tenant_id = (select id from public.tenants where slug='org-b');
  if m <> 1 then raise exception 'FAIL: join did not create membership (%).', m; end if;
  select status into p from public.profiles
   where user_id = '33333333-3333-3333-3333-333333333333'
     and tenant_id = (select id from public.tenants where slug='org-b');
  if p is distinct from 'pending' then raise exception 'FAIL: profile not pending (%)', p; end if;
  raise notice 'OK: join_tenant_by_slug created pending membership + profile';
end $$;

rollback;
```

- [ ] **Step 2: Confirm it fails today**

Paste into the Supabase SQL Editor, run. Expected: **FAIL** — `function public.resolve_tenant_by_slug(...) does not exist`. Record that it errored.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0008_tenant_resolution.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0008: Tenant Resolution RPCs
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe on a DB that already has 0007. Adds two SECURITY DEFINER RPCs:
--  * resolve_tenant_by_slug — public whitelist lookup so middleware can resolve
--    ANY tenant by slug (tenants RLS is membership-gated, so this is required).
--  * join_tenant_by_slug — lets an authenticated user self-join a tenant as a
--    pending member (RLS blocks a non-member from inserting their own rows).
-- =============================================================================

drop function if exists public.resolve_tenant_by_slug(text) cascade;
drop function if exists public.join_tenant_by_slug(text)   cascade;

-- Public whitelist resolver (anon + authenticated). No sensitive columns.
create or replace function public.resolve_tenant_by_slug(p_slug text)
returns table (
  id              uuid,
  name            text,
  slug            text,
  status          public.tenant_status,
  logo_url        text,
  primary_color   text,
  secondary_color text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color
  from public.tenants t
  where t.slug = p_slug
$$;

revoke all on function public.resolve_tenant_by_slug(text) from public;
grant execute on function public.resolve_tenant_by_slug(text) to anon, authenticated;

-- Authenticated self-join: pending membership + profile for the calling user.
create or replace function public.join_tenant_by_slug(p_slug text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  t_id uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select id into t_id from public.tenants
   where slug = p_slug and status = 'active';
  if t_id is null then raise exception 'tenant % not found or inactive', p_slug; end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (t_id, uid, 'member')
  on conflict (tenant_id, user_id) do nothing;

  insert into public.profiles (tenant_id, user_id, status)
  values (t_id, uid, 'pending')
  on conflict (tenant_id, user_id) do nothing;
end $$;

revoke all on function public.join_tenant_by_slug(text) from public;
grant execute on function public.join_tenant_by_slug(text) to authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0008_resolution_checks.sql supabase/migrations/0008_tenant_resolution.sql
git commit -m "feat(db): 0008 — resolve_tenant_by_slug + join_tenant_by_slug RPCs"
```

---

## Task 2: Types — `ResolvedTenant` + RPC signatures

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the `ResolvedTenant` type**

After the `Tenant` type definition in `lib/types.ts`, add:

```ts
/** Public whitelist returned by `resolve_tenant_by_slug` — the active-tenant shape. */
export type ResolvedTenant = Pick<
  Tenant,
  "id" | "name" | "slug" | "status" | "logo_url" | "primary_color" | "secondary_color"
>;
```

- [ ] **Step 2: Register the RPCs in `Database.Functions`**

In `lib/types.ts`, inside `Database.public.Functions`, add these two entries (alongside `get_member_card` etc.):

```ts
      resolve_tenant_by_slug: {
        Args: { p_slug: string };
        Returns: ResolvedTenant[];
      };
      join_tenant_by_slug: { Args: { p_slug: string }; Returns: undefined };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/types.ts` (consumers updated in later tasks may still error; that's fine).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): ResolvedTenant + resolution RPC signatures"
```

---

## Task 3: Middleware tenant resolver — `lib/tenant/resolve.ts`

**Files:**
- Create: `lib/tenant/resolve.ts`

- [ ] **Step 1: Create the resolver**

```ts
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database, ResolvedTenant } from "@/lib/types";

/**
 * Middleware-side tenant resolution. Uses a plain anon client (no cookies — the
 * RPC is SECURITY DEFINER and public) plus a short in-memory TTL cache so we
 * don't hit the DB on every request. Runs on the Node runtime (see proxy.ts).
 */
const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: { persistSession: false },
});

const TTL_MS = 60_000;
const cache = new Map<string, { tenant: ResolvedTenant | null; expires: number }>();

export async function resolveTenantForMiddleware(
  slug: string,
): Promise<ResolvedTenant | null> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && hit.expires > now) return hit.tenant;

  const { data, error } = await client.rpc("resolve_tenant_by_slug", {
    p_slug: slug,
  });
  const tenant = error || !data?.[0] ? null : (data[0] as ResolvedTenant);
  cache.set(slug, { tenant, expires: now + TTL_MS });
  return tenant;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/tenant/resolve.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/tenant/resolve.ts
git commit -m "feat(tenant): middleware tenant resolver with TTL cache"
```

---

## Task 4: Link helper — `lib/tenant/links.ts`

**Files:**
- Create: `lib/tenant/links.ts`

- [ ] **Step 1: Create the helper**

```ts
/**
 * Prefixes an in-app path with the active tenant's base path.
 *   tenantHref("/t/tgp", "/admin") === "/t/tgp/admin"
 *   tenantHref("",       "/admin") === "/admin"   // custom-domain case (later)
 * `path` must be a root-relative path beginning with "/".
 */
export function tenantHref(basePath: string, path: string): string {
  if (!basePath) return path;
  return path === "/" ? basePath : `${basePath}${path}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean for this file.

- [ ] **Step 3: Commit**

```bash
git add lib/tenant/links.ts
git commit -m "feat(tenant): tenantHref link helper"
```

---

## Task 5: Active-tenant context from headers — `lib/tenant/context.ts`

**Files:**
- Modify: `lib/tenant/context.ts` (full rewrite)

- [ ] **Step 1: Rewrite the file**

```ts
import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { ResolvedTenant } from "@/lib/types";

/**
 * The active tenant for the current request, resolved from the trusted
 * `x-tenant-slug` header that middleware injects (after stripping any
 * client-supplied value). Returns null on global routes (no tenant context).
 * Memoised per request.
 */
export const getActiveTenant = cache(async (): Promise<ResolvedTenant | null> => {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_tenant_by_slug", {
    p_slug: slug,
  });
  if (error || !data?.[0]) return null;
  return data[0] as ResolvedTenant;
});

/** The active tenant's link base path (e.g. "/t/tgp"; "" on a custom domain). */
export async function getActiveTenantBasePath(): Promise<string> {
  return (await headers()).get("x-tenant-basepath") ?? "";
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in consumers expecting the old full-`Tenant` return (fixed in Task 7+). `context.ts` itself clean.

- [ ] **Step 3: Commit**

```bash
git add lib/tenant/context.ts
git commit -m "feat(tenant): resolve active tenant from request headers"
```

---

## Task 6: Middleware resolution + rewrite — `lib/supabase/proxy.ts`

**Files:**
- Modify: `lib/supabase/proxy.ts` (full rewrite)

- [ ] **Step 1: Rewrite `updateSession`**

Replace the entire contents of `lib/supabase/proxy.ts` with:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { resolveTenantForMiddleware } from "@/lib/tenant/resolve";

/** Bare workspace paths that are only valid under /t/[slug] in subpath mode. */
const WORKSPACE_PREFIXES = ["/dashboard", "/admin", "/profile"];

function matches(prefixes: string[], pathname: string): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(p === "/" ? "/?" : p + "/"),
  );
}

/** Copy refreshed Supabase auth cookies from one response onto another. */
function carryCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

function redirect(to: string, request: NextRequest, carry: NextResponse) {
  const url = request.nextUrl.clone();
  const [pathname, search = ""] = to.split("?");
  url.pathname = pathname;
  url.search = search;
  return carryCookies(carry, NextResponse.redirect(url));
}

function rewrite(
  to: string,
  request: NextRequest,
  carry: NextResponse,
  requestHeaders?: Headers,
) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = request.nextUrl.search;
  const res = NextResponse.rewrite(
    url,
    requestHeaders ? { request: { headers: requestHeaders } } : undefined,
  );
  return carryCookies(carry, res);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        }
      },
    },
  });

  // IMPORTANT: do not run logic between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // ---- Tenant-scoped routes: /t/[slug]/<rest> -------------------------------
  if (path === "/t" || path.startsWith("/t/")) {
    const segs = path.split("/").filter(Boolean); // ["t", slug, ...rest]
    const slug = segs[1];
    if (!slug) return redirect("/", request, response);
    const rest = "/" + segs.slice(2).join("/");

    const tenant = await resolveTenantForMiddleware(slug);
    if (!tenant) return rewrite("/workspace-not-found", request, response);
    if (tenant.status === "suspended")
      return rewrite("/workspace-suspended", request, response);

    // Logged-out → carry tenant + return path to the global login.
    if (!user) {
      return redirect(
        `/login?tenant=${encodeURIComponent(slug)}&next=${encodeURIComponent(path)}`,
        request,
        response,
      );
    }

    // Inject trusted tenant headers (after stripping any client-supplied ones).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-tenant-id");
    requestHeaders.delete("x-tenant-slug");
    requestHeaders.delete("x-tenant-basepath");
    requestHeaders.set("x-tenant-id", tenant.id);
    requestHeaders.set("x-tenant-slug", tenant.slug);
    requestHeaders.set("x-tenant-basepath", `/t/${tenant.slug}`);

    return rewrite(
      rest === "/" ? "/dashboard" : rest,
      request,
      response,
      requestHeaders,
    );
  }

  // ---- Bare workspace path hit directly (no tenant) → workspace list --------
  if (matches(WORKSPACE_PREFIXES, path)) {
    return redirect("/", request, response);
  }

  // ---- Global routes --------------------------------------------------------
  if (user && (path === "/login" || path === "/register")) {
    return redirect("/", request, response);
  }
  // Strip any spoofed tenant headers on global routes too.
  if (
    request.headers.has("x-tenant-id") ||
    request.headers.has("x-tenant-slug")
  ) {
    const clean = new Headers(request.headers);
    clean.delete("x-tenant-id");
    clean.delete("x-tenant-slug");
    clean.delete("x-tenant-basepath");
    const next = NextResponse.next({ request: { headers: clean } });
    return carryCookies(response, next);
  }

  return response;
}
```

Note: there is intentionally no global-protected-route gate — the only protected surfaces live under `/t/[slug]` (handled above), and `getAuth`/RLS are the authoritative backstop on the pages themselves.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed. (Build compiles middleware; runtime behavior is verified manually in Task 14.)

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/proxy.ts
git commit -m "feat(proxy): resolve /t/[slug], inject tenant headers, rewrite to flat routes"
```

---

## Task 7: Auth context — require active tenant, list memberships

**Files:**
- Modify: `lib/auth.ts` (full rewrite)

- [ ] **Step 1: Rewrite `lib/auth.ts`**

```ts
import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";
import { isTenantAdminRole } from "@/lib/constants";
import { toProfileView } from "@/lib/profile";
import type {
  Profile,
  ProfileWithChapter,
  ResolvedTenant,
  TenantRole,
} from "@/lib/types";

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: ResolvedTenant;
  role: TenantRole | null; // null = logged-in non-member of this tenant
  profile: ProfileWithChapter | null;
}

export interface Membership {
  role: TenantRole;
  tenant: ResolvedTenant;
}

/** The verified session user, or null. */
export async function getSessionUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}

/**
 * All tenants the current user belongs to (for the root workspace switcher).
 * Two-step (no PostgREST embed) — the hand-authored `Database` type gives
 * `tenant_users` an empty `Relationships`, so an embed wouldn't type-check.
 * RLS lets a member read their own tenant rows.
 */
export async function listMemberships(): Promise<Membership[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows, error } = await supabase
    .from("tenant_users")
    .select("role, tenant_id")
    .eq("user_id", user.id);
  if (error) throw error;
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.tenant_id);
  const { data: tenants, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, slug, status, logo_url, primary_color, secondary_color")
    .in("id", ids);
  if (tErr) throw tErr;

  const byId = new Map(
    (tenants ?? []).map((t) => [t.id, t as ResolvedTenant]),
  );
  return rows
    .map((r) => {
      const tenant = byId.get(r.tenant_id);
      return tenant ? { role: r.role as TenantRole, tenant } : null;
    })
    .filter((m): m is Membership => m !== null);
}

/**
 * Verified user + active tenant (from the request header) + the user's
 * membership role + flattened profile for THAT tenant. Returns null when there
 * is no session or no active tenant (a global route). A non-member of the active
 * tenant gets `role: null` / `profile: null`. Memoised per request.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenant = await getActiveTenant();
  if (!tenant) return null;

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

/** Require an authenticated user in the active tenant context. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** Require a tenant admin or owner; redirect to /login or forbid otherwise. */
export async function requireTenantAdmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!isTenantAdminRole(auth.role)) forbidden();
  return auth;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in pages that still treat `getActiveTenant()`/`auth.tenant` as full `Tenant` or assume `role` non-null — fixed in later tasks. `lib/auth.ts` itself clean.

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "feat(auth): require active tenant; add listMemberships/getSessionUser"
```

---

## Task 8: Tenant-aware auth actions + forms + pages

**Files:**
- Modify: `lib/actions/auth.ts`
- Modify: `components/auth/auth-form.tsx`
- Modify: `components/auth/register-form.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/register/page.tsx`

- [ ] **Step 1: `lib/actions/auth.ts` — `next` default + `tenantSlug` + `requestToJoin`**

In `lib/actions/auth.ts`:

(a) Change `safeNext`'s fallback from `/dashboard` to `/`:

```ts
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
```

(b) In `signUp`, read an optional tenant slug and pass it as `tenant_slug` metadata, and redirect to the tenant or `/`:

Replace the `supabase.auth.signUp({...})` options `data` block to include `tenant_slug`, by reading it at the top of `signUp`:

```ts
  const tenantSlug = (() => {
    const v = formData.get("tenantSlug");
    return typeof v === "string" && v.length > 0 ? v : null;
  })();
```

and in the `options.data` object add:

```ts
        tenant_slug: tenantSlug,
```

Then change the post-signup `redirect("/dashboard");` to:

```ts
  redirect(tenantSlug ? `/t/${tenantSlug}/dashboard` : "/");
```

(c) Add a `requestToJoin` action at the end of the file:

```ts
/** Logged-in user self-joins a tenant as a pending member. */
export async function requestToJoin(formData: FormData): Promise<void> {
  const slug = formData.get("tenantSlug");
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("Missing tenant.");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?tenant=${encodeURIComponent(slug)}`);

  const { error } = await supabase.rpc("join_tenant_by_slug", { p_slug: slug });
  if (error) throw new Error(error.message);

  redirect(`/t/${slug}/dashboard`);
}
```

(`signIn` already redirects to `safeNext(...)`, which now defaults to `/`.)

- [ ] **Step 2: `components/auth/auth-form.tsx` — thread `tenant` + always send `next`**

Add a `tenant` prop and a hidden `tenantSlug` field; send `next` for BOTH modes (so login returns to the workspace). Change the component signature and the hidden inputs:

```tsx
export function AuthForm({
  mode,
  next,
  tenant,
}: {
  mode: "login" | "register";
  next?: string;
  tenant?: string;
}) {
```

Replace the single `{!isRegister && <input type="hidden" name="next" ... />}` line with:

```tsx
      <input type="hidden" name="next" value={next ?? "/"} />
      {tenant && <input type="hidden" name="tenantSlug" value={tenant} />}
```

- [ ] **Step 3: `components/auth/register-form.tsx` — accept + forward `tenant`**

`register-form.tsx` builds the signup form. Add a `tenant?: string` prop to its component and render a hidden field inside the `<form>`:

```tsx
      {tenant && <input type="hidden" name="tenantSlug" value={tenant} />}
```

(Place it next to the other hidden/first fields. If the component currently takes no props, add `{ tenant }: { tenant?: string }` to its signature.)

- [ ] **Step 4: `app/(auth)/login/page.tsx` — read `tenant`, pass to form + register link**

Change the `searchParams` type and destructure to include `tenant`, pass it to `AuthForm`, and make the "Register" link carry the tenant:

```tsx
}: {
  searchParams: Promise<{ next?: string; error?: string; tenant?: string }>;
}) {
  const { next, error, tenant } = await searchParams;
```

```tsx
        <AuthForm
          mode="login"
          next={typeof next === "string" ? next : undefined}
          tenant={typeof tenant === "string" ? tenant : undefined}
        />
```

And the footer Register link:

```tsx
          <Link
            href={tenant ? `/register?tenant=${encodeURIComponent(tenant)}` : "/register"}
```

When `tenant` is present, also adjust the card title to invite joining — change `<CardTitle>Member Sign In</CardTitle>` region to show a join affordance:

```tsx
        <CardDescription>
          {tenant
            ? `Sign in to continue to ${tenant}, or register to join.`
            : "Access your membership portal and digital ID."}
        </CardDescription>
```

- [ ] **Step 5: `app/(auth)/register/page.tsx` — read `tenant`, pass to form + sign-in link**

```tsx
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant } = await searchParams;
```

```tsx
        <RegisterForm tenant={typeof tenant === "string" ? tenant : undefined} />
```

```tsx
          <Link
            href={tenant ? `/login?tenant=${encodeURIComponent(tenant)}` : "/login"}
```

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/auth.ts components/auth/auth-form.tsx components/auth/register-form.tsx "app/(auth)/login/page.tsx" "app/(auth)/register/page.tsx"
git commit -m "feat(auth): tenant-aware login/register + requestToJoin"
```

---

## Task 9: Root landing = workspace switcher

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Rewrite `app/page.tsx`**

Keep the existing marketing markup for logged-out visitors; add the authed branches. Replace the file with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Nfc, ScanLine, ShieldCheck, Building2, ArrowRight } from "lucide-react";

import { TgpSeal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SITE } from "@/lib/constants";
import { getSessionUser, listMemberships } from "@/lib/auth";

const FEATURES = [
  {
    icon: Nfc,
    title: "NFC Verification",
    body: "Every member carries an NFC card that resolves to a live, official verification page on tap.",
  },
  {
    icon: ShieldCheck,
    title: "Digital Identity",
    body: "A tamper-resistant digital ID, issued and governed by the fraternity administration.",
  },
  {
    icon: ScanLine,
    title: "Authoritative Registry",
    body: "A single source of truth for membership standing, secured end to end with row-level access control.",
  },
];

export default async function HomePage() {
  const user = await getSessionUser();

  if (user) {
    const memberships = await listMemberships();
    if (memberships.length === 1) {
      redirect(`/t/${memberships[0].tenant.slug}/dashboard`);
    }
    return (
      <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <TgpSeal className="mx-auto size-16 rounded-full" />
            <h1 className="tgp-display mt-4 text-2xl font-bold">
              {memberships.length === 0 ? "No workspaces yet" : "Your workspaces"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {memberships.length === 0
                ? "You're signed in but not a member of any organization yet."
                : "Choose a workspace to continue."}
            </p>
          </div>

          {memberships.length > 0 && (
            <div className="space-y-2">
              {memberships.map(({ tenant, role }) => (
                <Card key={tenant.id} className="p-0">
                  <Link
                    href={`/t/${tenant.slug}/dashboard`}
                    className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
                  >
                    <Building2 className="size-5 text-gold" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {tenant.name}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {role}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </Card>
              ))}
            </div>
          )}

          <form action="/login" className="mt-6 text-center">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Switch account</Link>
            </Button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <TgpSeal className="size-32 rounded-full tgp-glow sm:size-40" />
        <p className="tgp-eyebrow mt-8 text-[11px] text-gold/80">
          Est. {SITE.founded} · Official Digital Registry
        </p>
        <h1 className="tgp-display tgp-gild mt-3 text-4xl font-black tracking-[0.08em] sm:text-6xl">
          TAU GAMMA PHI
        </h1>
        <p className="tgp-eyebrow mt-3 text-xs text-foreground/70">{SITE.motto}</p>
        <p className="mt-6 max-w-xl text-balance text-muted-foreground">
          The official digital membership registry of Tau Gamma Phi. Issue
          digital IDs, manage chapters, and verify any member&apos;s standing
          instantly through NFC.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login">Member Sign In</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/register?tenant=tgp">Apply for Membership</Link>
          </Button>
        </div>
        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-card/60 p-5 text-left"
              >
                <Icon className="size-5 text-gold" />
                <h2 className="tgp-display mt-3 text-sm font-semibold tracking-wide">
                  {feature.title}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {SITE.legalName}
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(app): root landing as workspace switcher (0/1/many)"
```

---

## Task 10: Edge-state views — not-found + suspended

**Files:**
- Create: `app/workspace-not-found/page.tsx`
- Create: `app/workspace-suspended/page.tsx`

- [ ] **Step 1: `app/workspace-not-found/page.tsx`**

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Workspace not found" };

export default function WorkspaceNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <Building2 className="size-12 text-muted-foreground" />
      <h1 className="tgp-display mt-4 text-2xl font-bold">Workspace not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        This organization workspace doesn&apos;t exist or its address has changed.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
```

- [ ] **Step 2: `app/workspace-suspended/page.tsx`**

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Workspace suspended" };

export default function WorkspaceSuspended() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <ShieldAlert className="size-12 text-destructive" />
      <h1 className="tgp-display mt-4 text-2xl font-bold">Workspace suspended</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        This organization workspace is currently suspended. Contact your
        administrator for details.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` (expected: succeeds).

```bash
git add app/workspace-not-found/page.tsx app/workspace-suspended/page.tsx
git commit -m "feat(app): workspace not-found + suspended edge views"
```

---

## Task 11: Workspace layout — join CTA + basePath threading

**Files:**
- Create: `components/app/join-workspace.tsx`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: `components/app/join-workspace.tsx`**

```tsx
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestToJoin } from "@/lib/actions/auth";
import type { ResolvedTenant } from "@/lib/types";

export function JoinWorkspace({ tenant }: { tenant: ResolvedTenant }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <Building2 className="size-12 text-gold" />
      <h1 className="tgp-display mt-4 text-2xl font-bold">
        Join {tenant.name}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        You&apos;re signed in but not yet a member of this workspace. Request to
        join — an administrator will review your membership.
      </p>
      <form action={requestToJoin} className="mt-6">
        <input type="hidden" name="tenantSlug" value={tenant.slug} />
        <SubmitButton pendingText="Requesting…">Request to join</SubmitButton>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: `app/(app)/layout.tsx` — branch on membership, pass basePath**

```tsx
import { AppNav } from "@/components/app/app-nav";
import { JoinWorkspace } from "@/components/app/join-workspace";
import { requireUser } from "@/lib/auth";
import { isTenantAdminRole, SITE } from "@/lib/constants";
import { getActiveTenantBasePath } from "@/lib/tenant/context";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, tenant } = await requireUser();

  // Logged-in non-member of this workspace → offer to join.
  if (!role) {
    return <JoinWorkspace tenant={tenant} />;
  }

  const basePath = await getActiveTenantBasePath();

  return (
    <div className="flex min-h-svh flex-col">
      <AppNav basePath={basePath} isAdmin={isTenantAdminRole(role)} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {SITE.legalName} · {SITE.motto} · Est. {SITE.founded}
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: an error in `app-nav.tsx`/its usage because `AppNav` doesn't yet accept `basePath` — fixed in Task 12.

- [ ] **Step 4: Commit**

```bash
git add components/app/join-workspace.tsx "app/(app)/layout.tsx"
git commit -m "feat(app): join CTA for non-members; thread tenant basePath to nav"
```

---

## Task 12: Nav components — basePath + tenantHref + active state

**Files:**
- Modify: `components/app/app-nav.tsx`
- Modify: `components/admin/admin-nav.tsx`
- Modify: `app/(app)/admin/layout.tsx`

- [ ] **Step 1: `components/app/app-nav.tsx`**

Add a `basePath` prop and build every href via `tenantHref`; compute active state against the prefixed href.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogOut, ShieldCheck, UserCog } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { tenantHref } from "@/lib/tenant/links";

const BASE_LINKS = [
  { href: "/dashboard", label: "Portal", icon: LayoutDashboard },
  { href: "/profile", label: "Profile", icon: UserCog },
];

export function AppNav({
  basePath,
  isAdmin,
}: {
  basePath: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const links = isAdmin
    ? [...BASE_LINKS, { href: "/admin", label: "Admin", icon: ShieldCheck }]
    : BASE_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href={tenantHref(basePath, "/dashboard")}
          aria-label="Workspace home"
        >
          <Wordmark showRegistry={false} sealClassName="size-9" />
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const href = tenantHref(basePath, link.href);
            const active = pathname === href || pathname.startsWith(href + "/");
            const Icon = link.icon;
            return (
              <Button
                key={link.href}
                asChild
                size="sm"
                variant={active ? "secondary" : "ghost"}
              >
                <Link href={href}>
                  <Icon />
                  <span className="hidden sm:inline">{link.label}</span>
                </Link>
              </Button>
            );
          })}

          <form action={signOut}>
            <Button type="submit" size="sm" variant="ghost">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: `components/admin/admin-nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Building2, ScrollText } from "lucide-react";

import { cn } from "@/lib/utils";
import { tenantHref } from "@/lib/tenant/links";

const LINKS = [
  { href: "/admin", label: "Members", icon: Users, exact: true },
  { href: "/admin/chapters", label: "Chapters", icon: Building2 },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
];

export function AdminNav({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const membersHref = tenantHref(basePath, "/admin/members");

  return (
    <nav className="flex flex-wrap gap-1.5">
      {LINKS.map((link) => {
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

- [ ] **Step 3: `app/(app)/admin/layout.tsx` — pass basePath to AdminNav**

Change `const { role } = await requireTenantAdmin();` to keep `role` and get the base path, then pass it:

```tsx
import { AdminNav } from "@/components/admin/admin-nav";
import { requireTenantAdmin } from "@/lib/auth";
import { TENANT_ROLE_META } from "@/lib/constants";
import { getActiveTenantBasePath } from "@/lib/tenant/context";
```

```tsx
  const { role } = await requireTenantAdmin();
  const basePath = await getActiveTenantBasePath();
```

```tsx
      <AdminNav basePath={basePath} />
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add components/app/app-nav.tsx components/admin/admin-nav.tsx "app/(app)/admin/layout.tsx"
git commit -m "feat(app): tenant-prefixed nav links + active state"
```

---

## Task 13: Server-page internal links/redirects via tenantHref

**Files:**
- Modify: `app/(app)/admin/page.tsx`
- Modify: `app/(app)/admin/members/[id]/page.tsx`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/profile/page.tsx`

- [ ] **Step 1: `app/(app)/admin/page.tsx` — prefix member + clear links**

At the top of the component, get the base path:

```tsx
import { getActiveTenantBasePath } from "@/lib/tenant/context";
import { tenantHref } from "@/lib/tenant/links";
```

```tsx
  const basePath = await getActiveTenantBasePath();
```

Replace `<Link href="/admin">Clear</Link>` with:

```tsx
            <Link href={tenantHref(basePath, "/admin")}>Clear</Link>
```

In `MemberRow`, the member link `href={`/admin/members/${member.id}`}` must be prefixed. Pass `basePath` into `MemberRow` (add it to the component's props and the call site), then:

```tsx
          href={tenantHref(basePath, `/admin/members/${member.id}`)}
```

Apply to both the name `<Link>` and the "Manage" `<Link>` in `MemberRow`.

- [ ] **Step 2: `app/(app)/admin/members/[id]/page.tsx` — prefix the back link**

```tsx
import { tenantHref } from "@/lib/tenant/links";
```

The page already has `auth` from `requireTenantAdmin()`; derive the base path:

```tsx
  const basePath = await getActiveTenantBasePath();
```

(add the `getActiveTenantBasePath` import alongside the others). Replace `<Link href="/admin">` (the back link) with:

```tsx
        <Link href={tenantHref(basePath, "/admin")}>
```

Leave `verificationUrl(baseUrl, card.slug)` (the public `/id/<slug>` URL) **unchanged**.

- [ ] **Step 3: `app/(app)/dashboard/page.tsx` — NO change (verified)**

The dashboard's only internal link is `href={`/id/${card.slug}`}` — the **public** verification URL, which must stay un-prefixed (it is the public card page, not a workspace route, and is what the NFC card encodes). There are no workspace `<Link>`s to prefix. **Make no edits to this file.** (The `redirect("/login")` fallback stays; middleware already gates logged-out users.)

- [ ] **Step 4: `app/(app)/profile/page.tsx` — NO change (verified)**

The profile page has no internal workspace `<Link>`s. **Make no edits to this file.**

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed. Then sweep for missed bare workspace links:

```bash
grep -rns -E 'href="/(dashboard|admin|profile)' "app/(app)" components/app components/admin
```
Expected: NO matches (every workspace href now goes through `tenantHref`). Public `/id` and global `/login`,`/register` are allowed and won't match this pattern.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/admin/page.tsx" "app/(app)/admin/members/[id]/page.tsx" "app/(app)/dashboard/page.tsx" "app/(app)/profile/page.tsx"
git commit -m "feat(app): tenant-prefix internal links in workspace pages"
```

---

## Task 14: Verification + manual runbook

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` (expect clean) then `npm run build` (expect success).

- [ ] **Step 2: Sweep for un-prefixed workspace links**

```bash
grep -rns -E 'href="/(dashboard|admin|profile)"|href=\{`/(dashboard|admin|profile)' "app/(app)" components/app components/admin
```
Expected: NO matches. Fix any and re-run Step 1.

- [ ] **Step 3: Apply migration `0008` (human, in Supabase SQL Editor)**

Paste `supabase/migrations/0008_tenant_resolution.sql` → Run. Then paste `supabase/tests/0008_resolution_checks.sql` → expect only `OK` notices, no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 4: Manual dev runbook (human)**

`npm run dev`, then verify:
1. **Single-tenant redirect:** sign in as a TGP-only user → lands on `/` → auto-redirects to `/t/tgp/dashboard`. Nav links read `/t/tgp/...`; Portal/Profile/Admin work.
2. **Logged-out workspace:** open `/t/tgp/dashboard` in a fresh/incognito session → redirected to `/login?tenant=tgp&next=%2Ft%2Ftgp%2Fdashboard`; the page offers register-to-join; after login you return to the workspace.
3. **Unknown / suspended:** open `/t/does-not-exist` → "Workspace not found". Temporarily `update public.tenants set status='suspended' where slug='org-b';` then open `/t/org-b/...` → "Workspace suspended" (revert after).
4. **Join flow:** as a logged-in TGP-only user, open `/t/org-b/dashboard` → "Join Org B" CTA → Request to join → pending membership created (verify in `tenant_users`/`profiles`); approving it in `/t/org-b/admin` works.
5. **Spoof test:** `curl -H "x-tenant-slug: org-b" http://localhost:3000/t/tgp/dashboard` (with a valid TGP session cookie) → still resolves TGP (the injected header is stripped/overwritten by middleware).
6. **Public verify unchanged:** an existing `/id/<slug>` card page still renders.

Record results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 5: Final commit (if any fixes were made)**

```bash
git add -A
git commit -m "chore: tenant resolution verified (typecheck, build, probe, manual runbook)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 mechanism → Tasks 6 (rewrite/headers) + 5 (context); §2 RPC → Task 1; §3 routing/entry → Tasks 8 (auth), 9 (landing), 10 (edge states), 11 (join); §4 app layer → Tasks 3,4,5,7,12,13; §5 security (anti-spoof) → Task 6 (header strip) + Task 14 Step 4.5 (spoof test); §6 files → all; §8 verification → Tasks 1,14.
- **Self-join RLS gap:** the spec's "request to join" can't be a plain client insert (RLS blocks non-members) — handled by the added `join_tenant_by_slug` SECURITY DEFINER RPC (Task 1), surfaced via `requestToJoin` (Task 8) + `JoinWorkspace` (Task 11).
- **Type consistency:** `ResolvedTenant` defined Task 2, used by `getActiveTenant` (5), `getAuth`/`listMemberships`/`Membership` (7), `JoinWorkspace` (11). `tenantHref(basePath, path)` signature consistent across Tasks 4, 12, 13. `AppNav({basePath,isAdmin})` (12) matches its call site (11). `getActiveTenantBasePath()` used in 11, 12, 13.
- **Out of scope confirmed absent:** no host/custom-domain resolution, no domain verification, no `/t/[tenant]/id`, no invite tokens.
- **Known runtime caveat:** middleware cookie-carry on `NextResponse.rewrite` with injected request headers is verified by the manual runbook (Task 14), since middleware can't be unit-tested in this repo.
