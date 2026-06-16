# Tenant Homepage Design ("Light over Darkness") — Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Follows:** #5b (homepage CMS) + #7b Part B (tenant entry). See [[saas-two-plane-hierarchy]].

---

## Context

`/t/[slug]/home` renders nearly empty — not a styling bug. The block renderers
(`components/cms/home-blocks.tsx`) are already themed (gold-on-black hero/cta/members/banner), but
**`DEFAULT_HOME` (`lib/cms/blocks.ts`) is a single hero block with a blank heading + a "Sign in"
CTA**, so there is no content to show. Every tenant shares this default until customized.

This sub-project gives the shared default homepage a real "Light over Darkness" design that is
**brand-driven** (logo + name auto-vary per tenant from the tenant record), keeping the page fully
CMS-editable below a fixed brand hero.

## Decisions locked during brainstorming

1. **Brand hero is a fixed, auto-branded page section** (logo + name per tenant); the **CMS blocks
   below stay editable** via the existing `/t/[slug]/admin/homepage` editor.
2. **Shared aesthetic** (Light-over-Darkness gold-on-black + the tenant's accent colors via the
   existing `tenantThemeStyle`); logo + name vary per tenant automatically.
3. **Motto/tagline = a shared constant for now** (the fraternal motto); a per-tenant `tagline` field
   is a future change (flagged, not built).
4. **CTAs use the Part B tenant routes** (`/t/<slug>/login`, `/t/<slug>/register`).

## 1. Brand hero — `app/t/[tenant]/home/page.tsx`

A fixed `<section>` rendered between the existing header and the CMS blocks, using the data the page
already has (`home.tenant_name`, `home.tenant_logo_url`, theme colors):
- A large **`Brandmark`** (tenant logo or monogram) with the gold radial-glow aesthetic (same pattern
  as `AuthBrandHeader`).
- Eyebrow `HOMEPAGE.eyebrow` ("Official Membership Registry").
- The org name (`home.tenant_name`) in the gilded display style (`tgp-display tgp-gild`,
  `text-4xl sm:text-6xl`).
- `HOMEPAGE.tagline` (motto) + `HOMEPAGE.subtext`.
- Two CTAs: **Sign in** → `/t/<slug>/login`, **Apply for membership** → `/t/<slug>/register`
  (`Button` + `Link`, outline for Apply).

The existing header (logo + Sign-in/Apply) stays; the brand hero is the page's centerpiece below it.

## 2. Shared copy — `lib/constants.ts`

Add a `HOMEPAGE` constant (one place to swap; future per-tenant):
```ts
export const HOMEPAGE = {
  eyebrow: "Official Membership Registry",
  tagline: "Fortis Voluntas Fraternitas",
  subtext:
    "Light over darkness — your standing in the brotherhood, recorded, sealed, and verifiable in real time.",
} as const;
```

## 3. Richer default content — `lib/cms/blocks.ts` `DEFAULT_HOME`

Replace the lone blank hero (the brand hero replaces it) with substantive, editable content:
```ts
export const DEFAULT_HOME: HomeContent = {
  blocks: [
    {
      id: "default-about",
      type: "text",
      props: {
        heading: "About",
        body: "Welcome to the official membership registry. Every member carries a tamper-resistant digital ID, verifiable in real time via NFC. Sign in to access your member portal, or apply for membership to get started.",
      },
    },
    { id: "default-members", type: "members", props: { heading: "Our community" } },
    {
      id: "default-cta",
      type: "cta",
      props: { heading: "Ready to join?", label: "Apply for membership", href: null },
    },
  ],
};
```
(`href: null` → the renderer supplies the tenant-scoped default; see §4.)

## 4. Block CTA hrefs → tenant routes — `components/cms/home-blocks.tsx`

Update the two fallback hrefs from the old `/login?tenant=${ctx.slug}` to the Part B routes:
- **hero** block fallback → `/t/${ctx.slug}/login`.
- **cta** block fallback → `/t/${ctx.slug}/register` (a "join/apply" CTA defaults to the apply page;
  an admin can still set an explicit `href`). This is why `DEFAULT_HOME`'s CTA ("Apply for
  membership") needs no literal href.

(No other renderer change required — the existing block styling is kept.)

## 5. Footer — `app/t/[tenant]/home/page.tsx`

A small footer after the CMS blocks: `© <tenant_name>` in the muted uppercase style (matching the
platform landing's footer), so the page closes cleanly.

## 6. Out of scope (YAGNI / future)

- A per-tenant `tagline`/`motto` field (the constant is the swap point).
- Making the brand hero itself CMS-editable.
- New block types or a homepage redesign editor; image upload for hero backgrounds.

## 7. Files

- **Modified:** `app/t/[tenant]/home/page.tsx` (brand hero + footer), `lib/constants.ts` (`HOMEPAGE`),
  `lib/cms/blocks.ts` (`DEFAULT_HOME`), `components/cms/home-blocks.tsx` (hero/cta fallback hrefs).

## 8. Verification

- `lib/cms/blocks.check.mts` (the existing node test) still passes (DEFAULT_HOME stays a valid
  `HomeContentSchema`; update the test if it asserts the old block shape).
- `tsc` + `build` clean.
- Manual: `/t/tgp/home` shows the brand hero (TGP logo/name, motto, Sign-in/Apply → tenant routes),
  the About text, the live member count, and the Apply CTA → `/t/tgp/register`; a tenant that has
  customized its homepage (non-empty content) still renders its own blocks (brand hero on top,
  custom blocks instead of the default below).
