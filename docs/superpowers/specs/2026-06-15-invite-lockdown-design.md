# Invite-Only Lockdown (#7a) — Design Spec

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Sub-project:** #7a — first half of the post-mega-spec "controlled soft launch." Follows
[[saas-os-roadmap]] #1–#6 + #4b. Paired with **#7b** (domain-aware public entry UX), built after.

---

## Context

Four large specs converged on one real decision: **registration becomes invite-only.** Today the
platform has *open* self-signup — `supabase.auth.signUp` is public, and the `handle_new_user` trigger
(`0007`) auto-attaches **any** new signup to a tenant as a `member`, defaulting to `tgp` and trusting
a client-supplied `tenant_slug`. Plus `join_tenant_by_slug` (`0008`) lets any authenticated user
self-join any tenant. This sub-project closes that: an admin allowlists an email, the person claims
it by signing up with that exact email, and the trigger attaches them — to that one tenant, as
`pending`, awaiting approval.

**Hard constraint (unchanged):** the app holds only the Supabase **anon** key — never the
service-role key. So an admin cannot create a member's auth account server-side. The model is
therefore **invite allowlist + self-claim**, which needs no privileged API and no email/SMTP.

Almost everything else in the four specs is already live: custom domains (#4b), homepage CMS (#5b),
tenant resolution (#2), `/platform` console (#4), tenant isolation + RLS (#1). This sub-project adds
the lockdown backend and two small `/platform` views; the public-entry UX (tenant-scoped
login/register routes, custom-domain root → homepage, homepage buttons) is **#7b**.

## Decisions locked during brainstorming

1. **Direction:** controlled soft-launch lockdown — three roles (`super_admin` = `platform_admins`,
   `tenant_admin` = `tenant_users.role ∈ {owner,admin}`, `member`). **No `chapter_admin`** (that
   design is shelved as a documented future sub-project — not built).
2. **Onboarding:** invite allowlist + self-claim (no service-role, no SMTP).
3. **Who invites:** both, scoped — tenant admins into their own tenant; super admin into any.
4. **Claimed invite → `pending`** (not auto-active): the invite gates *who can sign up*, the existing
   tenant-admin approval gates *activation*. Two gates.
5. **Global email uniqueness** in `tenant_invites` (one email → one org), matching "a member belongs
   to one tenant only." Invite-level rule only; the `tenant_users` schema is unchanged.

---

## 1. Data model — migration `0015_invite_lockdown.sql`

### `tenant_invites`
```
id          uuid pk default gen_random_uuid()
tenant_id   uuid not null references public.tenants (id) on delete cascade
email       text not null            -- stored lower(trim())
role        public.tenant_role not null default 'member'
invited_by  uuid references auth.users (id) on delete set null
created_at  timestamptz not null default now()
claimed_at  timestamptz              -- null = unclaimed
```
- **`create unique index tenant_invites_email_key on public.tenant_invites (lower(email));`** — global
  uniqueness (one outstanding/claimed invite per email).
- Index `tenant_invites (tenant_id, created_at desc)` for the admin list.
- **RLS:** `select`/`insert`/`delete` `using`/`with check` = `is_tenant_admin(tenant_id) or
  is_platform_admin()`. No member access. (Anon has none.) The `email` whitelist is not anon-readable.

### Forward-compat note
`role` exists for future "invite directly as admin," but the invite **UI issues `member` only**;
tenant-admin promotion stays the existing `assign_tenant_owner` flow.

## 2. The lockdown core — gate + rewrite `handle_new_user`

Add a testable resolver, then make the trigger use it.

- **`invite_tenant_for_email(p_email text) returns uuid`** — SECURITY DEFINER, `set search_path =
  public`, `stable`: returns the `tenant_id` of the **unclaimed** invite whose `lower(email) =
  lower(trim(p_email))`, else `null`. (Pure lookup — unit-testable without the FK-constrained
  `auth.users` insert.)
- **Rewrite `handle_new_user`** (keep it SECURITY DEFINER):
  - `t_id := public.invite_tenant_for_email(new.email);`
  - **`if t_id is null then return new;`** — no invite → **no membership** (the user exists in auth
    but lands on "No workspaces yet"). The `tgp` default and the `tenant_slug`/`tenant_id` metadata
    paths are **removed** — tenant is decided solely by the admin-controlled invite, keyed on email.
  - Else: copy the fraternal `custom_fields` from metadata (unchanged loop); insert `tenant_users
    (t_id, new.id, <invite role>)` and `profiles (t_id, new.id, full_name, custom_fields)` with
    `status` defaulting to `pending`; then **`update tenant_invites set claimed_at = now() where
    lower(email) = lower(trim(new.email)) and claimed_at is null;`**.
  - The invite's `role` is read alongside the lookup (extend the resolver to also surface role, or
    re-select it in the trigger). Implementation detail for the plan; default `member`.

### Retire `join_tenant_by_slug`
`drop function if exists public.join_tenant_by_slug(text) cascade;` — the authenticated self-join is
the other open-signup path. Remove its caller `joinTenant` in `lib/actions/auth.ts` and the
`join_tenant_by_slug` entry in `lib/types.ts`, plus any UI control that invokes `joinTenant` (the
plan locates it — likely the workspace switcher's "join" affordance).

## 3. Invite UI + actions (both scoped)

Writes go through the **authed client** (RLS enforces authority); each action re-verifies its role
(defense in depth) and writes an audit row.

- **Tenant admin** — on the members page `app/(app)/admin/page.tsx`: an **"Invite member"** form
  (email; optional note) + a list of **unclaimed** invites with a **Revoke** button.
  - `inviteMember(formData)` in `lib/actions/admin.ts`: `requireTenantAdmin()`; normalize email;
    insert `tenant_invites (tenant_id = active tenant, email, role 'member', invited_by =
    auth.uid())`; map unique-violation (`23505`) → "That email is already invited or registered";
    audit `member_invited`; `revalidatePath`.
  - `revokeInvite(formData)`: delete an **unclaimed** invite (`claimed_at is null`) in the active
    tenant; audit `invite_revoked`.
- **Super admin** — on `app/platform/tenants/[id]/page.tsx`: the same invite + revoke control for that
  tenant (seed a new org's first members before its admin exists).
  - `inviteMemberToTenant(_prev, formData)` / `revokeTenantInvite(_prev, formData)` in
    `lib/actions/platform.ts` (`PlatformState` shape, `getPlatformContext()`), tenant id from the
    form; same audit events.
- Shared email validation/normalization helper (e.g. `lib/invite.ts` `normalizeEmail`) used by both,
  Node-testable (`lib/invite.check.mts`, tsconfig-excluded) — lowercases, trims, rejects empty /
  obviously invalid (no `@`).

## 4. Retire the public-signup surface (minimal UI; polish is #7b)

- **`app/(auth)/register/page.tsx` + `components/auth/register-form.tsx`:** reword to make clear
  registration is **by invitation** ("Use the email you were invited with"); **remove the
  `tenantSlug` hidden field** (tenant now comes from the invite, not the slug/query). `signUp` itself
  is unchanged mechanically — a non-invited signup simply yields no membership (the trigger is the
  real gate; the copy just tells the truth).
- The login "Register to join" cross-link stays but is reworded ("Have an invite? Claim it"). The
  richer homepage "Sign In / Request access" buttons + tenant-scoped routes are **#7b**.

## 5. Two small `/platform` views (from spec #3)

Both via SECURITY DEFINER RPCs gated on `is_platform_admin()` (mirrors `platform_tenant_stats` from
`0010`) — no RLS assumptions.

- **`platform_all_members() returns table(...)`** — every profile across tenants: `tenant_id,
  tenant_name, user_id, full_name, member_id, status, created_at`. New page **`/platform/members`**
  (super-admin) with a tenant column + a status/tenant filter.
- **`platform_audit_log(p_limit int default 100) returns table(...)`** — recent `audit_logs` across
  all tenants: `tenant_name, action, performed_by, target_user, metadata, created_at`. New page
  **`/platform/audit`** (super-admin). The per-tenant viewer at `/t/[slug]/admin/audit` already
  exists; this is the cross-tenant view.

## 6. Audit events

`audit_logs` columns are `(tenant_id, action, performed_by, target_user, metadata, created_at)`. Wire:
- `member_invited` (metadata: `{email}`), `invite_revoked` (metadata: `{email}`) — from the four
  actions above.
- (Already audited / out of scope to expand here: owner assignment. Member-approval auditing can ride
  along if cheap, but is not required for #7a.)

## 7. Out of scope (YAGNI / shelved / already done)

- `chapter_admin` (shelved sub-project, documented in roadmap).
- Magic-link / email invites (no SMTP configured).
- Self-serve tenant creation; reopening public signup.
- Custom-domain onboarding (already #4b).
- Multi-tenant membership per user (lockdown enforces one invite/email).
- Tenant-scoped login/register routes, custom-domain root → homepage, homepage Sign-In/Request-access
  buttons, `/platform/login` — all **#7b**.

## 8. Files

- **New:** `supabase/migrations/0015_invite_lockdown.sql`,
  `supabase/tests/0015_invite_lockdown_checks.sql`, `lib/invite.ts`, `lib/invite.check.mts`,
  `components/admin/invite-member.tsx`, `components/platform/tenant-invites.tsx`,
  `app/platform/members/page.tsx`, `app/platform/audit/page.tsx`.
- **Updated:** `supabase/migrations` trigger (`handle_new_user` rewrite) + drop `join_tenant_by_slug`
  (in `0015`); `lib/actions/admin.ts` (`inviteMember`/`revokeInvite`); `lib/actions/platform.ts`
  (`inviteMemberToTenant`/`revokeTenantInvite`); `lib/actions/auth.ts` (remove `joinTenant`);
  `lib/types.ts` (`tenant_invites` table type, `invite_tenant_for_email` + `platform_all_members` +
  `platform_audit_log` functions, drop `join_tenant_by_slug`); `app/(app)/admin/page.tsx` (invite UI);
  `app/platform/tenants/[id]/page.tsx` (invite UI); `app/(auth)/register/page.tsx` +
  `components/auth/register-form.tsx` (reword, drop `tenantSlug`); the platform nav (links to the new
  members + audit pages); `tsconfig.json` (exclude `lib/invite.check.mts`); remove the `joinTenant` UI
  caller.

## 9. Verification

1. **`0015` probe (`supabase/tests/0015_invite_lockdown_checks.sql`)** — transactional, rolls back:
   - Insert a `tenant_invites` row for TGP, email `invitee@example.com`, unclaimed →
     `invite_tenant_for_email('Invitee@Example.com')` returns TGP's id (case/space-insensitive).
   - `invite_tenant_for_email('stranger@example.com')` returns `null` (no invite → no attach).
   - Set `claimed_at = now()` → resolver now returns `null` (can't double-claim).
   - A second insert of the same `lower(email)` raises `23505` (global uniqueness).
   - Confirm `join_tenant_by_slug` no longer exists (`to_regprocedure('public.join_tenant_by_slug(text)')
     is null`).
   - Ends in `ROLLBACK`.
2. **`lib/invite.check.mts` (Node):** `normalizeEmail` lowercases/trims, rejects empty + no-`@`.
3. **`tsc` + `build`** clean.
4. **Manual runbook:** (a) as a TGP admin at `/t/tgp/admin`, invite `new@x.com` → appears in the
   unclaimed list; (b) register at `/register` with `new@x.com` → lands as a **pending** TGP member;
   approve → active; (c) register with a **non-invited** email → "No workspaces yet" (no membership);
   (d) revoke an unclaimed invite → that email can no longer claim; (e) super admin at
   `/platform/tenants/<id>` invites into a tenant; (f) `/platform/members` lists across tenants,
   `/platform/audit` shows the `member_invited`/`invite_revoked` events; (g) existing members + login
   unaffected.
