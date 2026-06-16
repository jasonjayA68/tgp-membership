# Member Admin CRUD (Edit + Delete) — Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Context:** Tenant-admin member management (`/t/[slug]/admin/members/[id]`).

---

## Context

A tenant admin can change a member's **status / chapter / role / NFC card**, but cannot **edit the
member's details** (name, batch year, fraternal fields) and cannot **delete** a member. Members can
only edit their *own* profile (`updateProfile`). Reverting a rejected member **already works** — the
member detail page's status dropdown lists every status and the members list filters by
`?status=rejected` — so that needs no build, only awareness.

## Decisions locked during brainstorming

1. **Edit** the member's **biographical fields** (full name, batch year, fraternal `custom_fields`) —
   not `member_id` (auto-assigned/unique) and not status/chapter/role (their own controls).
2. **Delete = hard delete from this org**: remove the member's `profiles` + `tenant_users` +
   `nfc_cards` records. The login account remains (no service-role key; they could re-apply).
3. **Delete guarded by typing the member's name** to confirm + an audit row.

## 1. Edit member details — `lib/actions/admin.ts` + a form

- **`updateMemberProfile(_prev: AdminMemberState, formData)`** — `getAdminContext()` (tenant-admin
  gated). Validates the same field set as `updateProfile` (full name, batch year, alexis/batch/
  date-survived/GT/MWW/contact) via the existing schema, builds `custom_fields` with
  `fraternalToCustomFields`, and updates `profiles SET full_name, batch_year, custom_fields WHERE
  id = profileId AND tenant_id = tenant.id`. Returns `{ error?, notice?, fieldErrors? }`. Audits
  `member_updated`.
- **`components/admin/edit-member-form.tsx`** — a client `useActionState` form pre-filled from the
  member's current values, rendered in a new "Edit details" card on the member detail page. Mirrors
  the member-facing profile form's fields.

## 2. Delete member — migration `0018` + action + danger zone

A member spans three tables, so deletion is atomic via a SECURITY DEFINER RPC (the codebase pattern
for privileged multi-table ops, cf. `assign_tenant_owner`).

- **Migration `0018_delete_member.sql`** — `delete_member(p_profile_id uuid)` SECURITY DEFINER,
  `search_path = public`, granted to `authenticated`:
  - Resolve the profile's `tenant_id` + `user_id`; raise if not found.
  - `if not is_tenant_admin(v_tenant_id) then raise exception 'forbidden'`.
  - Delete `nfc_cards where profile_id = p_profile_id`; delete `profiles where id = p_profile_id`;
    delete `tenant_users where tenant_id = v_tenant_id and user_id = v_user_id`.
  - Insert `audit_logs` `member_deleted` (performed_by = auth.uid(), target_user = v_user_id,
    metadata = member name).
- **`deleteMember(formData)`** in `lib/actions/admin.ts` — `getAdminContext()`; reads `profileId`;
  calls `supabase.rpc("delete_member", { p_profile_id })`; on error returns/throws; on success
  `revalidatePath` the members list and `redirect("/admin")` (the member is gone). (`lib/types.ts`
  registers the RPC.)
- **Danger zone** on the member detail page: a client component with a **type-the-member's-name**
  input that enables the destructive **Delete member** button only on an exact match (same guard
  style as the platform org-archive), posting `profileId` to `deleteMember`.

## 3. Revert (no build)

Confirm in the runbook: Members → filter **Rejected** → open → set status **Active** (the existing
status `ActionSelect`).

## Out of scope (YAGNI)

Removing the auth login account (needs the service-role key); editing `member_id`; bulk member
operations; undo for a hard delete.

## Files

- **New:** `supabase/migrations/0018_delete_member.sql`, `supabase/tests/0018_delete_member_checks.sql`,
  `components/admin/edit-member-form.tsx`, `components/admin/delete-member.tsx`.
- **Updated:** `lib/actions/admin.ts` (`updateMemberProfile`, `deleteMember`), `lib/types.ts`
  (`delete_member` RPC), `app/(app)/admin/members/[id]/page.tsx` (Edit-details card + Danger zone).

## Verification

1. **`0018` probe** (transactional): seed a tenant + a member (profile + tenant_users + an nfc_card);
   `delete_member` as a context where the caller is a tenant admin removes all three rows and writes
   the audit row; a non-admin caller is blocked (`forbidden`). Rolls back.
2. **`tsc` + `build`** clean.
3. **Manual runbook:** edit a member's name/fraternal fields → saved on their profile + verify card;
   hard-delete a mistaken application → gone from the members list, `member_deleted` audited, their
   `/t/<slug>/id/<card>` 404s; revert a rejected member → Active.
