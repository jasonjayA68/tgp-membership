# Tenant Resolution — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #2 of 6 in the "Organization SaaS OS" upgrade (follows [[saas-os-roadmap]] Sub-project #1)

---

## Context

Sub-project #1 made the data layer multi-tenant (`tenants`, `tenant_users`, membership RLS,
`custom_fields` member schema) and left `getActiveTenant()` in `lib/tenant/context.ts`
hardcoded to the `tgp` tenant as a deliberate seam. The app still has **flat routes**
(`/dashboard`, `/admin`, `/profile`, `/id/[slug]`) and a Next 16 `proxy.ts` →
`updateSession()` that only refreshes the Supabase session and does an optimistic auth gate.

This sub-project replaces the hardcoded seam with **real per-request tenant resolution**: a
request maps to a tenant, that tenant is attached to the request, and the authed workspace lives
under `/t/[slug]/…`. Custom domains / domain verification / TLS are **out of scope** here — they
are Sub-project #4 (onboarding); this design builds the seam they plug into.

## Decisions locked during brainstorming

1. **Resolution model** — `/t/[slug]` subpath is the working primary now (one domain, shared
   session cookie, no DNS/TLS, fully testable locally). The host→tenant seam is built so custom
   domains/subdomains slot in during #4.
2. **Surface mapping** — Workspace pages (`dashboard`, `admin`, `profile`) live under
   `/t/[slug]`; auth (`/login`, `/register`) and the landing (`/`) are global. Public
   `/id/[slug]` stays flat and unchanged (its tenant comes from the card; vanity
   `/t/[tenant]/id` is #3).
3. **Post-auth landing** — Root `/` is the workspace list: exactly 1 membership auto-redirects
   to `/t/[slug]/dashboard`; many → pick; 0 → "no workspaces yet".
4. **Join flow** — Logged-out visit to `/t/[slug]/*` → `/login?tenant=slug&next=…` with a
   "Join [Tenant]" CTA → `/register?tenant=slug` → pending member (TGP-style approval). Unknown
   slug → 404; suspended tenant → blocked notice.
5. **Links** — An explicit `tenantHref(basePath, path)` helper; the workspace layout reads the
   injected base path and threads it to nav/links/redirects.

---

## 1. Core mechanism: middleware resolves, header carries, routes stay flat

Route **files do not move**. `app/(app)/{dashboard,admin,profile}` stay flat. The `/t/[slug]`
prefix is a URL-space concern handled entirely by middleware. For a `/t/[slug]/<rest>` request,
`proxy.ts` (via `updateSession`):

1. **Strips** any incoming client-supplied `x-tenant-*` headers (anti-spoofing — only middleware
   may set them).
2. Extracts `slug`, resolves it to a tenant (§2). On miss → rewrite to a 404 "workspace not
   found" view; on `status = 'suspended'` → rewrite to a "workspace suspended" view.
3. Performs the optimistic, cookie-only auth gate: if no Supabase auth cookie and `<rest>` is a
   protected workspace path → redirect to `/login?tenant=<slug>&next=<original path>`.
4. Injects trusted request headers: `x-tenant-id`, `x-tenant-slug`,
   `x-tenant-basepath` (e.g. `/t/tgp`).
5. **Rewrites** `/t/<slug>/<rest>` → `/<rest>` so the existing flat route renders. The browser
   URL stays `/t/<slug>/<rest>`.

Bare workspace paths hit directly without a `/t/` prefix (e.g. `/dashboard`) on the app domain →
middleware redirects to `/` (in subpath mode they are not valid standalone URLs).

The same header contract serves custom domains later: host → `x-tenant-*` headers with an empty
`x-tenant-basepath`, no rewrite, same flat routes.

## 2. Public tenant-resolution RPC (migration `0008_tenant_resolution.sql`)

Middleware must resolve *any* slug→tenant even for logged-out visitors, but `tenants` RLS is
membership-gated (`is_tenant_member`). So, mirroring `get_member_card`, add:

```
resolve_tenant_by_slug(p_slug text) returns table (
  id uuid, name text, slug text, status public.tenant_status,
  logo_url text, primary_color text, secondary_color text
)  -- SECURITY DEFINER, search_path = public
```

`revoke all from public; grant execute to anon, authenticated`. This returns a whitelist (no
sensitive columns) and is the only DB change in this sub-project. A `resolve_tenant_by_domain`
variant is deferred to #4.

## 3. Routing & entry flow

| Surface | Path | Notes |
|---|---|---|
| Landing / workspace list | `/` | memberships; 1→redirect, many→pick, 0→empty state, logged-out→marketing+login |
| Auth | `/login`, `/register`, `/auth/*` | global; accept optional `?tenant=<slug>` + `next` |
| Workspace | `/t/[slug]/dashboard`, `/admin`, `/profile` | flat routes via rewrite; membership-gated |
| Public verify | `/id/[slug]` | **unchanged**; tenant from the card |

- **`/` landing:** server-loads the user's `tenant_users` memberships (joined to `tenants` for
  name/branding). 1 → redirect to `/t/[slug]/dashboard`; ≥2 → render a pick list; 0 → "no
  workspaces yet" empty state; no session → public landing with sign-in.
- **Login/register:** carry `?tenant=<slug>` and `next`. `signUp` passes `tenant_slug` in signup
  metadata (the #1 `handle_new_user` trigger already consumes it → pending membership). After
  login, redirect to a validated `next`, else `/` (which resolves the landing).
- **Logged-in non-member at `/t/[slug]`:** render a "Request to join [Tenant]" CTA that creates a
  pending `tenant_users(member)` + `profiles(pending)` pair (same self-join path), then admin
  approval as today.
- **Unknown slug → 404; suspended → blocked notice** (handled at the edge in §1).

## 4. App-layer changes

- **`lib/tenant/context.ts`** — `getActiveTenant()` reads `x-tenant-id`/`x-tenant-slug` from
  `next/headers` and fetches the tenant via `resolve_tenant_by_slug`; returns `null` on global
  routes (no header). Add `getActiveTenantBasePath()` (reads `x-tenant-basepath`).
- **`lib/tenant/resolve.ts`** (new) — `resolveTenantFromRequest(request)` for middleware: calls
  the RPC with a small in-memory TTL cache (slug→tenant) to avoid a DB hit per request.
- **`lib/tenant/links.ts`** (new) — `tenantHref(basePath, path)` → `${basePath}${path}` (empty
  base → bare path). Used by every workspace link/redirect.
- **`lib/auth.ts`** — `getAuth()` requires an active tenant (throws/redirects if missing on a
  workspace route); loads membership role + profile for that tenant; surfaces a
  `membership: 'member' | 'none'` signal so the layout can show the join CTA for logged-in
  non-members. Add `listMemberships()` (+ a light `getSessionUser()`) for the root landing.
- **`lib/supabase/proxy.ts`** — `updateSession` extended with the §1 resolution + rewrite +
  header injection, preserving the existing session-refresh and public-prefix behavior.
- **Pages/components** — root `app/page.tsx` becomes the workspace list; `app/(app)/layout.tsx`
  computes the base path and threads it to `app-nav`; `admin-nav`, dashboard/profile links, the
  verification/QR URL building, and the auth-action redirects all route through `tenantHref`.

## 5. Security & error handling

- **Anti-spoofing:** middleware deletes client `x-tenant-*` headers before setting its own; the
  app trusts these headers only because middleware is the sole writer.
- **Defense in depth:** middleware does the optimistic cookie-only gate; **authoritative**
  membership enforcement remains in `getAuth`/RLS (a forged path can't read another tenant's
  data — RLS blocks it).
- **Tenant existence vs. data:** `resolve_tenant_by_slug` (definer, whitelist) answers "does this
  workspace exist / is it active / its branding" for anon; it never exposes member data.
- Suspended/unknown tenants resolved at the edge; the public `/id` path and session refresh are
  unchanged.

## 6. Files

- **New:** `supabase/migrations/0008_tenant_resolution.sql`, `lib/tenant/resolve.ts`,
  `lib/tenant/links.ts`, `app/workspace-not-found` + `app/workspace-suspended` views (or a single
  parameterized state), a root workspace-list implementation in `app/page.tsx`, and a join-CTA
  surface for logged-in non-members.
- **Updated:** `proxy.ts` matcher (allow `/t/*`), `lib/supabase/proxy.ts`, `lib/tenant/context.ts`,
  `lib/auth.ts`, `lib/site.ts` (tenant-aware verification base), `lib/actions/auth.ts`
  (`?tenant`/`next` handling), `components/app/app-nav.tsx`, `components/admin/admin-nav.tsx`,
  dashboard/profile pages' links, and the `lib/types.ts` `Database.Functions` entry for the new RPC.

## 7. Out of scope (later sub-projects)

Custom-domain / subdomain **host** resolution + domain verification + TLS (#4); per-tenant join
policy / invite tokens (later); `/t/[tenant]/id` vanity verification (#3); tenant-switcher polish;
cross-domain SSO.

## 8. Verification

1. App builds (`next build`) and `tsc` is clean.
2. `/t/tgp/dashboard` resolves the TGP tenant (header set, flat route renders); links carry the
   `/t/tgp` prefix; nav works.
3. `/t/org-b/dashboard` as a non-member → join CTA; as a logged-out visitor → `/login?tenant=org-b`.
4. `/t/does-not-exist` → 404 workspace-not-found; a suspended tenant → blocked notice.
5. Spoof attempt: a client-sent `x-tenant-id` header is ignored (stripped) — `getActiveTenant`
   reflects the path-resolved tenant only.
6. Root `/`: a single-tenant user is redirected straight to their workspace; a multi-tenant test
   user sees the pick list; existing TGP flows (register→approve→activate→`/id` scan) still work.
