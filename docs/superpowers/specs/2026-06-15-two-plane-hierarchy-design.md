# Two-Plane Hierarchy: Platform vs Tenant (#7b) — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #7b — the entry/identity layer. Realizes [[saas-two-plane-hierarchy]]. Paired with
#7a (invite lockdown); see [[saas-os-roadmap]].

---

## Context

The app began single-tenant (TGP), so TGP "leaked" into the platform: the root URL, the global
`/login`/`/register`, and the default branding all show TGP. Root cause in one line — **`lib/constants.ts`
`SITE` *is* TGP** (`name: "Tau Gamma Phi"`, glyph, motto), and every "platform default"
(`brandForSlug(undefined)`, `getBrand()`, `app/page.tsx`, the auth pages) falls back to `SITE`.

This sub-project separates the two planes and **demotes TGP to a normal tenant**:

- **Platform plane** = the SaaS's own root domain. Neutral SaaS landing + a **dedicated super-admin
  login portal `/platform/login`** → `/platform` console. Not tenant-branded.
- **Tenant plane** = each org via its **custom domain** (#4b) or `/t/[slug]` fallback. Each tenant has
  its **own homepage + `/login` + `/register`**, branded and bound to that tenant.

Build order: **Part A (platform plane) first** — it delivers the super-admin portal + de-TGP'd root,
the most visible win and the thing currently blocking the user. **Part B (tenant plane)** follows.
(Each part is its own implementation plan.)

## Decisions locked during brainstorming

1. **Root = platform; TGP becomes a tenant** at `/t/tgp` (later `taugammaphi.org`). The root stops
   being TGP-branded.
2. **Dedicated super-admin login portal** `/platform/login` (neutral), separate from any org homepage.
3. **Tenant-scoped `/t/[slug]/login` + `/register`**, branded + bound to that tenant; custom-domain
   `/login` auto-branded.
4. **Registration stays invite-only** (#7a): the homepage "Apply/Join" button = **"Request access"**,
   not open signup.
5. The `feat/platform-login-redirect` branch (platform admins → `/platform` after login) is the first
   built slice and folds into Part A.

---

## Part A — Platform plane (build first)

### A1. Split platform identity from TGP identity
- Add a **neutral `PLATFORM` brand** (new `lib/constants.ts` `PLATFORM = { name: "Organization
  Registry", … }` — final name TBD-by-user, default "Organization Registry"). The platform plane uses
  `PLATFORM`; **`SITE` stops being a global default**.
- `lib/branding/brand.ts`: `getBrand()` and `brandForSlug(undefined)` fall back to **`PLATFORM`**, not
  `SITE`. TGP's identity now comes **only** from its `tenants` row (`name`, `logo_url`, colors).
- Replace hardcoded `TgpSeal` on platform/neutral surfaces with the brand-driven `Brandmark` (#5a). A
  neutral platform mark (monogram from `PLATFORM.name`) when there's no tenant.
- **Set TGP's `tenants.logo_url`** (and colors if desired) via the console/SQL so TGP keeps its seal
  on its own tenant surfaces (it currently renders a neutral mark because `logo_url` is null).

### A2. Neutral root landing — `app/page.tsx`
Rewrite the root to a **neutral SaaS landing** (platform brand, generic copy — "multi-tenant
membership platform"), not the TGP seal. For a logged-in user keep the existing convenience: a
**platform admin** → link/redirect to `/platform`; a tenant member → their workspace switcher /
single-workspace redirect (unchanged logic, neutral chrome). A logged-out visitor sees the neutral
landing + a discreet **"Administrator sign-in"** link → `/platform/login`.

### A3. Dedicated super-admin portal — `/platform/login`
- **Route restructure (keeps every `/platform…` URL identical):** move the guarded layout + console
  pages into a `(console)` route group — `app/platform/(console)/layout.tsx` (holds
  `requirePlatformAdmin()` + console chrome), `(console)/page.tsx`, `(console)/tenants/[id]/page.tsx`,
  and the #7a `(console)/members` + `(console)/audit` pages. `/platform/login` lives **outside** the
  group (ungated).
- **`app/platform/login/page.tsx`** — platform-branded login (`PLATFORM` brand, "Super Admin"
  eyebrow), renders the shared `AuthScreen` (Part B1) with `next="/platform"`. If already a platform
  admin → redirect `/platform`.
- **Wire the flow:** `requirePlatformAdmin()` redirects a logged-out visitor to **`/platform/login`**
  (instead of the generic `/login`). The already-built post-login redirect (platform admins →
  `/platform`) completes it: `/platform` (logged out) → `/platform/login` → sign in → `/platform`. A
  non-admin who logs in there hits the guard → `/forbidden`.

## Part B — Tenant plane

### B1. Shared `AuthScreen` component (DRY)
Extract `components/auth/auth-screen.tsx` `{ mode, brand, tenant?, next?, loginHref, registerHref,
showRegister }` rendering brand header → heading → existing `AuthForm`/`RegisterForm` → cross-link.
All five surfaces (platform login, global login/register, tenant login/register) become thin pages
over it. This is the only refactor; it directly serves the goal.

### B2. Tenant-scoped routes
- **`app/t/[tenant]/login/page.tsx`** + **`app/t/[tenant]/register/page.tsx`** — brand via
  `brandForSlug(slug)`, render `AuthScreen` with `tenant={slug}`, `next='/t/<slug>/dashboard'`, and
  tenant cross-links (`/t/<slug>/login` ↔ `/t/<slug>/register`). Logged-in member → redirect to the
  dashboard.
- **Middleware:** extend the `/t/` branch public passthrough from `{id, home}` to `{id, home, login,
  register}` (else they bounce to the global login → loop). One-line change in `lib/supabase/proxy.ts`.
- **Custom-domain tie-in:** `acme.org/login` / `/register` rewrite to `/t/<slug>/login` so they're
  **auto-branded** for that tenant (host-mode already passes `login`/`register` through — point them
  at the tenant route). `/auth/*` stays a global passthrough.

### B3. Custom-domain root → tenant homepage
In host-mode, `acme.org/` (root) → the public homepage (`rewrite('/t/<slug>/home')`) instead of the
dashboard. The org's domain root becomes its public front door. (Path-mode `/t/[slug]` bare root is
left as-is for now — out of scope tweak.)

### B4. Homepage front-door buttons
The tenant homepage (`/t/[slug]/home`, #5b) gains **"Sign In"** (→ tenant `/login`) and **"Request
access"** (→ tenant `/register`, the invite-claim page under #7a) buttons. Implemented via the
existing CMS **CTA block** defaults (no schema change) or a built-in header — plan picks the lighter
path. "Request access" wording honors invite-only.

## Cross-cutting: de-TGP audit
A sweep for remaining `SITE`/`TgpSeal` hardcodes on tenant-agnostic surfaces (workspace switcher,
auth chrome, metadata titles, the verify/ID fallbacks) — each becomes either `PLATFORM` (platform
plane) or tenant-brand-driven (tenant plane). TGP-specific copy (motto, founding year, ΤΓΦ glyph)
stays **only** behind TGP's tenant identity, never as a platform default.

## Interaction with #7a (invite lockdown)
Independent but complementary. If #7b ships first, the tenant `/register` routes are open (self-join)
until #7a converts them to invite-claim. If #7a ships first, #7b's `/register` routes are invite-claim
from day one. **Recommended order: #7b Part A → #7b Part B → #7a**, since the user's immediate need is
the hierarchy/portal; the "Request access" button is wired now and becomes truly gated when #7a lands.

## Out of scope (YAGNI / later)
- Renaming/rebranding the platform beyond a neutral `PLATFORM` constant (final SaaS name is a user
  choice; default provided).
- Path-mode bare `/t/[slug]` root behavior change (only custom-domain root → homepage here).
- Per-tenant email/SMTP, OAuth, password reset.
- Moving TGP onto a real custom domain (operational; #4b already supports it — just set
  `custom_domain`).
- Cross-origin auth handoff (login renders same-origin on each domain).

## Files (indicative; split across two plans)
- **Part A:** `lib/constants.ts` (`PLATFORM`), `lib/branding/brand.ts` (default → `PLATFORM`),
  `app/page.tsx` (neutral landing), `app/platform/login/page.tsx`, `app/platform/(console)/layout.tsx`
  (+ move `page.tsx`/`tenants/[id]`/`members`/`audit` into the group), `lib/platform.ts`
  (`requirePlatformAdmin` → `/platform/login`), `lib/actions/auth.ts` (the redirect — already on
  `feat/platform-login-redirect`), `components/brand/*` (neutral Brandmark on platform surfaces),
  set TGP `tenants.logo_url`.
- **Part B:** `components/auth/auth-screen.tsx`, `app/t/[tenant]/login/page.tsx`,
  `app/t/[tenant]/register/page.tsx`, `app/(auth)/login|register/page.tsx` (use `AuthScreen`),
  `lib/supabase/proxy.ts` (passthrough + custom-domain root→home + login branding),
  `components/cms/*` or the homepage page (Sign-In/Request-access buttons).

## Verification
1. **Part A:** `/` shows a neutral landing (no TGP seal); `/platform` logged-out → `/platform/login`;
   sign in as super admin → `/platform`; non-admin signing in at `/platform/login` → `/forbidden`;
   TGP surfaces (`/t/tgp/...`) still show TGP identity (from its tenant row). `tsc`+`build` clean.
2. **Part B:** `/t/tgp/login` + `/register` render TGP-branded, no loop, sign-in → `/t/tgp/dashboard`;
   on a custom domain `acme.org/` → homepage, `acme.org/login` → that tenant's branded login;
   homepage Sign-In/Request-access buttons land on the right routes. `tsc`+`build` clean.
3. **Manual runbook:** super admin signs in only via `/platform/login`; a TGP member signs in via
   `/t/tgp/login`; the root never shows TGP branding; existing sessions/links keep working
   (`/login?tenant=tgp` still resolves).
