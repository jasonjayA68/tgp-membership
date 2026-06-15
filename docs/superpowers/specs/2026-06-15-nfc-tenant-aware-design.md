# NFC Tenant-Aware Verification — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #3 of 6 in the "Organization SaaS OS" upgrade (follows [[saas-os-roadmap]] #1, #2)

---

## Context

Sub-projects #1–#2 made the data layer and request routing multi-tenant. The public NFC
verification surface is still single-tenant in two ways:

- **URL:** `app/id/[slug]/page.tsx` serves a flat `/id/[slug]`; the NFC/QR URL is built by
  `lib/site.ts` `verificationUrl(baseUrl, slug)` → `/id/[slug]`.
- **Content:** the page is hard-coded TGP (the seal, "TAU GAMMA PHI", motto, and TGP-specific
  "Fraternal Information" / "Lineage · GT/MWW" sections). `get_member_card(slug)` resolves the
  card from the globally-unique slug but returns **fixed fraternal columns** (`gt_name`,
  `mww_name`, …) and **no tenant identity** — so an org-b card would render as "TAU GAMMA PHI"
  with empty fields.

This sub-project makes the public card **tenant-aware**: a branded `/t/[tenant]/id/[slug]` URL
and a **generic, schema-driven** card that shows the correct tenant's identity and public fields.
Visual theming (brand colors, custom seal, typography) and per-tenant verify-page CMS are **out
of scope** — those are Sub-project #5.

## Decisions locked during brainstorming

1. **Scope:** routing + tenant identity (name/logo) + **generic schema-driven public fields**.
   Color/seal/typography theming deferred to #5.
2. **Card content model:** one ordered, **type-aware** list (no tenant special-casing). All
   tenants — including TGP — render `is_public` fields ordered by `sort_order`, formatted by
   `tenant_field_schema.type` (`phone` → `tel:` link, `date` → localized date, else plain).
   TGP's bespoke "Fraternal/Lineage" section split collapses into this list (GT/MWW numbers stay
   tappable via type `phone`). Chapter/District/Council stays its own core section; the verify-
   officer CTA stays.
3. **Old URL + redirect:** old `/id/[slug]` **307 (temporary)** redirects to the canonical
   `/t/[tenant]/id/[slug]` — keeps the URL scheme open to change in #4 (custom domains).

---

## 1. Routing

- **Canonical route (new, public):** `app/t/[tenant]/id/[slug]/page.tsx`. `params.tenant` +
  `params.slug` come straight from the route — no middleware header needed. The card slug is the
  source of truth; `[tenant]` is vanity/branding and the custom-domain seam for #4.
- **Old flat route:** `app/id/[slug]/page.tsx` becomes a **redirect-only** server component:
  read the card's tenant via the RPC, then `redirect('/t/<tenant_slug>/id/<slug>')` (Next
  `redirect()` = 307). Unknown slug → render the existing "Card Not Recognized" view (no scan).
- **Middleware passthrough (the one change to #2):** in `lib/supabase/proxy.ts`, the
  `/t/[slug]/…` branch currently treats all such paths as protected workspace routes (anon →
  login). Add an early check: **if the second path segment is `id`, return passthrough**
  (`NextResponse.next`, cookies carried) with **no auth gate and no rewrite** — so Next routes it
  to the public verify page. (`/id/…` is already a global public prefix and is unaffected.)

## 2. Database — migration `0009_member_card_generic.sql`

Rewrite `get_member_card(card_slug)` as a **pure read** (no side effects) returning:

| field | source |
|---|---|
| `full_name, member_id, batch_year, status, photo_url` | profile core |
| `chapter, district, region` | chapter relation |
| `card_active` | nfc_cards.active |
| `verify_contact_name, verify_contact_number` | chapter→district officer fallback (unchanged logic, read from `custom_fields ->> 'contact_number'`) |
| `tenant_name, tenant_slug, tenant_logo_url` | the card's tenant |
| `public_fields jsonb` | ordered array of `{key,label,type,value}` |

`public_fields` is built as:
```sql
(select jsonb_agg(
   jsonb_build_object('key', s.key, 'label', s.label, 'type', s.type,
                      'value', p.custom_fields ->> s.key)
   order by s.sort_order)
 from public.tenant_field_schema s
 where s.tenant_id = p.tenant_id and s.is_public
   and nullif(p.custom_fields ->> s.key, '') is not null)
```
The fixed fraternal output columns (`alexis_name`, `gt_name`, …) are **dropped** from the return.

Add the side-effect function (the scan counter split out of the reader):
```sql
record_card_scan(card_slug text) returns void  -- SECURITY DEFINER, search_path public
  -- update nfc_cards set scan_count = scan_count + 1, last_verified_at = now()
  --  where slug = card_slug and active = true;
```
Both `revoke all from public; grant execute to anon, authenticated`. Splitting read from
side-effect lets the redirect chain resolve the tenant without double-counting; the scan is
recorded **once**, on the final canonical render.

## 3. Verify page (`app/t/[tenant]/id/[slug]/page.tsx`)

Server component. Flow:
1. `getCard(slug)` (memoised `cache()`, calls `get_member_card`). Null → "Card Not Recognized".
2. If `params.tenant !== card.tenant_slug` → `redirect('/t/<card.tenant_slug>/id/<slug>')`
   (canonical correction; no scan recorded yet).
3. Render the card; then call `record_card_scan(slug)` once (active cards only, enforced in SQL).

Layout (tenant-generic; theming deferred to #5):
- **Header:** `tenant_logo_url` image if set, else a neutral mark; `tenant_name` text. (TGP has no
  `logo_url` today → neutral mark + "Tau Gamma Phi" until #5 or until `tenants.logo_url` is set.)
- **Status banner** — existing tone logic (`card_active`, `status`).
- **Identity** — name, `member_id` chip, photo, status badge, `batch_year` if present.
- **Chapter · District · Council** — core section, shown when any present.
- **Public fields** — iterate `public_fields` in order; render `label` + `value` with type-aware
  formatting: `phone` → `<a href="tel:">`, `date` → localized, else plain text.
- **"Call officer to verify"** CTA — when `verify_contact_number` present (unchanged).
- Footer/`generateMetadata` keep `robots: noindex` and a tenant-named title.

The existing `app/id/[slug]/loading.tsx` moves/copies alongside the new route as appropriate.

## 4. NFC/QR URL

`lib/site.ts`: `verificationUrl(baseUrl, slug)` → `verificationUrl(baseUrl, tenantSlug, cardSlug)`
returning `${baseUrl}/t/${tenantSlug}/id/${cardSlug}`. Callers pass the active tenant slug
(already available as `auth.tenant.slug`):
- `app/(app)/dashboard/page.tsx` (the member's QR/verify link),
- `app/(app)/admin/members/[id]/page.tsx` (admin QR/verify link).

## 5. Types

`lib/types.ts`: update `MemberCard` — drop the fixed fraternal fields, add `tenant_name`,
`tenant_slug`, `tenant_logo_url`, and `public_fields: PublicField[]` where
`PublicField = { key: string; label: string; type: string; value: string }`. Add
`record_card_scan` to `Database.Functions`.

## 6. Files

- **New:** `supabase/migrations/0009_member_card_generic.sql`,
  `supabase/tests/0009_member_card_checks.sql`, `app/t/[tenant]/id/[slug]/page.tsx`
  (+ `loading.tsx`).
- **Updated:** `app/id/[slug]/page.tsx` (→ redirect-only), `lib/supabase/proxy.ts` (`/t/[slug]/id`
  passthrough), `lib/site.ts` (`verificationUrl` signature), `lib/types.ts`,
  `app/(app)/dashboard/page.tsx`, `app/(app)/admin/members/[id]/page.tsx`.

## 7. Out of scope (later sub-projects)

Brand colors / custom seal / typography theming + verify-page CMS (#5); custom-domain verify URLs
+ domain verification (#4); editing `tenant_field_schema` (admin UI) — not required here (TGP +
org-b schemas already seeded in #1).

## 8. Verification

1. `next build` + `tsc` clean.
2. `0009` applies; probe confirms `get_member_card` returns `tenant_slug` + a `public_fields`
   array for a TGP card, and that `record_card_scan` increments only active cards.
3. A TGP card at `/t/tgp/id/<slug>` shows "Tau Gamma Phi" + its public fields (GT/MWW tappable);
   an org-b card shows "Org B" + its `employee_no`.
4. Old `/id/<slug>` 307-redirects to `/t/<tenant>/id/<slug>`; `/t/wrong/id/<slug>` canonical-
   redirects; unknown slug → not-found.
5. Anonymous (logged-out) access to `/t/tgp/id/<slug>` works (no login redirect — middleware
   passthrough).
6. Scan count increments exactly once per canonical view; the member's dashboard QR encodes the
   `/t/<tenant>/id/<slug>` URL.
