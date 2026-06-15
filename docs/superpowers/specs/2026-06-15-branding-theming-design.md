# Per-Tenant Branding & Theming — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #5a of the "Organization SaaS OS" upgrade (follows [[saas-os-roadmap]] #1–#4)

---

## Context

`tenants` already carries `logo_url`, `primary_color`, `secondary_color` (settable from the #4
platform console), but **nothing reads them** — every surface uses the hardcoded gold/black theme.
That theme lives in `app/globals.css` as CSS custom properties (`--gold`, `--primary`,
`--background`, …) consumed through Tailwind v4 `@theme inline` tokens (`text-gold`,
`bg-background`). Brand identity is the hardcoded `SITE` constant (`lib/constants.ts`, used in 8
files) plus the `TgpSeal` inline SVG.

This sub-project makes each tenant's colors + logo + name actually **theme** their workspace and
verify card. The **homepage CMS is out of scope** — it is its own sub-project (#5b).

## Decisions locked during brainstorming

1. **Scope:** branding/theming only; homepage CMS deferred to #5b.
2. **Theming depth:** **two-color** — `primary_color` drives the accent family, `secondary_color`
   drives the surface/background family (a tenant can recolor, including going light).
3. **Readability:** a **runtime theme generator** auto-derives safe foreground/border tokens from
   each surface's luminance, with a minimum-contrast floor — any two colors stay readable.
4. **Surfaces (approved):** theme the workspace, the verify card, and the `?tenant` login/register
   pages; defer typography; include a small color-picker polish in the #4 console; migration
   `0011` extends `get_member_card` with the colors.

---

## 1. Theme generator — `lib/branding/theme.ts`

`buildTenantTheme(primary: string | null, secondary: string | null)` returns a record of
CSS-variable → value, computed by a small internal, dependency-free color lib:
- `parseHex` → RGB; WCAG **relative luminance**; `mix(a, b, t)` (lighten/darken toward white/black);
  `contrastRatio(a, b)`; `readableOn(bg)` → returns near-white or near-black, whichever clears the
  floor (target ≥ 4.5:1 body, ≥ 3:1 large/borders; nudge to pure black/white if needed).

Token mapping:
- **Surface family** (from `secondary_color`): `--background` = secondary; `--card`/`--popover` =
  `mix(secondary, foreground, ~6%)`; `--secondary`/`--muted` = lifted surface; `--border`/`--input`
  = `mix(secondary, foreground, ~14%)`.
- **Foregrounds** (derived): `--foreground`, `--card-foreground`, `--popover-foreground` =
  `readableOn(surface)`; `--muted-foreground` = the readable fg mixed ~35% toward the surface.
- **Accent family** (from `primary_color`): `--gold` = primary; `--gold-bright` =
  `mix(primary, white, ~18%)`; `--gold-soft`/`--gold-deep` = lighter/darker variants; `--primary` =
  primary; `--primary-foreground` = `readableOn(primary)`; `--ring`/`--accent` = primary-based;
  the `--sidebar-*` accents follow.
- `--destructive` (red) is **not** themed (semantic).

**Defaults:** if BOTH colors are null → return an **empty** map (no override; `globals.css` `:root`
applies — i.e. exactly today's look). If only one is set, the other falls back to the default
(primary→gold, secondary→near-black) so partial branding works.

## 2. Injection — scoped CSS variables (no global `<style>`)

CSS custom properties cascade, so the generated vars are applied as an **inline `style` object on
each tenant-surface root wrapper**; `var(--gold)`/`var(--background)` re-resolve for every
descendant, re-tinting all existing utility classes with **zero per-component edits**. The wrapper
carries `bg-background min-h-svh` so the tenant's surface color fills the page.
- A small server helper `tenantThemeStyle(tenant)` → the `style` object (`{} ` when unbranded).
- **Workspace** (`app/(app)/layout.tsx`): the active tenant comes from `getActiveTenant()`, and
  `resolve_tenant_by_slug` **already returns** `primary_color`/`secondary_color`/`logo_url` — so the
  workspace needs **no DB change**.
- **Verify card** + **`?tenant` auth**: see §4 / §5.

## 3. Brand identity — `getBrand()` + `Brandmark`

- `lib/branding/brand.ts` `getBrand()` returns `{ name, logoUrl }` from the active tenant on tenant
  surfaces, and the platform default (today's `SITE`) on global surfaces.
- `components/brand/brandmark.tsx` renders `logo_url` as an `<img>` when set, else a generic
  **monogram** (tenant initials in an accent-tinted circle). It replaces hardcoded `SITE`/`TgpSeal`
  in the workspace nav (`wordmark.tsx`) + footer, the dashboard ID-card preview (`id-card.tsx`), and
  the verify header.
- **TGP keeps its seal** by setting `tenants.logo_url` (via #4) to a hosted seal image
  (`public/tgp-seal.png` exists). `TgpSeal` remains the platform-default mark on global pages.

## 4. Database — migration `0011_member_card_branding.sql`

The only DB change: extend `get_member_card` (pure read) to also return `tenant_primary_color` and
`tenant_secondary_color` (next to the existing `tenant_logo_url`), so the anon verify card themes
from one call. `MemberCard` (`lib/types.ts`) gains the two fields. Includes a probe.

## 5. Surfaces

| Surface | Theme source | Brand identity |
|---|---|---|
| Workspace `/t/[slug]/*` | `getActiveTenant()` colors | active tenant |
| Verify card `/t/[tenant]/id/*` | `get_member_card` colors (`0011`) | card's tenant |
| `?tenant` login/register | resolve the `?tenant` slug → colors | that tenant |
| Global `/`, `/platform`, plain `/login` | none (default `:root`) | platform default (`SITE`) |

Typography (per-tenant fonts) is **deferred**. Homepage CMS is **#5b**.

## 6. #4 console polish (small)

In `components/platform/branding-form.tsx`, upgrade `primary_color`/`secondary_color` to native
`<input type="color">` pickers paired with a small live swatch, so admins choose valid hex easily.
`logo_url` stays a text input.

## 7. Files

- **New:** `lib/branding/theme.ts` (generator + color lib), `lib/branding/brand.ts` (`getBrand`,
  `tenantThemeStyle`), `components/brand/brandmark.tsx`,
  `supabase/migrations/0011_member_card_branding.sql`, `supabase/tests/0011_branding_checks.sql`.
- **Updated:** `lib/types.ts` (`MemberCard` + `get_member_card` return), `app/(app)/layout.tsx`
  (theme + brand), `app/t/[tenant]/id/[slug]/page.tsx` (theme + Brandmark from card colors),
  `app/(auth)/layout.tsx` + the login/register pages (theme when `?tenant`),
  `components/brand/wordmark.tsx` (use `getBrand`/`Brandmark`), `components/id-card.tsx` (use
  `getBrand`), `components/platform/branding-form.tsx` (color pickers).

## 8. Out of scope (later)

Per-tenant typography/fonts; the homepage CMS (content blocks + editor + renderer) → **#5b**;
custom-domain verification → #4b.

## 9. Verification

1. `0011` probe: `get_member_card` returns `tenant_primary_color`/`tenant_secondary_color`.
2. Generator checks (runnable as a tiny script or asserted in the runbook): a **light**
   `secondary_color` yields a **dark** `--foreground` clearing the contrast floor; a **dark**
   secondary yields a light foreground; null colors → empty map (default theme).
3. `tsc` + `build` clean.
4. Manual runbook: set Org-B to distinct colors (e.g. a blue accent + light surface) → its
   `/t/org-b/...` workspace and a verify card re-tint and stay **readable**; set TGP `logo_url` →
   the seal returns in nav + verify header; global `/` and `/platform` are **unchanged** (default
   gold/black); a `/login?tenant=org-b` page shows Org-B's colors.
