# Digital ID Redesign + Chapter/District Verify-Officer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the digital ID on both surfaces (member `IdCard` + public scan page) and re-target the public "Call to verify" button to dial a chapter officer, falling back to a district officer, hiding the button when neither resolves.

**Architecture:** A new additive migration adds `chapters.verify_officer_id` and a `district_officers` table, and rewrites the public `get_member_card()` RPC to resolve the verify contact (chapter officer → district officer → null) while dropping the member's own number. Admins assign officers from the chapters admin page via existing `ActionSelect` + new server actions. The two ID surfaces get an "elevated gold/ink" visual refresh using the existing `tgp-*` CSS utilities.

**Tech Stack:** Next.js 16 (App Router, async `params`/`cookies`, server actions), TypeScript, Tailwind v4, Supabase (Postgres + RLS), `qrcode`.

**Spec:** `docs/superpowers/specs/2026-06-14-digital-id-redesign-and-verify-officer-design.md`

---

## Pre-flight (read before coding)

- This repo pins a modified **Next.js 16**. Per `AGENTS.md`, when unsure about an API (server actions, async `params`/`cookies()`, route handlers), read the matching guide under `node_modules/next/dist/docs/` instead of assuming prior-version behavior. The patterns already in `lib/actions/admin.ts` and `app/id/[slug]/page.tsx` are the canonical reference for this codebase.
- There is **no automated test harness** in this repo (no test runner, no `test` script). Verification is therefore `npm run lint`, `npm run build` (which type-checks), and a manual behavior matrix — not unit tests. Do not fabricate a test framework.
- Work happens on branch `feature/id-redesign-verify-officer` (already created).

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `supabase/migrations/0006_verify_officers.sql` | Schema + RLS + RPC rewrite | Create |
| `lib/types.ts` | DB/domain types | Modify |
| `lib/actions/admin.ts` | `setChapterOfficer`, `setDistrictOfficer` | Modify |
| `app/(app)/admin/chapters/page.tsx` | Load admins + district officers, render UI | Modify |
| `components/admin/chapter-row.tsx` | Per-chapter officer dropdown | Modify |
| `components/admin/district-officers.tsx` | District→officer assignment panel | Create |
| `app/id/[slug]/page.tsx` | Rewire Call-to-verify + visual refresh | Modify |
| `components/id-card.tsx` | Visual refresh | Modify |

---

## Task 1: Migration — verify-officer schema + RPC rewrite

**Files:**
- Create: `supabase/migrations/0006_verify_officers.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_verify_officers.sql` with exactly:

```sql
-- =============================================================================
-- TAU GAMMA PHI — Migration 0006: Chapter/District Verify Officers
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe to run on a database that already has data.
--  * chapters.verify_officer_id  → the admin profile who verifies that chapter
--  * district_officers           → maps a district name to its verifying officer
--  * get_member_card() rewritten to resolve the public "call to verify" contact
--    as: chapter officer (with a number) → district officer (with a number) →
--    none. The member's own contact_number is NO LONGER returned publicly.
-- =============================================================================

-- 1. Per-chapter verifying officer ------------------------------------------
alter table public.chapters
  add column if not exists verify_officer_id uuid
    references public.profiles (id) on delete set null;

-- 2. District → officer mapping ---------------------------------------------
create table if not exists public.district_officers (
  district   text primary key,
  officer_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.district_officers enable row level security;

drop policy if exists district_officers_select_auth on public.district_officers;
drop policy if exists district_officers_write_admin on public.district_officers;

create policy district_officers_select_auth on public.district_officers
  for select using (auth.uid() is not null);
create policy district_officers_write_admin on public.district_officers
  for all using (public.is_admin()) with check (public.is_admin());

-- 3. Public verification RPC -------------------------------------------------
drop function if exists public.get_member_card(text);

create or replace function public.get_member_card(card_slug text)
returns table (
  full_name      text,
  member_id      text,
  alexis_name    text,
  batch_name     text,
  date_survived  date,
  gt_name        text,
  gt_number      text,
  mww_name       text,
  mww_number     text,
  chapter        text,
  district       text,
  region         text,
  batch_year     int,
  status         public.member_status,
  photo_url      text,
  card_active    boolean,
  verify_contact_name   text,
  verify_contact_number text
)
language plpgsql security definer set search_path = public as $$
begin
  update public.nfc_cards
     set scan_count = scan_count + 1,
         last_verified_at = now()
   where slug = card_slug and active = true;

  return query
  select p.full_name,
         p.member_id,
         p.alexis_name,
         p.batch_name,
         p.date_survived,
         p.gt_name,
         p.gt_number,
         p.mww_name,
         p.mww_number,
         c.name,
         c.district,
         c.region,
         p.batch_year,
         p.status,
         p.photo_url,
         n.active,
         coalesce(chap_officer.full_name, dist_officer.full_name),
         coalesce(chap_officer.contact_number, dist_officer.contact_number)
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  left join public.chapters c on c.id = p.chapter_id
  left join public.profiles chap_officer
         on chap_officer.id = c.verify_officer_id
        and chap_officer.contact_number is not null
  left join public.district_officers d_off
         on d_off.district = c.district
  left join public.profiles dist_officer
         on dist_officer.id = d_off.officer_id
        and dist_officer.contact_number is not null
  where n.slug = card_slug;
end $$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;
```

Note on the join logic: an officer join only matches when that officer has a **non-null `contact_number`**, so `coalesce` keeps name and number paired from the same person and naturally falls through to the district officer (then to `NULL`) when the chapter officer has no usable number.

- [ ] **Step 2: Apply the migration to your Supabase project**

Open the Supabase project → SQL Editor → paste the file contents → Run.
Expected: succeeds with no error; re-running is safe (all statements are idempotent / `drop ... if exists` guarded).

- [ ] **Step 3: Sanity-check the RPC shape in SQL Editor**

Run:
```sql
select * from public.get_member_card('does-not-exist');
```
Expected: 0 rows, and the result grid shows the new columns `verify_contact_name`, `verify_contact_number` and **no** `contact_number` column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_verify_officers.sql
git commit -m "feat(db): add chapter/district verify officers + rewrite get_member_card"
```

---

## Task 2: Types — reflect the schema + RPC changes

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `verify_officer_id` to `Chapter`**

In `lib/types.ts`, change the `Chapter` type (currently ends with `created_at: string;`) to:

```ts
export type Chapter = {
  id: string;
  name: string;
  district: string | null;
  region: string | null; // council
  verify_officer_id: string | null; // admin profile who verifies this chapter
  created_at: string;
};
```

- [ ] **Step 2: Add the `DistrictOfficer` type**

Directly below the `Chapter` type, add:

```ts
export type DistrictOfficer = {
  district: string;
  officer_id: string | null;
  created_at: string;
};
```

- [ ] **Step 3: Update `MemberCard` (drop member number, add verify contact)**

Replace the `contact_number` line in `MemberCard` with the two verify fields. The resulting type:

```ts
/** Whitelisted shape returned by the public `get_member_card` RPC. */
export type MemberCard = {
  full_name: string;
  member_id: string | null;
  alexis_name: string | null;
  batch_name: string | null;
  date_survived: string | null;
  gt_name: string | null;
  gt_number: string | null;
  mww_name: string | null;
  mww_number: string | null;
  chapter: string | null;
  district: string | null;
  region: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  card_active: boolean;
  verify_contact_name: string | null;
  verify_contact_number: string | null;
};
```

- [ ] **Step 4: Register `district_officers` in the `Database` map**

In `Database.public.Tables`, add the table next to `chapters`:

```ts
      chapters: Generated<Chapter>;
      district_officers: Generated<DistrictOfficer>;
```

(`get_member_card.Returns: MemberCard[]` already references `MemberCard`, so it updates automatically. Leave it as-is.)

- [ ] **Step 5: Verify it type-checks**

Run: `npm run lint`
Expected: no errors in `lib/types.ts`. (Other files referencing `card.contact_number` are fixed in Task 6; if lint runs the type-checker it will be clean only after Task 6 — that's expected. `npm run lint` here is ESLint, which passes.)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add verify officer fields + district_officers"
```

---

## Task 3: Server actions — assign chapter & district officers

**Files:**
- Modify: `lib/actions/admin.ts`

- [ ] **Step 1: Append the two actions**

At the end of `lib/actions/admin.ts`, add:

```ts
/** Assign (or clear) the verifying officer for a chapter. */
export async function setChapterOfficer(formData: FormData): Promise<void> {
  const { supabase } = await getAdminClient();
  const chapterId = required(formData, "chapterId");
  const raw = formData.get("officerId");
  const officerId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = await supabase
    .from("chapters")
    .update({ verify_officer_id: officerId })
    .eq("id", chapterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
}

/** Assign (or clear) the verifying officer for a district. */
export async function setDistrictOfficer(formData: FormData): Promise<void> {
  const { supabase } = await getAdminClient();
  const district = required(formData, "district");
  const raw = formData.get("officerId");
  const officerId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = officerId
    ? await supabase
        .from("district_officers")
        .upsert({ district, officer_id: officerId }, { onConflict: "district" })
    : await supabase.from("district_officers").delete().eq("district", district);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
}
```

These reuse the existing `getAdminClient()` (admin re-verification) and `required()` helpers already in the file, matching the established pattern. No audit log is written, consistent with the other chapter actions (`createChapter`/`updateChapter`).

- [ ] **Step 2: Verify lint**

Run: `npm run lint`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add lib/actions/admin.ts
git commit -m "feat(actions): setChapterOfficer + setDistrictOfficer"
```

---

## Task 4: Admin UI — assign officers from the chapters page

**Files:**
- Modify: `components/admin/chapter-row.tsx`
- Create: `components/admin/district-officers.tsx`
- Modify: `app/(app)/admin/chapters/page.tsx`

- [ ] **Step 1: Add an officer dropdown to each chapter row**

In `components/admin/chapter-row.tsx`:

1a. Extend the imports (add `ActionSelect` and `setChapterOfficer`):

```tsx
import { ActionSelect } from "@/components/admin/action-select";
import { deleteChapter, setChapterOfficer, updateChapter } from "@/lib/actions/admin";
```

1b. Change the component signature + props to accept the admin list:

```tsx
export function ChapterRow({
  chapter,
  memberCount,
  admins,
}: {
  chapter: Chapter;
  memberCount: number;
  admins: { id: string; full_name: string }[];
}) {
```

1c. In the **read-only** return (the JSX that starts with `<div className="flex items-center justify-between gap-3 px-6 py-3">`), add the officer select just before the member-count `<span>` inside the right-hand action cluster. Replace the opening of that action cluster:

```tsx
      <div className="flex shrink-0 items-center gap-2">
        <ActionSelect
          action={setChapterOfficer}
          name="officerId"
          defaultValue={chapter.verify_officer_id ?? ""}
          hidden={{ chapterId: chapter.id }}
          ariaLabel={`Verifying officer for ${chapter.name}`}
          className="hidden md:block"
          options={[
            { value: "", label: "— No officer —" },
            ...admins.map((a) => ({
              value: a.id,
              label: a.full_name?.trim() || "(unnamed admin)",
            })),
          ]}
        />
        <span className="hidden text-sm text-muted-foreground sm:inline">
```

(Leave the rest of the cluster — member count, edit, delete — unchanged.)

- [ ] **Step 2: Create the district officers panel**

Create `components/admin/district-officers.tsx`:

```tsx
import { MapPin } from "lucide-react";

import { ActionSelect } from "@/components/admin/action-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setDistrictOfficer } from "@/lib/actions/admin";

/**
 * Maps each distinct district to a verifying officer. Used as the fallback when
 * a member's chapter has no officer of its own. Server Component — the per-row
 * <ActionSelect> submits the server action on change.
 */
export function DistrictOfficers({
  districts,
  admins,
  current,
}: {
  districts: string[];
  admins: { id: string; full_name: string }[];
  current: Record<string, string>;
}) {
  if (districts.length === 0) return null;

  const officerOptions = [
    { value: "", label: "— No officer —" },
    ...admins.map((a) => ({
      value: a.id,
      label: a.full_name?.trim() || "(unnamed admin)",
    })),
  ];

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>District officers</CardTitle>
        <CardDescription>
          Fallback verifier when a chapter has no officer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {districts.map((district) => (
          <div key={district} className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 text-gold/70" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {district}
            </span>
            <ActionSelect
              action={setDistrictOfficer}
              name="officerId"
              defaultValue={current[district] ?? ""}
              hidden={{ district }}
              ariaLabel={`Verifying officer for ${district}`}
              className="shrink-0"
              options={officerOptions}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Wire the chapters page to load admins + district officers**

Replace the body of `app/(app)/admin/chapters/page.tsx` with:

```tsx
import type { Metadata } from "next";

import { ChapterForm } from "@/components/admin/chapter-form";
import { ChapterRow } from "@/components/admin/chapter-row";
import { DistrictOfficers } from "@/components/admin/district-officers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Chapter, DistrictOfficer } from "@/lib/types";

export const metadata: Metadata = { title: "Chapters" };

export default async function ChaptersPage() {
  const supabase = await createClient();

  const [chaptersResult, adminsResult, districtOfficersResult] =
    await Promise.all([
      supabase.from("chapters").select("*").order("name"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["admin", "super_admin"])
        .order("full_name"),
      supabase.from("district_officers").select("district, officer_id"),
    ]);
  if (chaptersResult.error) throw chaptersResult.error;
  if (adminsResult.error) throw adminsResult.error;
  if (districtOfficersResult.error) throw districtOfficersResult.error;

  const chapters = (chaptersResult.data ?? []) as Chapter[];
  const admins = (adminsResult.data ?? []) as {
    id: string;
    full_name: string;
  }[];
  const districtOfficers = (districtOfficersResult.data ??
    []) as Pick<DistrictOfficer, "district" | "officer_id">[];

  const counts = await Promise.all(
    chapters.map((c) =>
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("chapter_id", c.id)
        .then((r) => {
          if (r.error) throw r.error;
          return r.count ?? 0;
        }),
    ),
  );

  const districts = Array.from(
    new Set(
      chapters
        .map((c) => c.district?.trim())
        .filter((d): d is string => Boolean(d)),
    ),
  ).sort();

  const currentDistrictOfficer: Record<string, string> = {};
  for (const row of districtOfficers) {
    if (row.officer_id) currentDistrictOfficer[row.district] = row.officer_id;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Chapters &amp; Councils</CardTitle>
          <CardDescription>{chapters.length} registered</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {chapters.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No chapters yet. Create the first one.
            </p>
          ) : (
            chapters.map((chapter, i) => (
              <ChapterRow
                key={chapter.id}
                chapter={chapter}
                memberCount={counts[i]}
                admins={admins}
              />
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New chapter</CardTitle>
            <CardDescription>Add a chapter or council.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChapterForm />
          </CardContent>
        </Card>

        <DistrictOfficers
          districts={districts}
          admins={admins}
          current={currentDistrictOfficer}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run `npm run dev`, sign in as an admin, open `/admin/chapters`.
Expected: each chapter row shows an officer dropdown (md+ width); a "District officers" card lists each distinct district with a dropdown. Selecting an officer persists across reload (the `<select>` keeps the chosen value).

- [ ] **Step 6: Commit**

```bash
git add components/admin/chapter-row.tsx components/admin/district-officers.tsx "app/(app)/admin/chapters/page.tsx"
git commit -m "feat(admin): assign chapter & district verifying officers"
```

---

## Task 5: Redesign the `IdCard` (member portal + admin preview)

**Files:**
- Modify: `components/id-card.tsx`

Direction: **elevated gold/ink** — keep the seal, guilloche, gold-on-ink identity; modernize spacing, type scale, depth, and add a CSS-only hover lift. Server component — **no client JS**.

- [ ] **Step 1: Replace the `IdCard` component body**

Replace the `IdCard` function (everything from `export function IdCard({` to its closing `}`) in `components/id-card.tsx` with:

```tsx
export function IdCard({
  data,
  className,
  photoPriority = false,
}: {
  data: IdCardData;
  className?: string;
  photoPriority?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative isolate overflow-hidden rounded-2xl border border-gold/35 bg-card tgp-guilloche tgp-glow",
        "transition-transform duration-300 ease-out hover:-translate-y-0.5",
        className,
      )}
    >
      {/* Top sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-20 bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_18%,transparent),transparent_70%)] opacity-70 transition-opacity duration-300 group-hover:opacity-100"
      />

      {/* Header band */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-gold/25 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent px-5 py-3">
        <div className="flex items-center gap-2.5">
          <TgpSeal className="size-8" />
          <div className="leading-none">
            <div className="tgp-display text-[12px] font-bold tracking-[0.18em] text-foreground">
              TAU GAMMA PHI
            </div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-gold/70 uppercase">
              Member Identification
            </div>
          </div>
        </div>
        <StatusBadge status={data.status} className="scale-90" />
      </div>

      {/* Body */}
      <div className="relative z-10 flex gap-5 p-5">
        <div className="relative shrink-0">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1.5 -z-10 rounded-2xl bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--gold)_26%,transparent),transparent)] opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100"
          />
          <Avatar
            src={data.photoUrl}
            name={data.fullName}
            size={112}
            rounded="xl"
            priority={photoPriority}
            className="ring-1 ring-gold/40"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[8px] font-medium tracking-[0.24em] text-gold/60 uppercase">
              Registered Name
            </div>
            <div className="tgp-display tgp-gild mt-0.5 truncate text-lg font-semibold tracking-tight">
              {data.fullName || "—"}
            </div>
            {data.alexisName && (
              <div className="truncate text-xs text-gold/80 italic">
                “{data.alexisName}”
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Member ID" mono value={data.memberId ?? "PENDING"} />
            <Detail label="Batch" value={data.batchName ?? "—"} />
            <Detail label="Chapter" value={data.chapter ?? "Unassigned"} />
            <Detail label="District" value={data.district ?? "—"} />
            <Detail label="Council" value={data.council ?? "—"} />
          </div>
        </div>
      </div>

      {/* Hairline rule */}
      <div aria-hidden="true" className="relative z-10 mx-5 h-px tgp-rule" />

      {/* Footer band */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-5 py-2.5">
        <span className="tgp-mono text-[9px] tracking-wider text-gold/60">
          {data.memberId ?? "TGP-————"}
        </span>
        <span className="tgp-eyebrow text-[7px] text-gold/60">{SITE.motto}</span>
      </div>

      {/* Watermark seal */}
      <TgpSeal
        title=""
        className="pointer-events-none absolute -right-10 -bottom-12 -z-0 size-48 opacity-[0.06]"
      />
    </div>
  );
}
```

(The `Detail` helper and imports at the top of the file are unchanged. `Avatar` already supports `rounded="xl"` per `components/ui/avatar.tsx`; if it does not, use `rounded="lg"`.)

- [ ] **Step 2: Verify the Avatar `rounded` prop value exists**

Run: `grep -n "rounded" components/ui/avatar.tsx`
Expected: confirms which values are allowed. If `"xl"` is not among them, change `rounded="xl"` to the largest supported value (e.g. `"lg"`).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual check**

In `npm run dev`: view `/dashboard` (member) and `/admin/members/<id>` (admin preview).
Expected: the card looks more refined (rounded-2xl, gilded name, hover lift) and all fields still render correctly.

- [ ] **Step 5: Commit**

```bash
git add components/id-card.tsx
git commit -m "feat(ui): modernize IdCard (elevated gold/ink)"
```

---

## Task 6: Public scan page — rewire Call-to-verify + visual refresh

**Files:**
- Modify: `app/id/[slug]/page.tsx`

- [ ] **Step 1: Replace the Contact block with the officer Call-to-verify block**

In `app/id/[slug]/page.tsx`, find the existing contact block (the JSX guarded by `{card.contact_number && (` ... rendering the gold `tel:` button, around lines 369–392) and replace the **entire** `{card.contact_number && ( ... )}` expression with:

```tsx
        {/* Verify via the responsible officer (chapter → district). Hidden when none. */}
        {card.verify_contact_number && (
          <div className="relative z-10 border-t border-gold/20 px-5 py-4">
            <a
              href={`tel:${card.verify_contact_number}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-gold px-4 py-3 text-primary-foreground transition-opacity hover:opacity-90"
            >
              <span className="flex items-center gap-2.5">
                <Phone className="size-5" strokeWidth={2.25} aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="tgp-eyebrow text-[0.6rem]">
                    Call officer to verify
                  </span>
                  {card.verify_contact_name && (
                    <span className="text-[0.7rem] font-medium opacity-90">
                      {card.verify_contact_name}
                    </span>
                  )}
                  <span className="tgp-mono text-sm font-semibold">
                    {card.verify_contact_number}
                  </span>
                </span>
              </span>
              <span className="text-[0.6rem] font-medium tracking-wide uppercase opacity-70">
                Tap
              </span>
            </a>
            <p className="mt-2 text-center text-[0.65rem] text-muted-foreground">
              Speak with a fraternity officer to confirm this member
            </p>
          </div>
        )}
```

This removes the last reference to `card.contact_number` (the field no longer exists on `MemberCard` after Task 2) and hides the whole block when `verify_contact_number` is null — satisfying the "hide the button" decision.

- [ ] **Step 2: Confirm no stale `contact_number` references remain**

Run: `grep -n "contact_number" app/id/[slug]/page.tsx`
Expected: only matches inside the new block are `verify_contact_number` / `verify_contact_name`. There must be **no** bare `card.contact_number`.

- [ ] **Step 3: Visual refresh of the credential (elevated gold/ink)**

Apply matching polish to the article container and identity hero. In the same file:

3a. Change the article wrapper opening tag from `rounded-xl` to `rounded-2xl`:

```tsx
      <article className="group relative isolate overflow-hidden rounded-2xl bg-card tgp-frame tgp-glow">
```

3b. In the identity hero (`<h1 ...>{card.full_name}</h1>`), add the `tgp-gild` gilded treatment by replacing that `<h1>`'s className:

```tsx
            <h1 className="tgp-display tgp-gild text-xl leading-tight font-semibold break-words">
              {card.full_name}
            </h1>
```

(If it already has `tgp-gild`, leave it.)

- [ ] **Step 4: Lint + build (type-check)**

Run: `npm run lint && npm run build`
Expected: both PASS. `next build` type-checks the whole app, so this is where the `MemberCard` type change (Task 2) is fully validated.

- [ ] **Step 5: Manual verification matrix**

With `npm run dev` and a member who has an active NFC slug, visit `/id/<slug>` and exercise each case from the admin chapters page:

| Setup | Expected on `/id/<slug>` |
| --- | --- |
| Chapter officer set (officer has a contact number) | Button dials the **chapter officer**; shows their name |
| Chapter officer cleared, district officer set | Button dials the **district officer** |
| Neither set (or officer has no number) | **No** Call-to-verify button at all |

- [ ] **Step 6: Commit**

```bash
git add "app/id/[slug]/page.tsx"
git commit -m "feat(verify): dial chapter/district officer + refresh scan page"
```

---

## Task 7: Final verification & wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Full build + lint**

Run: `npm run lint && npm run build`
Expected: both PASS with no errors or type errors.

- [ ] **Step 2: Re-grep for orphaned references**

Run: `grep -rn "card.contact_number" app components lib`
Expected: **no results** (the public surface no longer reads the member's own number). Note: `profile.contact_number` usage in `app/(app)/admin/members/[id]/page.tsx` is a **different** field (the admin reads the profile directly, server-side) and should remain.

- [ ] **Step 3: Confirm the four end-to-end behaviors with a reviewer**

Walk the user through: (a) IdCard looks modernized on portal + admin preview; (b) public scan page looks modernized; (c) the officer-resolution matrix from Task 6 Step 5; (d) admin can assign/clear both chapter and district officers.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide merge/PR/cleanup. Do not merge to `main` without the user's go-ahead.

---

## Self-Review (completed during authoring)

- **Spec coverage:** migration + RLS + RPC (Task 1) ✓; types (Task 2) ✓; both server actions (Task 3) ✓; chapter + district admin UI (Task 4) ✓; IdCard redesign (Task 5) ✓; public page rewire + hide-when-none + redesign (Task 6) ✓; drop member number from RPC (Task 1 + Task 2 + Task 6) ✓; verification plan (Task 7) ✓.
- **Placeholder scan:** none — every code step contains full code.
- **Type consistency:** `verify_contact_name`/`verify_contact_number` are used identically across the SQL (Task 1), `MemberCard` (Task 2), and the page (Task 6); `verify_officer_id` matches across SQL, `Chapter` type, and `setChapterOfficer`; `district_officers(district, officer_id)` columns match across SQL, `DistrictOfficer`, `setDistrictOfficer`, and the page query.
```
