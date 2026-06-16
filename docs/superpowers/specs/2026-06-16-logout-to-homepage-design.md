# Logout to Organization Homepage — Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Follows:** #7b Part B (tenant entry). See [[saas-two-plane-hierarchy]].

---

## Context

A member who signs out is currently sent to the **global `/login`** (`signOut` hardcodes it). With
the two-plane hierarchy in place, a member should instead land on **their organization's homepage**
(`/t/[slug]/home`), where the Part B Sign-in / Apply buttons let them sign back in. Every tenant
already has a working homepage (`get_tenant_homepage` LEFT-joins and the page falls back to
`DEFAULT_HOME`), and per-tenant customization already exists (the #5b CMS editor) — so the only new
behavior is making **logout destination-aware**.

## Decisions locked during brainstorming

1. **Members → their org homepage** on logout; **super admins → `/platform/login`**.
2. **No homepage seeding** — every tenant shares the default homepage until customized (already works).
3. **No homepage customization work** — already shipped in #5b.
4. **Open-redirect-safe** — the logout destination is validated to an internal path.

## 1. `signOut` becomes destination-aware — `lib/actions/auth.ts`

Change `signOut()` (currently `(): Promise<void>` redirecting to `/login`) to
`signOut(formData: FormData): Promise<void>`:
- After `supabase.auth.signOut()`, read `formData.get("redirectTo")`.
- Accept it **only** if it's an internal, non-protocol-relative path (`startsWith("/")` and not `//`
  or `/\`) — identical to the guard on the tenant login `next` (Part B). Otherwise fall back to
  `/login`.
- `redirect(dest)`.

## 2. Member nav passes the homepage — `components/app/app-nav.tsx`

The sign-out `<form action={signOut}>` gains a hidden field:
`<input type="hidden" name="redirectTo" value={tenantHref(basePath, "/home")} />`. `tenantHref`
resolves to `/t/<slug>/home` in path mode and `/home` (→ host-mode → the homepage) on a custom
domain. `AppNav` already receives `basePath` as a prop.

## 3. Platform console passes the platform login — `app/platform/(console)/layout.tsx`

Its sign-out `<form action={signOut}>` gains `<input type="hidden" name="redirectTo"
value="/platform/login" />`, preserving the super-admin → `/platform/login` behavior under the new
signature.

## 4. Behavior

| Who logs out | Lands on |
|---|---|
| Member (workspace) | `/t/<slug>/home` (their org homepage; Sign-in/Apply available) |
| Super admin (console) | `/platform/login` |
| Any other caller w/o `redirectTo` | `/login` (safe default) |

## 5. Out of scope / edge

- Homepage seeding; homepage customization (already exists); the global `/login` flow.
- **Edge:** if a tenant disabled its homepage (feature flag), `/t/<slug>/home` 404s on that tenant's
  member logout — rare and self-inflicted; not handled (a future fallback to `/t/<slug>/login` is the
  follow-up if it matters).

## 6. Files

- **Modified:** `lib/actions/auth.ts` (`signOut` signature + sanitized redirect),
  `components/app/app-nav.tsx` (hidden `redirectTo`), `app/platform/(console)/layout.tsx` (hidden
  `redirectTo`).

## 7. Verification

`tsc` + `build` clean. Manual runbook: as a TGP member, **Sign out** → lands on `/t/tgp/home` (the
homepage, with Sign in / Apply); sign back in works. As the super admin, **Sign out** (console) →
`/platform/login`. No DB changes.
