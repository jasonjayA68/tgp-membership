# Custom Domains (#4b) — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #4b of the "Organization SaaS OS" upgrade — the deferred seam from #2 (tenant
resolution). Follows [[saas-os-roadmap]] #1–#6.

---

## Context

#2 (tenant resolution) deliberately left a seam in middleware: tenants are resolved by `/t/[slug]`
subpath via trusted `x-tenant-*` headers, and HOST-based resolution was deferred to "#4/#4b". The
`tenants.custom_domain` column (`text unique`) already exists from #1 (`0007`) but is unused. This
sub-project lets a tenant be served on its own domain (e.g. `members.acme.org`) as a transparent
alias for `/t/[slug]`.

Deployment is **Vercel** (`.vercel/` present); middleware runs on the **Node** runtime
(`proxy.ts`). The app stores **no secrets** — only the Supabase anon publishable key — and this
sub-project preserves that rule.

## Decisions locked during brainstorming

1. **Provisioning = app-layer only (manual Vercel).** The app NEVER calls the Vercel API or stores a
   Vercel token. The platform operator attaches the domain to the Vercel project by hand (Vercel
   auto-issues TLS); the app only resolves `Host → tenant` and verifies DNS ownership. (Vercel API
   automation was explicitly rejected — it would require a stored secret.)
2. **Control = platform-admin only**, in the `/platform` console. The actual Vercel attach is a
   manual operator action anyway, so the whole flow lives in one role + one place. No tenant-owner
   self-serve, no request/approval queue.
3. **Verification = app-side DNS TXT check.** The app generates a random token; the operator/org
   adds `TXT _tgp-verify.<domain> = <token>`; a **Verify** action does a server-side `node:dns` TXT
   lookup and flips the domain to verified. Real ownership proof, no secrets.
4. **One domain per tenant** — reuse the existing singular, unique `custom_domain` column (YAGNI).
5. **Custom domain = transparent alias for `/t/[slug]`.** `acme.org/<rest>` behaves exactly like
   `/t/<slug>/<rest>`: root `/` → dashboard, `/home` + `/id/...` stay public. One code path; the
   org's root experience can be retuned later.

## The three layers (responsibility split)

- **Org (DNS):** points the domain at Vercel (CNAME/A) **and** adds `TXT _tgp-verify.<domain>=<token>`.
- **Platform admin:** adds the domain to the Vercel project once (TLS auto-issued), then clicks
  **Verify** in `/platform`.
- **App:** resolves `Host → tenant`, but **only for verified + active domains**.

---

## 1. Data model — migration `0014_custom_domains.sql`

Reuse `tenants.custom_domain` (already `text unique`). Add two columns:

- `domain_verify_token text` — random token (e.g. `encode(gen_random_bytes(16), 'hex')`) for the TXT
  record.
- `domain_verified_at timestamptz` — `null` = pending; non-null = live. **This is the gate.**

Store `custom_domain` lowercased (normalized at the action layer; the resolver also lowercases the
incoming host).

## 2. Host resolver — `resolve_tenant_by_host(p_host text)` (in `0014`)

SECURITY DEFINER, `set search_path = public`, granted to `anon, authenticated`, revoke from public.
Returns the **same whitelist column shape** as `resolve_tenant_by_slug` (`id, name, slug, status,
logo_url, primary_color, secondary_color`) so `ResolvedTenant` is unchanged. Hard filter:

```sql
select t.id, t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color
from public.tenants t
where t.custom_domain = lower(p_host)
  and t.domain_verified_at is not null
  and t.status = 'active'
limit 1;
```

Unverified or suspended → returns nothing → the host is not served. (Note: this is stricter than the
slug resolver, which returns suspended tenants so the app can show `/workspace-suspended`. A custom
domain for a suspended tenant simply 404s — there is no suspended-domain UX, by design.)

## 3. Host normalization — `lib/tenant/host.ts` (pure, Node-testable)

```ts
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let h = raw.trim().toLowerCase();
  const at = h.lastIndexOf("@"); // defensive: strip any userinfo
  if (at !== -1) h = h.slice(at + 1);
  h = h.split(",")[0].trim();    // first value if a header list slipped through
  h = h.replace(/:\d+$/, "");    // strip :port
  h = h.replace(/\.$/, "");      // strip trailing dot (FQDN form)
  return h || null;
}

/** Hosts that are OUR app (path mode), never a tenant custom domain. */
export function isCanonicalHost(host: string, appHost: string | null): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".vercel.app")) return true;      // preview + prod *.vercel.app
  if (appHost && host === appHost) return true;        // configured canonical host
  return false;
}
```

`lib/tenant/host.check.mts` (tsconfig-excluded, run via `node`): lowercases, strips `:port`, strips
trailing `.`, strips userinfo, returns `null` for empty; `isCanonicalHost` true for
`localhost`/`*.vercel.app`/the configured `appHost`, false for a real custom domain.

`NEXT_PUBLIC_APP_HOST` is added to `lib/env.ts` as an **optional** var (canonical production host,
e.g. `tgp.example.com`). When unset, only `localhost` + `*.vercel.app` are treated as canonical
(safe default — a real custom domain still resolves; the canonical host just falls through to path
mode either way).

## 4. Middleware host-mode (`lib/supabase/proxy.ts` + `lib/tenant/resolve.ts`)

A new branch in `updateSession`, placed **after `getUser()` and before the `/t/` branch**:

```
host = normalizeHost(request.headers.get("host"))
if host && !isCanonicalHost(host, env.APP_HOST):
    tenant = await resolveTenantByHost(host)      // cache keyed "host:" + host
    if !tenant: return rewrite("/workspace-not-found")    // verified+active only
    # custom domain → path is already tenant-relative; reuse the /t rest-mapping:
    seg0 = first path segment
    if seg0 == "id" or seg0 == "home":            # public passthrough, strip spoofed headers
        return passthrough
    if !user: return redirect to global /login?tenant=<slug>&next=<path-on-canonical?>  # see note
    inject x-tenant-id/slug, x-tenant-basepath = ""   # root-relative links
    return rewrite(path == "/" ? "/dashboard" : path, requestHeaders)
# else: existing canonical-host logic (path mode) unchanged
```

`lib/tenant/resolve.ts` gains `resolveTenantByHost(host)` mirroring `resolveTenantForMiddleware`
(same anon client, same TTL/neg-TTL cache, **separate key namespace** — prefix `host:` vs the slug
map, or a second Map). RPC: `resolve_tenant_by_host`.

**Login redirect note:** on a custom domain the global login lives on the canonical host. For the
minimal scope, redirect to the **same-origin** `/login?tenant=<slug>&next=<path>` (login renders on
the custom domain too — it's a global route that works on any host; after auth the user lands back on
the custom domain). No cross-origin auth handoff is built (YAGNI). The `next` path is the
custom-domain-relative path.

**Anti-spoofing:** identical to today — delete any client-supplied `x-tenant-*` before injecting; the
`id`/`home` passthrough strips them too.

## 5. Platform actions — `lib/actions/platform.ts` (platform-admin only)

`tenants` writes are already gated to platform admins by RLS (from #4 `updateTenantBranding`). These
follow the **exact existing pattern** of `updateTenantBranding`: signature
`(_prev: PlatformState, formData: FormData): Promise<PlatformState>` (driven by `useActionState`),
obtaining the authed client via `getPlatformContext()` (which enforces platform-admin), and ending
with `revalidatePath(\`/platform/tenants/${tenantId}\`)`. `PlatformState = { error?: string;
notice?: string }`.

- `setCustomDomain(_prev, formData)` — `tenantId` + `domain`; `normalizeHost` the input, reject
  empty / obviously invalid (no dot, or a canonical/`*.vercel.app` host) with `{ error }`; generate a
  token (`crypto.randomUUID().replace(/-/g, "")` or `crypto.randomBytes(16).toString("hex")`); write
  `custom_domain`, `domain_verify_token`, and **clear** `domain_verified_at`. Unique-violation (PG
  `23505`) → `{ error: "That domain is already in use by another tenant." }`. Success → `{ notice }`.
- `verifyCustomDomain(_prev, formData)` — `tenantId`; read `custom_domain` + `domain_verify_token`;
  if either missing → `{ error }`; `node:dns/promises.resolveTxt("_tgp-verify." + domain)`; flatten
  the `string[][]` records; if the token is present → set `domain_verified_at = now()` →
  `{ notice: "Domain verified." }`. DNS errors (`ENOTFOUND`/`ENODATA`) or token-not-found → leave
  unverified → `{ error: "TXT record not found yet — DNS can take a few minutes." }`. No secrets, no
  external API.
- `removeCustomDomain(_prev, formData)` — `tenantId`; null `custom_domain`, `domain_verify_token`,
  `domain_verified_at` → `{ notice }`.

All three `revalidatePath(\`/platform/tenants/${tenantId}\`)`.

## 6. Platform console UI

A **Domain** card in the `/platform` per-tenant view (`components/platform/...` + the tenant detail
page):

- No domain set → a single domain `<input>` + "Save domain" (calls `setCustomDomain`).
- Domain set, pending → show the exact TXT record to create
  (`_tgp-verify.<domain>` → `<token>`), a **Verify** button (`verifyCustomDomain`), a
  **Pending** badge, a **Remove** button, and a static note: *"Also add `<domain>` to the Vercel
  project (Settings → Domains); Vercel issues TLS automatically. Point the domain's DNS at Vercel."*
- Domain set, verified → **Verified** badge (with timestamp), the live URL `https://<domain>`, and
  **Remove**.

Reuses existing platform form/badge patterns. Server components + form actions; no new client-side
state machine.

## 7. Types — `lib/types.ts`

Add `custom_domain`, `domain_verify_token`, `domain_verified_at` to the `tenants` table type.
`ResolvedTenant` is **unchanged** (the host resolver returns the existing whitelist shape). Register
the two RPCs (`resolve_tenant_by_host`) if RPC return types are enumerated there.

## 8. Verification

1. **`0014` probe (`supabase/tests/0014_custom_domains_checks.sql`)** — transactional:
   - Seed a tenant with `custom_domain='probe.example.com'`, `domain_verify_token` set,
     `domain_verified_at` null → `resolve_tenant_by_host('probe.example.com')` returns **0 rows**.
   - Set `domain_verified_at = now()` → returns **1 row** with the right `slug`.
   - Case/host: `resolve_tenant_by_host('PROBE.example.com')` still returns the row (resolver
     lowercases).
   - Set `status='suspended'` → returns **0 rows** again.
   - Ends in `ROLLBACK`.
2. **`lib/tenant/host.check.mts` (Node)** — `normalizeHost` + `isCanonicalHost` assertions above.
3. **`tsc` + `build`** clean.
4. **Manual runbook:** (a) in `/platform`, set a domain for Org-B → see the TXT record + Pending;
   (b) without the TXT record, click **Verify** → stays Pending; (c) add the TXT record at the DNS
   provider + add the domain in Vercel → **Verify** flips to Verified; (d) visit `https://<domain>/`
   → Org-B dashboard (or login), `https://<domain>/home` → Org-B homepage, `https://<domain>/id/<slug>`
   → Org-B verify card, all themed as Org-B with root-relative links; (e) Remove → the host 404s
   (`workspace-not-found`); TGP and `/t/[slug]` path mode unchanged throughout.

## 9. Out of scope (YAGNI / deferred)

- **Vercel API automation** (attach domain / poll cert via API) — needs a stored secret; rejected.
- **Multiple domains per tenant** and **`www` + apex pairing** — one domain per tenant; `www`→apex
  is a DNS-level redirect the org configures.
- **Canonical 301** from `/t/[slug]` → the custom domain — both keep working; no auto-redirect.
- **Wildcard subdomains** / per-tenant subdomains of the platform host.
- **Cross-origin auth handoff** — login renders same-origin on the custom domain (global route).
- **Suspended-domain UX** — a suspended tenant's custom domain simply 404s (no banner).

## 10. Files

- **New:** `supabase/migrations/0014_custom_domains.sql`,
  `supabase/tests/0014_custom_domains_checks.sql`, `lib/tenant/host.ts`,
  `lib/tenant/host.check.mts`, `components/platform/domain-card.tsx` (or equivalent).
- **Updated:** `lib/supabase/proxy.ts` (host-mode branch), `lib/tenant/resolve.ts`
  (`resolveTenantByHost` + host cache key), `lib/env.ts` (optional `NEXT_PUBLIC_APP_HOST`),
  `lib/actions/platform.ts` (`setCustomDomain`/`verifyCustomDomain`/`removeCustomDomain`),
  `lib/types.ts` (tenants columns + RPC), the `/platform` tenant detail page (render the Domain card),
  `tsconfig.json` (exclude `lib/tenant/host.check.mts`).
