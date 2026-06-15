# Custom Domains (#4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a tenant on its own verified custom domain (e.g. `members.acme.org`) as a transparent alias for `/t/[slug]`, with app-side DNS-TXT ownership verification and zero stored secrets.

**Architecture:** A new host-mode branch in `proxy.ts` resolves a non-canonical `Host` header to a tenant via a new anon `resolve_tenant_by_host` RPC (verified + active domains only), injecting the same trusted `x-tenant-*` headers used by path mode but with an empty basepath (root-relative links). Platform admins manage a single domain per tenant from the `/platform` console; verification is a server-side `node:dns` TXT lookup. The actual domain attach + TLS is a manual Vercel operation (no Vercel API, no secret).

**Tech Stack:** Next.js 16 (Node-runtime `proxy.ts`), Supabase Postgres + RLS + SECURITY DEFINER RPCs, `node:dns`/`node:crypto`, React `useActionState` server actions.

**Context for the implementer:**
- This is sub-project #4b. Read `docs/superpowers/specs/2026-06-15-custom-domains-design.md` only if a step is unclear — everything needed is inline below.
- **You cannot apply migrations to the database.** The user applies `0014` + runs the probe manually. Your job for Task 1 is to author correct SQL; the "test" is the probe file plus a `psql`-style dry read you cannot run — so Task 1 ends at commit, and DB verification is the user's manual step.
- Pure-logic tests run via Node type-stripping: `node lib/tenant/host.check.mts` (the file imports `./host.ts` with an explicit `.ts` extension and is therefore excluded from `tsc` in `tsconfig.json`, exactly like `lib/features.check.mts`).
- Integration modules (middleware, resolver, actions, UI) have no unit-test harness in this repo; their gates are `npx tsc --noEmit` + `npm run build` + the manual runbook in Task 8. This mirrors every prior sub-project — do not invent a test framework.
- Follow existing patterns exactly: server actions return `PlatformState = { error?: string; notice?: string }` and use `getPlatformContext()` (see `lib/actions/platform.ts`); client forms use `useActionState` (see `components/platform/branding-form.tsx`).

---

## File Structure

- **New:**
  - `supabase/migrations/0014_custom_domains.sql` — `tenants` verify columns + `resolve_tenant_by_host` RPC.
  - `supabase/tests/0014_custom_domains_checks.sql` — transactional probe.
  - `lib/tenant/host.ts` — pure `normalizeHost` + `isCanonicalHost` helpers.
  - `lib/tenant/host.check.mts` — Node test for the above.
  - `components/platform/domain-card.tsx` — platform-admin domain management UI.
- **Modified:**
  - `lib/env.ts` — optional `APP_HOST` (canonical host).
  - `lib/types.ts` — two new `tenants` columns + `resolve_tenant_by_host` function type.
  - `lib/tenant/resolve.ts` — `resolveTenantByHost` + namespaced cache.
  - `lib/supabase/proxy.ts` — host-mode branch.
  - `lib/actions/platform.ts` — `setCustomDomain` / `verifyCustomDomain` / `removeCustomDomain`.
  - `app/platform/tenants/[id]/page.tsx` — render the Domain card.
  - `tsconfig.json` — exclude `lib/tenant/host.check.mts`.

---

### Task 1: Migration `0014` + probe (DB)

**Files:**
- Create: `supabase/migrations/0014_custom_domains.sql`
- Create: `supabase/tests/0014_custom_domains_checks.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0014_custom_domains.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0014: Custom Domains (#4b)
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe on a DB that already has 0007–0013. Adds:
--  * tenants.domain_verify_token + tenants.domain_verified_at (the verify gate)
--  * resolve_tenant_by_host(text) — anon host→tenant resolver returning ONLY
--    verified, active custom domains (parallels resolve_tenant_by_slug, 0008).
-- =============================================================================

alter table public.tenants
  add column if not exists domain_verify_token text,
  add column if not exists domain_verified_at  timestamptz;

drop function if exists public.resolve_tenant_by_host(text) cascade;

-- Public whitelist resolver by host. Returns ONLY verified + active domains.
create or replace function public.resolve_tenant_by_host(p_host text)
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
  where t.custom_domain = lower(p_host)
    and t.domain_verified_at is not null
    and t.status = 'active'
  limit 1
$$;

revoke all on function public.resolve_tenant_by_host(text) from public;
grant execute on function public.resolve_tenant_by_host(text) to anon, authenticated;
```

- [ ] **Step 2: Write the probe**

Create `supabase/tests/0014_custom_domains_checks.sql`:

```sql
-- Transactional probe for 0014. Rolls back — leaves no data. Run in the SQL editor.
begin;

do $$
declare
  v_tid   uuid;
  v_count int;
  v_slug  text;
begin
  insert into public.tenants (name, slug, member_id_prefix, custom_domain, domain_verify_token, status)
  values ('Probe Org', 'probe-domain-org', 'PRB', 'probe.example.com', 'tok_probe', 'active')
  returning id into v_tid;

  -- 1. Unverified domain must NOT resolve.
  select count(*) into v_count from public.resolve_tenant_by_host('probe.example.com');
  if v_count <> 0 then raise exception 'FAIL: unverified domain resolved (% rows)', v_count; end if;
  raise notice 'OK: unverified domain not resolved';

  -- 2. Verified domain resolves to the correct tenant.
  update public.tenants set domain_verified_at = now() where id = v_tid;
  select slug into v_slug from public.resolve_tenant_by_host('probe.example.com');
  if v_slug is distinct from 'probe-domain-org' then raise exception 'FAIL: verified slug=%', v_slug; end if;
  raise notice 'OK: verified domain resolves to correct tenant';

  -- 3. Host match is case-insensitive.
  select count(*) into v_count from public.resolve_tenant_by_host('PROBE.example.com');
  if v_count <> 1 then raise exception 'FAIL: uppercase host not resolved (% rows)', v_count; end if;
  raise notice 'OK: host match is case-insensitive';

  -- 4. Suspended tenant's domain must NOT resolve.
  update public.tenants set status = 'suspended' where id = v_tid;
  select count(*) into v_count from public.resolve_tenant_by_host('probe.example.com');
  if v_count <> 0 then raise exception 'FAIL: suspended domain resolved (% rows)', v_count; end if;
  raise notice 'OK: suspended domain not resolved';

  raise notice 'ALL 0014 CHECKS PASSED';
end $$;

rollback;
```

- [ ] **Step 3: Sanity-check the SQL parses locally (syntax only)**

These files are applied by the user, not you. Do a cheap local syntax scan to catch typos:

Run: `grep -c "raise notice 'OK" supabase/tests/0014_custom_domains_checks.sql`
Expected: `4`

Run: `grep -c "security definer" supabase/migrations/0014_custom_domains.sql`
Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_custom_domains.sql supabase/tests/0014_custom_domains_checks.sql
git commit -m "feat(db): custom-domain columns + resolve_tenant_by_host RPC (0014)"
```

---

### Task 2: Host helpers + Node test

**Files:**
- Create: `lib/tenant/host.ts`
- Create: `lib/tenant/host.check.mts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Write the failing test**

Create `lib/tenant/host.check.mts`:

```ts
import { normalizeHost, isCanonicalHost } from "./host.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// normalizeHost
assert(normalizeHost("Acme.ORG") === "acme.org", "lowercases");
assert(normalizeHost("acme.org:3000") === "acme.org", "strips port");
assert(normalizeHost("acme.org.") === "acme.org", "strips trailing dot");
assert(normalizeHost("  acme.org  ") === "acme.org", "trims whitespace");
assert(normalizeHost("evil@acme.org") === "acme.org", "strips userinfo");
assert(normalizeHost("acme.org, other.org") === "acme.org", "takes first of a list");
assert(normalizeHost("") === null, "empty → null");
assert(normalizeHost(null) === null, "null → null");
assert(normalizeHost(undefined) === null, "undefined → null");

// isCanonicalHost
assert(isCanonicalHost("localhost", null) === true, "localhost is canonical");
assert(isCanonicalHost("127.0.0.1", null) === true, "loopback is canonical");
assert(isCanonicalHost("tgp.vercel.app", null) === true, "*.vercel.app is canonical");
assert(isCanonicalHost("tgp.example.com", "tgp.example.com") === true, "configured appHost is canonical");
assert(isCanonicalHost("members.acme.org", null) === false, "custom domain is not canonical");
assert(isCanonicalHost("members.acme.org", "tgp.example.com") === false, "other host is not canonical");

console.log("OK: host checks pass");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node lib/tenant/host.check.mts`
Expected: FAIL — `Cannot find module './host.ts'` (the implementation doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/tenant/host.ts`:

```ts
/**
 * Pure host helpers for custom-domain resolution. No imports — Node-testable via
 * lib/tenant/host.check.mts (run with `node`, excluded from tsc).
 */

/** Normalize a raw Host header to a bare lowercase hostname (or null). */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let h = raw.trim().toLowerCase();
  h = h.split(",")[0].trim();        // first value if a header list slipped through
  const at = h.lastIndexOf("@");     // defensive: strip any userinfo
  if (at !== -1) h = h.slice(at + 1);
  h = h.replace(/:\d+$/, "");        // strip :port
  h = h.replace(/\.$/, "");          // strip trailing dot (FQDN form)
  return h || null;
}

/** Hosts that are OUR app (path mode) and must never be treated as a tenant custom domain. */
export function isCanonicalHost(host: string, appHost: string | null): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".vercel.app")) return true; // preview + prod *.vercel.app
  if (appHost && host === appHost) return true;  // configured canonical production host
  return false;
}
```

- [ ] **Step 4: Add the tsconfig exclusion**

In `tsconfig.json`, add `lib/tenant/host.check.mts` to the existing `exclude` array (which already lists the other `.check.mts` files). The array currently reads:

```json
"exclude": ["node_modules", "lib/branding/theme.check.mts", "lib/cms/blocks.check.mts", "lib/features.check.mts"]
```

Change it to:

```json
"exclude": ["node_modules", "lib/branding/theme.check.mts", "lib/cms/blocks.check.mts", "lib/features.check.mts", "lib/tenant/host.check.mts"]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node lib/tenant/host.check.mts`
Expected: `OK: host checks pass`

- [ ] **Step 6: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add lib/tenant/host.ts lib/tenant/host.check.mts tsconfig.json
git commit -m "feat(tenant): pure host normalization + canonical-host helpers"
```

---

### Task 3: Types + env

**Files:**
- Modify: `lib/env.ts`
- Modify: `lib/types.ts:19-32` (Tenant type) and `lib/types.ts:248-266` (Functions)

- [ ] **Step 1: Add the optional APP_HOST env var**

In `lib/env.ts`, add an `APP_HOST` field to the exported `env` object (after `SUPABASE_KEY`). It is optional — unset is a safe default (only `localhost` + `*.vercel.app` are canonical):

```ts
export const env = {
  SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  SUPABASE_KEY: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  /** Canonical production host (e.g. "tgp.example.com"); when set it is treated
   *  as path-mode, never a tenant custom domain. Optional — defaults to null. */
  APP_HOST: process.env.NEXT_PUBLIC_APP_HOST ?? null,
};
```

- [ ] **Step 2: Add the two new `tenants` columns to the `Tenant` type**

In `lib/types.ts`, the `Tenant` type (around line 19) already has `custom_domain: string | null;`. Add the two verify columns immediately after it:

```ts
export type Tenant = {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  domain_verify_token: string | null;
  domain_verified_at: string | null;
  status: TenantStatus;
  plan_type: string;
  member_id_prefix: string;
  member_seq: number;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  created_at: string;
};
```

- [ ] **Step 3: Register the new RPC in the `Functions` map**

In `lib/types.ts`, in `Database.Functions` (around line 248), add the `resolve_tenant_by_host` entry next to `resolve_tenant_by_slug`:

```ts
      resolve_tenant_by_slug: {
        Args: { p_slug: string };
        Returns: ResolvedTenant[];
      };
      resolve_tenant_by_host: {
        Args: { p_host: string };
        Returns: ResolvedTenant[];
      };
```

- [ ] **Step 4: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts lib/types.ts
git commit -m "feat(types): tenants verify columns, resolve_tenant_by_host, APP_HOST env"
```

---

### Task 4: Host resolver in `resolve.ts`

**Files:**
- Modify: `lib/tenant/resolve.ts` (full rewrite of the file)

- [ ] **Step 1: Rewrite `resolve.ts` with a namespaced cache + host resolver**

Replace the entire contents of `lib/tenant/resolve.ts` with:

```ts
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database, ResolvedTenant } from "@/lib/types";

/**
 * Middleware-side tenant resolution. Uses a plain anon client (no cookies — the
 * RPCs are SECURITY DEFINER and public) plus a short in-memory TTL cache so we
 * don't hit the DB on every request. Runs on the Node runtime (see proxy.ts).
 *
 * The cache is namespaced ("slug:" vs "host:") so a slug and a host can never
 * collide on the same key.
 */
const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: { persistSession: false },
});

const TTL_MS = 60_000;
const NEG_TTL_MS = 5_000;
const cache = new Map<string, { tenant: ResolvedTenant | null; expires: number }>();

async function resolveCached(
  key: string,
  fetcher: () => Promise<ResolvedTenant | null>,
): Promise<ResolvedTenant | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.tenant;

  const tenant = await fetcher();
  cache.set(key, { tenant, expires: now + (tenant ? TTL_MS : NEG_TTL_MS) });
  return tenant;
}

/** Resolve a tenant by its `/t/[slug]` slug (returns suspended tenants too). */
export async function resolveTenantForMiddleware(
  slug: string,
): Promise<ResolvedTenant | null> {
  return resolveCached(`slug:${slug}`, async () => {
    const { data, error } = await client.rpc("resolve_tenant_by_slug", {
      p_slug: slug,
    });
    return error || !data?.[0] ? null : (data[0] as ResolvedTenant);
  });
}

/** Resolve a tenant by verified, active custom domain (host). */
export async function resolveTenantByHost(
  host: string,
): Promise<ResolvedTenant | null> {
  return resolveCached(`host:${host}`, async () => {
    const { data, error } = await client.rpc("resolve_tenant_by_host", {
      p_host: host,
    });
    return error || !data?.[0] ? null : (data[0] as ResolvedTenant);
  });
}
```

- [ ] **Step 2: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add lib/tenant/resolve.ts
git commit -m "feat(tenant): resolveTenantByHost + namespaced resolve cache"
```

---

### Task 5: Middleware host-mode branch

**Files:**
- Modify: `lib/supabase/proxy.ts:1-5` (imports) and after `:76` (insert the host-mode branch)

**Scene-setting:** `updateSession` currently: (1) builds the Supabase client + calls `getUser()`, (2) handles `/t/[slug]/...` (public `id`/`home` passthrough, else resolve-by-slug → inject `x-tenant-*` headers → rewrite to flat route), (3) handles bare workspace paths + global routes. You are adding a **host-mode branch immediately after `getUser()` returns and `path` is computed, before the `/t/` branch.** On a non-canonical Host the whole path is tenant-relative, so it mirrors the `/t/` logic but with no `/t/[slug]` prefix to strip, an **empty basepath**, and the public routes are **rewritten** to `/t/<slug>/...` (their real route tree lives under `app/t/[tenant]/...`).

- [ ] **Step 1: Add imports**

At the top of `lib/supabase/proxy.ts`, the imports currently are:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { resolveTenantForMiddleware } from "@/lib/tenant/resolve";
```

Change them to add the host helpers and `resolveTenantByHost`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { isCanonicalHost, normalizeHost } from "@/lib/tenant/host";
import {
  resolveTenantByHost,
  resolveTenantForMiddleware,
} from "@/lib/tenant/resolve";
```

- [ ] **Step 2: Insert the host-mode branch**

In `lib/supabase/proxy.ts`, find this existing line (currently ~line 76):

```ts
  const path = request.nextUrl.pathname;

  // ---- Tenant-scoped routes: /t/[slug]/<rest> -------------------------------
```

Insert the host-mode branch **between** `const path = ...` and the `// ---- Tenant-scoped routes` comment:

```ts
  const path = request.nextUrl.pathname;

  // ---- Custom-domain host mode ----------------------------------------------
  // A request on a non-canonical Host is a tenant's verified custom domain; its
  // whole path is tenant-relative (a transparent alias for /t/[slug]).
  const host = normalizeHost(request.headers.get("host"));
  if (host && !isCanonicalHost(host, env.APP_HOST)) {
    const tenant = await resolveTenantByHost(host);
    if (!tenant) return rewrite("/workspace-not-found", request, response);

    const seg0 = path.split("/").filter(Boolean)[0];

    // Public per-tenant verification + homepage are anonymous. Their real routes
    // live under app/t/[tenant]/..., so rewrite to the /t/<slug> path (stripping
    // any spoofed tenant headers).
    if (seg0 === "id" || seg0 === "home") {
      const clean = new Headers(request.headers);
      clean.delete("x-tenant-id");
      clean.delete("x-tenant-slug");
      clean.delete("x-tenant-basepath");
      return rewrite(`/t/${tenant.slug}${path}`, request, response, clean);
    }

    // Logged-out → global login carrying the tenant slug + return path.
    if (!user) {
      return redirect(
        `/login?tenant=${encodeURIComponent(tenant.slug)}&next=${encodeURIComponent(path)}`,
        request,
        response,
      );
    }

    // Authed workspace: inject trusted headers (empty basepath = root-relative
    // links) and rewrite to the flat (app) route; root → dashboard.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-tenant-id");
    requestHeaders.delete("x-tenant-slug");
    requestHeaders.delete("x-tenant-basepath");
    requestHeaders.set("x-tenant-id", tenant.id);
    requestHeaders.set("x-tenant-slug", tenant.slug);
    requestHeaders.set("x-tenant-basepath", "");

    return rewrite(
      path === "/" ? "/dashboard" : path,
      request,
      response,
      requestHeaders,
    );
  }

  // ---- Tenant-scoped routes: /t/[slug]/<rest> -------------------------------
```

- [ ] **Step 3: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build completes without errors (the middleware/`proxy.ts` compiles for the Node runtime).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/proxy.ts
git commit -m "feat(middleware): custom-domain host mode (Host → tenant alias)"
```

---

### Task 6: Platform actions

**Files:**
- Modify: `lib/actions/platform.ts` (add imports at top + three exported actions at end)

**Scene-setting:** `lib/actions/platform.ts` is a `"use server"` file. It exports `PlatformState = { error?: string; notice?: string }` and a private `getPlatformContext()` that returns `{ supabase, user }` after enforcing platform-admin (throws otherwise). Existing actions like `updateTenantBranding(_prev, formData)` follow the `useActionState` signature, write `tenants` via the authed client (RLS already permits platform-admin writes), and `revalidatePath(\`/platform/tenants/${tenantId}\`)`. You add three more in the same style.

- [ ] **Step 1: Add imports**

At the top of `lib/actions/platform.ts`, below the existing imports, add:

```ts
import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";

import { env } from "@/lib/env";
import { isCanonicalHost, normalizeHost } from "@/lib/tenant/host";
```

- [ ] **Step 2: Append `setCustomDomain`**

At the end of `lib/actions/platform.ts`, add:

```ts
/** Set (or replace) a tenant's custom domain; generates a fresh verify token. */
export async function setCustomDomain(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const domain = normalizeHost(String(formData.get("domain") ?? ""));
  if (!domain || !domain.includes(".")) {
    return { error: "Enter a valid domain, e.g. members.acme.org." };
  }
  if (isCanonicalHost(domain, env.APP_HOST)) {
    return { error: "That host is reserved by the platform." };
  }

  const token = randomBytes(16).toString("hex");
  const { error } = await supabase
    .from("tenants")
    .update({
      custom_domain: domain,
      domain_verify_token: token,
      domain_verified_at: null,
    })
    .eq("id", tenantId);
  if (error) {
    if (error.code === "23505") {
      return { error: "That domain is already in use by another tenant." };
    }
    return { error: error.message };
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Domain saved. Add the TXT record, then verify." };
}
```

- [ ] **Step 3: Append `verifyCustomDomain`**

```ts
/** Verify domain ownership via a DNS TXT record (_tgp-verify.<domain>). */
export async function verifyCustomDomain(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const { data: tenant, error: readErr } = await supabase
    .from("tenants")
    .select("custom_domain, domain_verify_token")
    .eq("id", tenantId)
    .maybeSingle<{ custom_domain: string | null; domain_verify_token: string | null }>();
  if (readErr) return { error: readErr.message };
  if (!tenant?.custom_domain || !tenant.domain_verify_token) {
    return { error: "Save a domain first." };
  }

  let records: string[][] = [];
  try {
    records = await dns.resolveTxt(`_tgp-verify.${tenant.custom_domain}`);
  } catch {
    return {
      error: "TXT record not found yet — DNS can take a few minutes to propagate.",
    };
  }
  // A TXT value may be split into multiple chunks; join each record before comparing.
  const matched = records.some(
    (chunks) => chunks.join("").trim() === tenant.domain_verify_token,
  );
  if (!matched) {
    return { error: "Found a TXT record but the token doesn't match yet." };
  }

  const { error } = await supabase
    .from("tenants")
    .update({ domain_verified_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (error) return { error: error.message };
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Domain verified — it's now live." };
}
```

- [ ] **Step 4: Append `removeCustomDomain`**

```ts
/** Remove a tenant's custom domain and clear verification state. */
export async function removeCustomDomain(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const { error } = await supabase
    .from("tenants")
    .update({
      custom_domain: null,
      domain_verify_token: null,
      domain_verified_at: null,
    })
    .eq("id", tenantId);
  if (error) return { error: error.message };
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Custom domain removed." };
}
```

- [ ] **Step 5: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add lib/actions/platform.ts
git commit -m "feat(platform): set/verify/remove custom-domain actions (DNS TXT)"
```

---

### Task 7: Domain card UI + wire into the tenant detail page

**Files:**
- Create: `components/platform/domain-card.tsx`
- Modify: `app/platform/tenants/[id]/page.tsx`

- [ ] **Step 1: Create the Domain card client component**

Create `components/platform/domain-card.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Globe, ShieldCheck, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  removeCustomDomain,
  setCustomDomain,
  verifyCustomDomain,
  type PlatformState,
} from "@/lib/actions/platform";

const initial: PlatformState = {};

export function DomainCard({
  tenantId,
  domain,
  token,
  verifiedAt,
}: {
  tenantId: string;
  domain: string | null;
  token: string | null;
  verifiedAt: string | null;
}) {
  const [setState, setAction] = useActionState(setCustomDomain, initial);
  const [verifyState, verifyAction] = useActionState(verifyCustomDomain, initial);
  const [removeState, removeAction] = useActionState(removeCustomDomain, initial);

  const error = setState.error || verifyState.error || removeState.error;
  const notice = setState.notice || verifyState.notice || removeState.notice;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{error}</span>
        </Alert>
      )}
      {!error && notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{notice}</span>
        </Alert>
      )}

      {!domain ? (
        <form action={setAction} className="space-y-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field>
            <Label htmlFor="domain">Custom domain</Label>
            <Input id="domain" name="domain" placeholder="members.acme.org" />
          </Field>
          <SubmitButton size="sm" pendingText="Saving…">
            <Globe />
            Save domain
          </SubmitButton>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="tgp-mono text-sm break-all">{domain}</span>
            {verifiedAt ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-emerald-500">
                <ShieldCheck className="size-3.5" /> Verified
              </span>
            ) : (
              <span className="shrink-0 text-xs text-amber-500">Pending verification</span>
            )}
          </div>

          {!verifiedAt && (
            <div className="space-y-2 rounded border border-border bg-muted/30 p-3 text-xs">
              <p className="text-muted-foreground">1. Add this DNS TXT record at your domain provider:</p>
              <div className="tgp-mono space-y-0.5">
                <div>
                  <span className="text-muted-foreground">Name:</span> _tgp-verify.{domain}
                </div>
                <div className="break-all">
                  <span className="text-muted-foreground">Value:</span> {token}
                </div>
              </div>
              <p className="text-muted-foreground">
                2. Add <span className="tgp-mono">{domain}</span> to the Vercel project (Settings →
                Domains) and point the domain&apos;s DNS at Vercel. TLS is issued automatically.
              </p>
            </div>
          )}

          {verifiedAt && (
            <a
              href={`https://${domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gold underline"
            >
              https://{domain}
            </a>
          )}

          <div className="flex gap-2">
            {!verifiedAt && (
              <form action={verifyAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <SubmitButton size="sm" pendingText="Checking…">
                  <ShieldCheck />
                  Verify
                </SubmitButton>
              </form>
            )}
            <form action={removeAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <SubmitButton size="sm" variant="destructive" pendingText="…">
                <Trash2 />
                Remove
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the card on the tenant detail page**

In `app/platform/tenants/[id]/page.tsx`, add the import alongside the other `@/components/platform/*` imports (near line 6):

```tsx
import { DomainCard } from "@/components/platform/domain-card";
```

Then add a new `Card` immediately after the closing `</Card>` of the Branding card (the last card before the final `</div>`, around line 128):

```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom domain</CardTitle>
        </CardHeader>
        <CardContent>
          <DomainCard
            tenantId={tenant.id}
            domain={tenant.custom_domain}
            token={tenant.domain_verify_token}
            verifiedAt={tenant.domain_verified_at}
          />
        </CardContent>
      </Card>
```

(`tenant.domain_verify_token` and `tenant.domain_verified_at` are now on the `Tenant` type from Task 3, and the page already selects `*`.)

- [ ] **Step 3: Verify tsc is clean**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add components/platform/domain-card.tsx app/platform/tenants/[id]/page.tsx
git commit -m "feat(platform): custom-domain management card on tenant detail"
```

---

### Task 8: Final verification (manual — user-run)

This task has no code. After Tasks 1–7 are committed, hand the user the runbook below. The DB-dependent and DNS-dependent steps cannot be automated here.

- [ ] **Step 1: Static gates (you run these)**

```bash
node lib/tenant/host.check.mts   # → OK: host checks pass
npx tsc --noEmit                 # → clean
npm run build                    # → builds
```

- [ ] **Step 2: User applies the migration + probe**

1. Supabase SQL Editor → paste `supabase/migrations/0014_custom_domains.sql` → Run.
2. Paste `supabase/tests/0014_custom_domains_checks.sql` → Run → expect four `OK:` notices + `ALL 0014 CHECKS PASSED`, ends in `ROLLBACK`, no `FAIL`.

- [ ] **Step 3: User runs the integration runbook**

As a **platform admin** at `/platform/tenants/<org-b-id>`:
1. **Set** a domain (e.g. `members.acme.org`) → card shows the `_tgp-verify.…` TXT record + **Pending**.
2. Click **Verify** *before* adding DNS → stays **Pending** with the "TXT record not found yet" message.
3. Add the TXT record at the DNS provider **and** add the domain to the Vercel project (Settings → Domains); point DNS at Vercel; wait for propagation + TLS.
4. Click **Verify** → flips to **Verified** with the live `https://members.acme.org` link.
5. Visit `https://members.acme.org/` → Org-B dashboard (or login if logged out), `…/home` → Org-B homepage, `…/id/<card-slug>` → Org-B verify card — all Org-B-themed with root-relative links.
6. **Remove** → the host now 404s (`workspace-not-found`).
7. Confirm TGP and all `/t/[slug]` path-mode URLs are unchanged throughout.

---

## Notes for the executor

- **Do not** attempt to apply migrations or run `psql` — you have no DB access. Author the SQL, commit, and defer DB verification to the user (Task 8 Step 2).
- The `node:dns` lookup in `verifyCustomDomain` runs on the server (Node runtime) — never in the client bundle. Keep the action in the `"use server"` file.
- After all tasks: dispatch the final whole-implementation code review, then use `superpowers:finishing-a-development-branch`. **Do not merge** until the user confirms the migration + probe + runbook pass (the established per-sub-project gate).
