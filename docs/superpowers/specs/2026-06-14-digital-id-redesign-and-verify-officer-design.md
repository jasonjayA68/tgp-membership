# Digital ID Redesign + Chapter/District Verify-Officer — Design

Date: 2026-06-14
Status: Approved (pending spec review)

## Summary

Two related changes to the Tau Gamma Phi membership registry:

1. **Redesign the digital ID** on both surfaces — the compact `IdCard` (member
   portal + admin preview) and the public scan page (`/id/[slug]`) — toward a
   slicker, modernized "elevated gold/ink" aesthetic that evolves the existing
   identity rather than replacing it.
2. **Re-target the "Call to verify" button** on the public scan page so it dials
   a fraternity **officer** responsible for the member's chapter (falling back to
   the member's **district**), instead of the member's own phone number.

## Goals

- Modern, premium look on both ID surfaces with a consistent visual language.
- A scanner of a member's card calls an *officer* to verify legitimacy, not the
  member themselves.
- Officer resolution order: **chapter officer → district officer → none**.
- When no officer resolves, the Call-to-verify button is **hidden**.

## Non-goals

- NFC hardware / programming.
- The QR-gating asymmetry between member portal and admin views (separate issue).
- Any change to member registration/signup.
- A general roles/permissions overhaul — officers are existing admin profiles.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Which surfaces to redesign | **Both** — `IdCard` and the public `/id/[slug]` page |
| Aesthetic direction | **Elevated gold/ink** (evolve the current identity) |
| How the verify contact is sourced | **Link an admin profile as the chapter's officer** |
| District role | **District officer as fallback** when no chapter officer |
| No officer resolvable | **Hide the button** |
| Member's own number on public page | **Dropped** from the public RPC (privacy) |
| District→officer storage | **Dedicated `district_officers` table** |

## Data model

### Migration `0006_verify_officers.sql` (additive)

- `alter table public.chapters add column if not exists verify_officer_id uuid
  references public.profiles (id) on delete set null;`
- New table:
  ```sql
  create table if not exists public.district_officers (
    district   text primary key,
    officer_id uuid references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now()
  );
  ```
- RLS:
  - `district_officers` enable RLS.
  - select: `auth.uid() is not null` (any authenticated user), mirroring
    `chapters_select_auth`.
  - write (`for all`): `public.is_admin()` with check `public.is_admin()`,
    mirroring `chapters_write_admin`.
  - `chapters.verify_officer_id` is already covered by `chapters_write_admin`
    and the non-admin column-reset trigger does not touch chapters, so no extra
    protection needed.

### `get_member_card()` RPC rewrite

- Drop and recreate (as prior migrations do).
- **Remove** `contact_number` (the member's own number) from the returned
  table — it is no longer surfaced publicly.
- **Add** two whitelisted fields: `verify_contact_name text`,
  `verify_contact_number text`.
- Resolution (computed in SQL, in the `return query`):
  1. Chapter officer: the profile referenced by `c.verify_officer_id`, **only if
     its `contact_number` is non-null** → use its `full_name` + `contact_number`.
  2. Else district officer: the `district_officers` row matching `c.district`,
     its `officer_id` profile, **only if that profile's `contact_number` is
     non-null** → use its `full_name` + `contact_number`.
  3. Else both fields are `NULL`.
- Still increments `scan_count` / `last_verified_at` exactly as today, and keeps
  `security definer set search_path = public`, and the
  `revoke all ... / grant execute ... to anon, authenticated` grants.

### Type changes (`lib/types.ts`)

- `Chapter`: add `verify_officer_id: string | null`.
- New `DistrictOfficer` type + `district_officers` table entry in `Database`.
- `MemberCard`: remove `contact_number`; add `verify_contact_name: string | null`
  and `verify_contact_number: string | null`.
- Update `Database.Functions.get_member_card.Returns` accordingly.

## Admin UI

### Chapter verifying officer

- `app/(app)/admin/chapters/page.tsx` loads admin/super-admin profiles (id,
  full_name) to populate an officer dropdown.
- `components/admin/chapter-form.tsx` (and/or `chapter-row.tsx`): add a
  **Verifying officer** `<Select>` with options = admins + a "None" option.
- New/extended server action in `lib/actions/admin.ts` (e.g. `setChapterOfficer`
  or extend the existing chapter upsert) — admin-gated via `requireAdmin`, writes
  `chapters.verify_officer_id` through RLS, and writes an audit log entry
  consistent with existing admin actions.

### District officers

- A compact section on the admin chapters page listing each **distinct district**
  (derived from `chapters.district`) with an officer `<Select>` (assign / clear).
- New server action `setDistrictOfficer(district, officerId | null)` in
  `lib/actions/admin.ts`, admin-gated, upserting/deleting `district_officers`.

## ID redesign (both surfaces)

Direction: **elevated gold/ink** — keep gold-on-ink, the TGP seal, and the
guilloche security texture, but modernize.

### `components/id-card.tsx` (portal + admin preview)

- Refined type scale and tighter, more deliberate grid; more negative space.
- Lighter/subtler guilloche; crisper photo framing; layered depth (soft inner
  highlight + outer shadow).
- CSS-only micro-interactions (hover sheen/lift) — **stays a server component,
  no client JS added**.

### `app/id/[slug]/page.tsx` (public scan page)

- Same visual language applied to the full credential: modernized document
  header, standing banner, identity hero, and detail panel.
- **Call-to-verify rewired** to `verify_contact_name` / `verify_contact_number`.
- The entire Call-to-verify block is **hidden when both are null**.
- Label/copy updated so it reads as calling an officer (e.g. "Call officer to
  verify"), with the officer name shown where the member's number used to be.

### Shared tokens

- Consolidate shared visual utilities/tokens in `app/globals.css` so both
  surfaces stay consistent (the existing `tgp-*` utility classes are the seam).

## Constraints

- **Next.js 16** (per `AGENTS.md`): read the relevant guides under
  `node_modules/next/dist/docs/` before writing code — async `params`/`cookies()`,
  `proxy.ts` middleware, `forbidden()`/`unauthorized()` interrupts. Do not assume
  prior-version APIs.
- All privileged writes go through existing RLS + `requireAdmin`; the service-role
  key is never used.

## Testing & verification

The repo has no automated test harness, and the SQL resolution logic is not
unit-testable without a live database. Verification plan:

1. Apply `0006` to the Supabase project; confirm it runs cleanly and is additive.
2. Manual matrix on `/id/[slug]`:
   - chapter officer set (with number) → button dials chapter officer.
   - only district officer set → button dials district officer.
   - neither (or officer has no number) → button hidden.
3. `npm run build` + lint pass.
4. Visual review of both surfaces (portal `IdCard`, admin preview, public page)
   by the user before merge.

No success claims until build/lint pass and the user has eyeballed the screens.

## Files touched (anticipated)

- `supabase/migrations/0006_verify_officers.sql` (new)
- `lib/types.ts`
- `lib/actions/admin.ts`
- `app/(app)/admin/chapters/page.tsx`
- `components/admin/chapter-form.tsx`, possibly `components/admin/chapter-row.tsx`
- `app/id/[slug]/page.tsx`
- `components/id-card.tsx`
- `app/globals.css`
