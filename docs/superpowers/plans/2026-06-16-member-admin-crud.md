# Member Admin CRUD (Edit + Delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant admin edit a member's biographical details and hard-delete a mistaken member from their org, from the member detail page.

**Architecture:** Two server actions in `lib/actions/admin.ts` — `updateMemberProfile` (validated biographical update, mirrors the member-facing `updateProfile` field set + `fraternalToCustomFields`) and `deleteMember` (calls a new `delete_member` SECURITY DEFINER RPC, then redirects to the members list). The RPC atomically removes the member's `nfc_cards`/`profiles`/`tenant_users` rows under an `is_tenant_admin` gate and writes a `member_deleted` audit row. Two client components — an `EditMemberForm` (pre-filled `useActionState` form) and a `DeleteMember` danger zone (type-the-name confirm) — are mounted on `app/(app)/admin/members/[id]/page.tsx`. Reverting a rejected member already works via the existing status `ActionSelect`, so it is only confirmed in the runbook.

**Tech Stack:** Next.js 16 App Router (server actions, `useActionState`), Supabase Postgres + RLS + SECURITY DEFINER RPC, zod, TypeScript.

**Conventions for every task (read once):**
- The working branch is `feat/member-admin-crud` (already created from `main`). Subagent reviews may auto-switch the working tree to `main` — before editing, run `git branch --show-current` and `git checkout feat/member-admin-crud` if it is not current.
- Migrations are NEVER run by us against the DB — the user applies `0018` and the probe in the Supabase SQL editor. Our verification is `npx tsc --noEmit`, `npm run build`, and the SQL probe script (which the user runs).
- Only the anon publishable Supabase key is ever used in app code — never a service-role/secret key.

---

### Task 1: Migration `0018_delete_member.sql` + probe

A member spans three tables. Deletion is atomic via a SECURITY DEFINER RPC (the codebase pattern for privileged multi-table ops, cf. `assign_tenant_owner` in `0017`). The RPC is `is_tenant_admin`-gated and audits `member_deleted`. `nfc_cards.profile_id` is `on delete cascade` and `chapters.verify_officer_id` is `on delete set null`, so deleting the profile is FK-safe; we delete `nfc_cards` explicitly first for clarity (idempotent with the cascade).

**Files:**
- Create: `supabase/migrations/0018_delete_member.sql`
- Create: `supabase/tests/0018_delete_member_checks.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0018_delete_member.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0018: delete_member (hard-delete a member from one org)
-- -----------------------------------------------------------------------------
-- A tenant admin may delete a mistaken member application. A member spans three
-- tables (profiles + nfc_cards + tenant_users), so removal is atomic via a
-- SECURITY DEFINER RPC, gated by is_tenant_admin() and audited. The login
-- account in auth.users is NOT touched (no service-role key; they may re-apply).
-- nfc_cards.profile_id is ON DELETE CASCADE and chapters.verify_officer_id is
-- ON DELETE SET NULL, so deleting the profile is FK-safe.
-- =============================================================================

create or replace function public.delete_member(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_user_id   uuid;
  v_name      text;
begin
  select tenant_id, user_id, full_name
    into v_tenant_id, v_user_id, v_name
    from public.profiles
   where id = p_profile_id;

  if v_tenant_id is null then
    raise exception 'member not found';
  end if;

  if not public.is_tenant_admin(v_tenant_id) then
    raise exception 'forbidden';
  end if;

  delete from public.nfc_cards where profile_id = p_profile_id;
  delete from public.profiles  where id = p_profile_id;
  delete from public.tenant_users
   where tenant_id = v_tenant_id and user_id = v_user_id;

  insert into public.audit_logs (tenant_id, action, performed_by, target_user, metadata)
  values (v_tenant_id, 'member_deleted', auth.uid(), v_user_id,
          jsonb_build_object('name', v_name, 'profile_id', p_profile_id));
end $$;

revoke all on function public.delete_member(uuid) from public;
grant execute on function public.delete_member(uuid) to authenticated;
```

- [ ] **Step 2: Write the probe**

Create `supabase/tests/0018_delete_member_checks.sql`. It tests the function's existence and both guards using existing data only (the auth-gated happy path is covered by the manual runbook — seeding `auth.users` inside a transaction is impractical). It rolls back, deleting nothing:

```sql
-- Probe for 0018_delete_member. Run in the Supabase SQL editor. Rolls back.
begin;

-- 1) Function exists and is granted to authenticated.
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_member'
  ) then
    raise exception 'FAIL: delete_member() is missing';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_member(uuid)', 'execute') then
    raise exception 'FAIL: delete_member() not executable by authenticated';
  end if;
  raise notice 'OK: delete_member() exists and is granted to authenticated';
end $$;

-- 2) Unknown profile -> "member not found" (lookup precedes the admin gate).
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.delete_member('00000000-0000-0000-0000-000000000000');
  exception when others then
    v_ok := (sqlerrm ilike '%not found%');
    if not v_ok then raise exception 'FAIL: wrong error for unknown profile: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'FAIL: delete_member did not raise for unknown profile'; end if;
  raise notice 'OK: unknown profile raises member-not-found';
end $$;

-- 3) Real profile, no auth context (auth.uid() is null -> not a tenant admin) -> "forbidden".
do $$
declare v_pid uuid; v_ok boolean := false;
begin
  select id into v_pid from public.profiles limit 1;
  if v_pid is null then
    raise notice 'SKIP: no profiles available to test the forbidden gate';
  else
    begin
      perform public.delete_member(v_pid);
    exception when others then
      v_ok := (sqlerrm ilike '%forbidden%');
      if not v_ok then raise exception 'FAIL: wrong error for non-admin caller: %', sqlerrm; end if;
    end;
    if not v_ok then raise exception 'FAIL: non-admin caller was not blocked'; end if;
    raise notice 'OK: non-admin caller is blocked (forbidden)';
  end if;
end $$;

rollback;
```

- [ ] **Step 3: Sanity-check the SQL parses locally (no DB run)**

Run: `ls -1 supabase/migrations/0018_delete_member.sql supabase/tests/0018_delete_member_checks.sql`
Expected: both paths print (files exist). We cannot execute SQL against the DB; the user runs the probe in the Supabase SQL editor and should see only `OK:`/`SKIP:` notices, no `FAIL:`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_delete_member.sql supabase/tests/0018_delete_member_checks.sql
git commit -m "feat(db): delete_member RPC (0018) + probe"
```

---

### Task 2: Register the RPC type + add both server actions

Add the `delete_member` signature to the generated `Database` types, then add `AdminMemberState`, `updateMemberProfile`, and `deleteMember` to `lib/actions/admin.ts`. `updateMemberProfile` validates the exact field set the member-facing `updateProfile` uses (so admin edits and self-edits stay identical), builds `custom_fields` via `fraternalToCustomFields`, and writes a `member_updated` audit row (the `handle_profile_change` trigger only audits status/chapter changes, and the `audit_insert_admin` policy permits a tenant admin to insert audit rows where `performed_by = auth.uid()`).

**Files:**
- Modify: `lib/types.ts` (the `Functions:` block, after `assign_tenant_owner`)
- Modify: `lib/actions/admin.ts` (imports at top; new exports after `setMemberStatus`)

- [ ] **Step 1: Register the RPC in `lib/types.ts`**

In the `Functions:` block (right after the `assign_tenant_owner` entry that ends near line 271), add:

```ts
      delete_member: { Args: { p_profile_id: string }; Returns: undefined };
```

- [ ] **Step 2: Add imports to `lib/actions/admin.ts`**

At the top of `lib/actions/admin.ts`, the existing imports are:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/lib/constants";
import { getActiveTenant } from "@/lib/tenant/context";
import type { MemberStatus, TenantRole } from "@/lib/types";
```

Replace that block with (adds `redirect`, `z`, and `fraternalToCustomFields`):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/lib/constants";
import { getActiveTenant } from "@/lib/tenant/context";
import { fraternalToCustomFields } from "@/lib/profile";
import type { MemberStatus, TenantRole } from "@/lib/types";
```

- [ ] **Step 3: Add the state type + validation schema + `updateMemberProfile` + `deleteMember`**

Insert the following immediately AFTER the `setMemberStatus` function (after its closing `}` near line 76, before the `/** Assign (or clear) a member's chapter. */` comment):

```ts
export type AdminMemberState = {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
};

const optionalText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

// Same field set the member-facing profile form validates (lib/actions/profile.ts),
// so an admin edit and a self-edit accept identical input.
const MemberEditSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name.").max(120),
  batchYear: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .int()
        .min(1968, "Batch year cannot precede 1968.")
        .max(2100, "Enter a valid batch year."),
    ])
    .transform((v) => (v === "" ? null : v)),
  alexisName: optionalText(),
  batchName: optionalText(),
  dateSurvived: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  gtName: optionalText(),
  gtNumber: optionalText(60),
  mwwName: optionalText(),
  mwwNumber: optionalText(60),
  contactNumber: optionalText(40),
});

/** Edit a member's biographical details (name, batch year, fraternal fields). */
export async function updateMemberProfile(
  _prev: AdminMemberState,
  formData: FormData,
): Promise<AdminMemberState> {
  const { supabase, tenant, user } = await getAdminContext();
  const profileId = required(formData, "profileId");

  const parsed = MemberEditSchema.safeParse({
    fullName: formData.get("fullName"),
    batchYear: formData.get("batchYear") ?? "",
    alexisName: formData.get("alexisName") ?? "",
    batchName: formData.get("batchName") ?? "",
    dateSurvived: formData.get("dateSurvived") ?? "",
    gtName: formData.get("gtName") ?? "",
    gtNumber: formData.get("gtNumber") ?? "",
    mwwName: formData.get("mwwName") ?? "",
    mwwNumber: formData.get("mwwNumber") ?? "",
    contactNumber: formData.get("contactNumber") ?? "",
  });

  if (!parsed.success) {
    return {
      error: "Please correct the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      batch_year: parsed.data.batchYear,
      custom_fields: fraternalToCustomFields({
        alexisName: parsed.data.alexisName,
        batchName: parsed.data.batchName,
        dateSurvived: parsed.data.dateSurvived,
        gtName: parsed.data.gtName,
        gtNumber: parsed.data.gtNumber,
        mwwName: parsed.data.mwwName,
        mwwNumber: parsed.data.mwwNumber,
        contactNumber: parsed.data.contactNumber,
      }),
    })
    .eq("id", profileId)
    .eq("tenant_id", tenant.id);
  if (error) return { error: error.message };

  // Biographical edits are not covered by the handle_profile_change trigger
  // (it audits status/chapter only), so record one explicitly.
  await supabase.from("audit_logs").insert({
    tenant_id: tenant.id,
    action: "member_updated",
    performed_by: user.id,
    target_user: null,
    metadata: { profile_id: profileId },
  });

  revalidateMember(profileId);
  return { notice: "Member details updated." };
}

/** Hard-delete a member from THIS org (profiles + nfc_cards + tenant_users). */
export async function deleteMember(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const profileId = required(formData, "profileId");

  const { error } = await supabase.rpc("delete_member", {
    p_profile_id: profileId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  // The member detail page no longer exists; return to the members list. Use the
  // tenant-scoped path so it resolves in both path mode and custom-domain mode.
  redirect(`/t/${tenant.slug}/admin`);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/actions/admin.ts
git commit -m "feat(admin): updateMemberProfile + deleteMember actions"
```

---

### Task 3: `EditMemberForm` component

A client `useActionState` form pre-filled from the member's current values. Mirrors the member-facing fraternal fields (same names/labels as `register-form.tsx`) so the admin form feels identical. Uses the shared UI primitives.

**Files:**
- Create: `components/admin/edit-member-form.tsx`

- [ ] **Step 1: Write the component**

Create `components/admin/edit-member-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  updateMemberProfile,
  type AdminMemberState,
} from "@/lib/actions/admin";

const initialState: AdminMemberState = {};

export type EditMemberFormProps = {
  profileId: string;
  fullName: string;
  batchYear: number | null;
  alexisName: string | null;
  batchName: string | null;
  dateSurvived: string | null;
  gtName: string | null;
  gtNumber: string | null;
  mwwName: string | null;
  mwwNumber: string | null;
  contactNumber: string | null;
};

export function EditMemberForm(props: EditMemberFormProps) {
  const [state, formAction] = useActionState(updateMemberProfile, initialState);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CircleCheck />
          <span>{state.notice}</span>
        </Alert>
      )}

      <input type="hidden" name="profileId" value={props.profileId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={props.fullName}
            aria-invalid={!!errors?.fullName}
            required
          />
          <FieldError messages={errors?.fullName} />
        </Field>
        <Field>
          <Label htmlFor="batchYear">Batch year</Label>
          <Input
            id="batchYear"
            name="batchYear"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 1995"
            defaultValue={props.batchYear ?? ""}
            aria-invalid={!!errors?.batchYear}
          />
          <FieldError messages={errors?.batchYear} />
        </Field>
        <Field>
          <Label htmlFor="alexisName">Alexis name</Label>
          <Input
            id="alexisName"
            name="alexisName"
            placeholder="Fraternal alias"
            defaultValue={props.alexisName ?? ""}
          />
          <FieldError messages={errors?.alexisName} />
        </Field>
        <Field>
          <Label htmlFor="batchName">Batch name</Label>
          <Input
            id="batchName"
            name="batchName"
            placeholder="e.g. Batch Maharlika"
            defaultValue={props.batchName ?? ""}
          />
          <FieldError messages={errors?.batchName} />
        </Field>
        <Field>
          <Label htmlFor="dateSurvived">Date survived</Label>
          <Input
            id="dateSurvived"
            name="dateSurvived"
            type="date"
            defaultValue={props.dateSurvived ?? ""}
            aria-invalid={!!errors?.dateSurvived}
          />
          <FieldError messages={errors?.dateSurvived} />
        </Field>
        <Field>
          <Label htmlFor="contactNumber">Contact number</Label>
          <Input
            id="contactNumber"
            name="contactNumber"
            type="tel"
            inputMode="tel"
            placeholder="+63 9XX XXX XXXX"
            defaultValue={props.contactNumber ?? ""}
          />
          <FieldError messages={errors?.contactNumber} />
        </Field>
        <Field>
          <Label htmlFor="gtName">GT (when survived)</Label>
          <Input
            id="gtName"
            name="gtName"
            placeholder="Grand Triskelion"
            defaultValue={props.gtName ?? ""}
          />
          <FieldError messages={errors?.gtName} />
        </Field>
        <Field>
          <Label htmlFor="gtNumber">GT&apos;s contact</Label>
          <Input
            id="gtNumber"
            name="gtNumber"
            type="tel"
            inputMode="tel"
            defaultValue={props.gtNumber ?? ""}
          />
          <FieldError messages={errors?.gtNumber} />
        </Field>
        <Field>
          <Label htmlFor="mwwName">MWW (when survived)</Label>
          <Input
            id="mwwName"
            name="mwwName"
            defaultValue={props.mwwName ?? ""}
          />
          <FieldError messages={errors?.mwwName} />
        </Field>
        <Field>
          <Label htmlFor="mwwNumber">MWW&apos;s contact</Label>
          <Input
            id="mwwNumber"
            name="mwwNumber"
            type="tel"
            inputMode="tel"
            defaultValue={props.mwwNumber ?? ""}
          />
          <FieldError messages={errors?.mwwNumber} />
        </Field>
      </div>

      <SubmitButton pendingText="Saving…">Save details</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `Alert`/`Field`/`FieldError`/`Input`/`Label`/`SubmitButton` import paths differ, confirm against `components/auth/register-form.tsx` (same primitives) and `lib/actions/profile.ts`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/edit-member-form.tsx
git commit -m "feat(admin): EditMemberForm component"
```

---

### Task 4: `DeleteMember` danger-zone component

A client component with a type-the-member's-name input that enables the destructive **Delete member** button only on an exact (trimmed) match, then posts `profileId` to `deleteMember`. The action itself re-checks admin authority and redirects, so this is a UX guard, not the security boundary.

**Files:**
- Create: `components/admin/delete-member.tsx`

- [ ] **Step 1: Write the component**

Create `components/admin/delete-member.tsx`. Check the `Button` import path against an existing client component that uses it (e.g. `grep -r "components/ui/button" components/`); the codebase uses shadcn-style `@/components/ui/button` with a `variant` prop.

```tsx
"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteMember } from "@/lib/actions/admin";

function DeleteButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={!enabled || pending}>
      {pending ? "Deleting…" : "Delete member"}
    </Button>
  );
}

export function DeleteMember({
  profileId,
  fullName,
}: {
  profileId: string;
  fullName: string;
}) {
  const [confirm, setConfirm] = useState("");
  const matches = confirm.trim() === fullName.trim();

  return (
    <form action={deleteMember} className="space-y-3">
      <input type="hidden" name="profileId" value={profileId} />
      <p className="text-sm text-muted-foreground">
        This permanently removes the member, their digital ID card, and their
        membership in this organization. Their login account is not deleted and
        they may re-apply. This cannot be undone.
      </p>
      <Field>
        <Label htmlFor="confirmName">
          Type <span className="font-semibold text-foreground">{fullName}</span>{" "}
          to confirm
        </Label>
        <Input
          id="confirmName"
          name="confirmName"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={fullName}
        />
      </Field>
      <DeleteButton enabled={matches} />
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/delete-member.tsx
git commit -m "feat(admin): DeleteMember danger-zone component"
```

---

### Task 5: Mount both on the member detail page

Add an "Edit details" card (using `EditMemberForm`) and a "Danger zone" card (using `DeleteMember`) to `app/(app)/admin/members/[id]/page.tsx`. The page already builds `profile` (a `ProfileWithChapter` with flattened fraternal fields) and the right-hand column of `<Card>`s.

**Files:**
- Modify: `app/(app)/admin/members/[id]/page.tsx`

- [ ] **Step 1: Add the imports**

Near the existing `import { ActionSelect } from "@/components/admin/action-select";` (around line 12), add:

```tsx
import { EditMemberForm } from "@/components/admin/edit-member-form";
import { DeleteMember } from "@/components/admin/delete-member";
```

- [ ] **Step 2: Insert the "Edit details" card**

The page renders a read-only "Fraternal information" `<Card>` whose `<CardTitle>` is `Fraternal information`. Immediately AFTER that card's closing `</Card>` (before the "Recent activity" `<Card>`), insert:

```tsx
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edit details</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <EditMemberForm
                profileId={profile.id}
                fullName={profile.full_name}
                batchYear={profile.batch_year}
                alexisName={profile.alexis_name}
                batchName={profile.batch_name}
                dateSurvived={profile.date_survived}
                gtName={profile.gt_name}
                gtNumber={profile.gt_number}
                mwwName={profile.mww_name}
                mwwNumber={profile.mww_number}
                contactNumber={profile.contact_number}
              />
            </CardContent>
          </Card>
```

- [ ] **Step 3: Insert the "Danger zone" card**

As the LAST card in the same column (after the "Recent activity" `<Card>` closing `</Card>`), insert:

```tsx
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base text-destructive">
                Danger zone
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DeleteMember
                profileId={profile.id}
                fullName={profile.full_name}
              />
            </CardContent>
          </Card>
```

If `profile.id` is not in scope under that name, use the same identifier the page already uses for the member's profile row id (check how `profileId` / `profile` is derived near the top of the file and the `cardData`/`fraternalRecord` blocks).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean; build succeeds. (`npm run build` may be slow — allow up to 5 minutes.)

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/members/[id]/page.tsx"
git commit -m "feat(admin): mount edit + delete on member detail page"
```

---

### Task 6: Verification & runbook

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 2: User applies SQL (manual, document in the handoff)**

The user runs, in the Supabase SQL editor, in this order:
1. `supabase/migrations/0018_delete_member.sql` (creates the RPC).
2. `supabase/tests/0018_delete_member_checks.sql` (probe) — expect only `OK:`/`SKIP:` notices, no `FAIL:`.

(If not already applied from prior work: `0017_fix_assign_owner.sql` and the owner-assignment for `jasonjay.ababao1968@gmail.com` on `metro-iligan-council`. These are independent of this feature.)

- [ ] **Step 3: Manual runbook (record results in the finish handoff)**

1. **Edit:** As a tenant admin, open `/t/<slug>/admin/members/<id>` → "Edit details" → change the name + a fraternal field → Save → success alert; the read-only "Fraternal information" card and the member's verify/ID card reflect the change; an audit row `member_updated` appears.
2. **Delete:** Open a mistaken member → "Danger zone" → the Delete button is disabled until the typed name exactly matches → confirm → redirected to `/t/<slug>/admin`; the member is gone from the list; their `/t/<slug>/id/<card>` 404s; an audit row `member_deleted` appears. The login account still exists (they can re-apply).
3. **Revert (no build):** Members → filter **Rejected** → open a rejected member → set status **Active** via the existing status dropdown → they return to the active roster.

- [ ] **Step 4: Final commit (if any runbook fixes were needed)**

```bash
git add -A && git commit -m "fix(admin): member CRUD runbook adjustments"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** Edit action+form (Tasks 2–3, 5), delete RPC+action+danger zone (Tasks 1–2, 4–5), revert confirmed (Task 6 runbook), `lib/types.ts` RPC registration (Task 2). All spec files covered.
- **Type consistency:** `AdminMemberState` defined in Task 2 and consumed in Task 3; `updateMemberProfile(_prev, formData)` and `deleteMember(formData)` signatures match between action (Task 2) and components (Tasks 3–4); RPC name `delete_member` + arg `p_profile_id` identical in migration (Task 1), types (Task 2), and action (Task 2).
- **Audit:** `member_updated` written by the action (biographical edits are outside the `handle_profile_change` trigger; `audit_insert_admin` policy permits it); `member_deleted` written inside the SECURITY DEFINER RPC.
- **FK safety:** `nfc_cards.profile_id` cascade + `chapters.verify_officer_id` set-null verified; scans are a counter column, not a table.
