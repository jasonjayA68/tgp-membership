# Homepage CMS — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #5b of the "Organization SaaS OS" upgrade (follows [[saas-os-roadmap]] #1–#5a)

---

## Context

There is no per-tenant public homepage yet — the tenant root `/t/[slug]` forces login and routes to
the gated dashboard. #5a gave each tenant theming (`buildTenantTheme`, `Brandmark`, `getBrand`) and
the public verify card already established **real public tenant routes** (`app/t/[tenant]/id/[slug]`)
with a middleware passthrough. #5b builds on both: a **public, editable homepage** for each
organization, rendered from JSON content blocks in the tenant's theme.

This is the constrained "coherent slice" agreed in brainstorming: a JSON block model + a small fixed
block set + a public themed renderer + a **form-based** editor. WYSIWYG/drag-drop, markdown, and
draft/publish are explicitly **out of scope**.

## Decisions locked during brainstorming

1. **Scope:** content model + fixed block set + public renderer + form-based editor (reorder via
   up/down). No drag-drop/WYSIWYG/live-preview, no custom-block library, no draft/publish.
2. **Routing:** the homepage lives at **`/t/[slug]/home`** (a public passthrough like `/id`); the
   tenant root `/t/[slug]` is **unchanged** (still gated → dashboard/login).
3. **Text safety:** **plain structured text** only — fields render as escaped React children (no
   HTML/markdown, zero XSS); links live only in structured, validated `href` fields.

---

## 1. Content model — migration `0012_tenant_pages.sql`

- **`tenant_pages`** table:
  `id uuid pk, tenant_id uuid not null → tenants on delete cascade, page_type text not null,
   content_json jsonb not null default '{"blocks":[]}'::jsonb, updated_at timestamptz not null
   default now()`, `unique(tenant_id, page_type)`. Only `page_type = 'home'` is used now (the
   `page_type` column keeps it extensible).
- **RLS:** `select` = `is_tenant_member(tenant_id)` (admins read for editing); write =
   `is_tenant_admin(tenant_id)`. Anon has **no** direct table access.
- **Public RPC `get_tenant_homepage(p_slug text)`** (`SECURITY DEFINER`, `search_path = public`,
   granted to `anon, authenticated`) — the only anon path, mirroring `get_member_card`. Returns one
   row: `tenant_name, tenant_slug, tenant_status, tenant_logo_url, tenant_primary_color,
   tenant_secondary_color, content_json, member_count` (active-member count, computed
   definer-side). Resolves tenant by slug; `content_json` defaults to `{"blocks":[]}` when no
   `tenant_pages` row exists. Returns no row for an unknown slug.

## 2. Block model — `lib/cms/blocks.ts`

`HomeContent = { blocks: Block[] }`, `Block = { id: string; type: BlockType; props: … }` — a
discriminated union over a **fixed set**:

| type | props |
|---|---|
| `hero` | `heading`, `subheading?`, `ctaLabel?`, `ctaHref?` |
| `text` | `heading?`, `body` (plain text; paragraphs split on `\n`) |
| `banner` | `tone: "info" \| "gold" \| "warn"`, `message`, `linkLabel?`, `linkHref?` |
| `cta` | `heading`, `label`, `href` |
| `members` | `heading?` (renderer fills the live count) |

- A **zod** `HomeContentSchema` validates on save: caps `blocks.length ≤ 50`, per-field max lengths,
  and every `href`/`ctaHref`/`linkHref` through `safeHref()` (allow `https://`, `http://`, or an
  internal path starting with `/`; reject `javascript:`, `data:`, etc. → coerced to `null`/rejected).
- `DEFAULT_HOME`: a single `hero` (tenant name + a "Sign in" CTA) — the fallback for tenants with no
  content yet. `newBlock(type)` returns a sensible empty block for the editor's "Add block".

## 3. Public renderer — `app/t/[tenant]/home/page.tsx`

Public server component. Calls `get_tenant_homepage(params.tenant)` → `notFound()` if no row. Applies
the **#5a theme** (`tenantThemeStyle(primary, secondary)` on the page wrapper) + `Brandmark`/name in
a header, then renders blocks through a **block registry** (`Record<BlockType, Component>` in
`components/cms/`). Empty `blocks` → render `DEFAULT_HOME`. The `members` block uses the returned
`member_count`. CTA/banner links resolve relative paths against the tenant (`/t/[slug]/dashboard`,
`/login?tenant=[slug]`) or use a validated absolute href. All text is escaped React children.
`generateMetadata` sets a tenant-named title; the homepage is the one indexable public surface.

## 4. Editor — `app/(app)/admin/homepage/page.tsx` (tenant admin)

Server page (`requireTenantAdmin`) loads the `home` `content_json` (authed client, RLS admin) and
passes it to a **client** `HomepageEditor` component:
- A list of block cards; each shows the block's field inputs (`Input`/`Textarea`/`Select`), with
  **Move ↑ / Move ↓ / Delete**.
- **Add block** — a type picker that appends `newBlock(type)`.
- **Save** — serializes the blocks to JSON and submits to `saveHomepage` (below). **View homepage**
  links to `/t/[slug]/home`.
- Local React state holds the working block array; no drag-drop.
- A **"Homepage"** link is added to `components/admin/admin-nav.tsx`.

## 5. Action — `lib/actions/homepage.ts`

`saveHomepage(formData)` (`"use server"`): re-verify tenant admin (mirrors `getAdminContext`);
parse + **validate** the submitted JSON with `HomeContentSchema` (reject malformed/oversized/unsafe
→ return inline error); `upsert tenant_pages (tenant_id, 'home', content_json) on conflict
(tenant_id, page_type) do update`. `revalidatePath('/t/[slug]/home')`-equivalent + the editor path.

## 6. Routing & middleware

One change to `lib/supabase/proxy.ts`: extend the public passthrough to include `home` —
`if (segs[2] === "id" || segs[2] === "home") { …strip spoofed headers; public; no auth gate… }`,
so `/t/[slug]/home` routes to the real public page. Tenant root + workspace unchanged.

## 7. Types — `lib/types.ts`

Add a `TenantPage` row type + `tenant_pages` to `Database.Tables`; add `get_tenant_homepage` to
`Database.Functions` with a `HomepageResult` return type. (`HomeContent`/`Block` live in
`lib/cms/blocks.ts`, not the DB types.)

## 8. Deliberate boundaries (YAGNI)

No draft/publish or versioning (edits go live on save); no drag-drop/WYSIWYG/live-preview; no
markdown/HTML (plain structured text); the fixed 5-block set (no extensible/custom blocks);
suspended tenants' homepages still render (public marketing, like the verify card). All deferrable.

## 9. Files

- **New:** `supabase/migrations/0012_tenant_pages.sql`, `supabase/tests/0012_homepage_checks.sql`,
  `lib/cms/blocks.ts`, `lib/cms/blocks.check.mts` (zod-validator Node check),
  `components/cms/*` (block renderers + registry), `components/admin/homepage-editor.tsx`,
  `app/t/[tenant]/home/page.tsx` (+ `loading.tsx`), `app/(app)/admin/homepage/page.tsx`,
  `lib/actions/homepage.ts`.
- **Updated:** `lib/supabase/proxy.ts` (home passthrough), `lib/types.ts` (`tenant_pages` + RPC),
  `components/admin/admin-nav.tsx` (Homepage link).

## 10. Verification

1. `0012` probe: an admin upsert of `tenant_pages('home', …)` works; `get_tenant_homepage(slug)`
   returns the content + branding + active-member count; an unknown slug → no row; a non-admin
   cannot write `tenant_pages` (RLS).
2. `lib/cms/blocks.check.mts` (Node, type-stripped, excluded from tsc like `theme.check.mts`):
   `HomeContentSchema` accepts a valid document, rejects an oversized one, and `safeHref` rejects
   `javascript:` while allowing `/t/x/dashboard` and `https://…`.
3. `tsc` + `build` clean.
4. Manual runbook: as an Org-B admin, open `/t/org-b/admin/homepage` → add a hero + banner + members
   block, reorder, save → `/t/org-b/home` (logged-out) shows them in Org-B's theme; an unedited
   tenant shows `DEFAULT_HOME`; a non-admin gets `forbidden()` on the editor.
