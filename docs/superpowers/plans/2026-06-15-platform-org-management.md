# Platform Org Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `/platform` super-admin console full org lifecycle — edit, archive (soft-delete)/restore, Storage-backed logo upload — plus a sign-out button.

**Architecture:** Additive migration adds an `archived` tenant status + a public `branding` Storage bucket (platform-admin write). New platform actions (edit/archive/restore/logo) follow the existing `getPlatformContext()` + `PlatformState` + audit pattern; logo upload mirrors the proven `avatars` flow. Middleware blocks archived workspaces. UI: an edit card + danger zone on the tenant detail page, an archived section on the list, a split branding card (logo upload + colors), and a header sign-out.

**Tech Stack:** Next.js 16 App Router (server actions, FormData file upload), Supabase Postgres + RLS + Storage, TypeScript, existing shadcn UI + `Brandmark`/`SubmitButton`.

**Context for the implementer:**
- Branch `feat/platform-login-redirect` (Part A + bootstrap fixes live here). Build on it.
- Spec: `docs/superpowers/specs/2026-06-15-platform-org-management-design.md`.
- No pure-logic units; gates are the `0016` probe (Task 1, user-applied), `npx tsc --noEmit`, `npm run build`, and the manual runbook (final task) — matching how prior console sub-projects are verified.
- `getPlatformContext()` returns `{ supabase, user }` and enforces platform-admin. `PlatformState = { error?: string; notice?: string }`. Audit table columns: `(tenant_id, action, performed_by, target_user, metadata, created_at)`.
- You cannot apply migrations; author `0016` + its probe, commit, and the user applies them.

---

## File Structure
- **New:** `supabase/migrations/0016_platform_org_mgmt.sql`, `supabase/tests/0016_platform_org_mgmt_checks.sql`, `components/platform/edit-org-form.tsx`.
- **Modified:** `lib/types.ts` (`TenantStatus`), `lib/actions/platform.ts` (5 new actions + `updateTenantBranding` drops logo), `lib/supabase/proxy.ts` (archived block), `components/platform/branding-form.tsx` (logo upload + colors split), `app/platform/(console)/tenants/[id]/page.tsx` (edit card + danger zone + branding `name` prop), `app/platform/(console)/page.tsx` (archived section), `app/platform/(console)/layout.tsx` (sign out).

---

### Task 1: Migration `0016` + probe

**Files:** Create `supabase/migrations/0016_platform_org_mgmt.sql`, `supabase/tests/0016_platform_org_mgmt_checks.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0016_platform_org_mgmt.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0016: Platform Org Management
-- -----------------------------------------------------------------------------
-- ADDITIVE. Adds the 'archived' tenant status + a public 'branding' Storage
-- bucket (platform-admin write) for tenant logo uploads. Safe on a DB with
-- 0007–0015 applied.
--
-- NOTE: 'archived' is only USED at runtime (by archiveTenant) — never in this
-- migration — so there is no same-transaction "unsafe use of new enum value".
-- If your SQL editor rejects ADD VALUE inside a transaction, run that one line
-- on its own first, then the rest.
-- =============================================================================

alter type public.tenant_status add value if not exists 'archived';

-- Tenant-logo bucket: public read, platform-admin write (mirrors avatars, 0007).
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists branding_public_read  on storage.objects;
drop policy if exists branding_admin_insert on storage.objects;
drop policy if exists branding_admin_update on storage.objects;
drop policy if exists branding_admin_delete on storage.objects;

create policy branding_public_read on storage.objects for select
  using (bucket_id = 'branding');
create policy branding_admin_insert on storage.objects for insert
  with check (bucket_id = 'branding' and public.is_platform_admin());
create policy branding_admin_update on storage.objects for update
  using (bucket_id = 'branding' and public.is_platform_admin());
create policy branding_admin_delete on storage.objects for delete
  using (bucket_id = 'branding' and public.is_platform_admin());
```

- [ ] **Step 2: Write the probe**

Create `supabase/tests/0016_platform_org_mgmt_checks.sql`:

```sql
-- Transactional probe for 0016. Rolls back. Run AFTER applying the migration.
begin;

do $$
declare
  v_tid      uuid;
  v_buckets  int;
  v_policies int;
begin
  -- 1. The enum accepts 'archived', and it round-trips.
  insert into public.tenants (name, slug, member_id_prefix, status)
  values ('Probe Arch', 'probe-arch-org', 'PRA', 'archived')
  returning id into v_tid;
  if (select status from public.tenants where id = v_tid) <> 'archived' then
    raise exception 'FAIL: archived status not stored';
  end if;
  raise notice 'OK: archived status accepted';

  -- 2. Restore back to active.
  update public.tenants set status = 'active' where id = v_tid;
  if (select status from public.tenants where id = v_tid) <> 'active' then
    raise exception 'FAIL: restore failed';
  end if;
  raise notice 'OK: restore to active works';

  -- 3. The branding bucket exists.
  select count(*) into v_buckets from storage.buckets where id = 'branding';
  if v_buckets <> 1 then raise exception 'FAIL: branding bucket missing'; end if;
  raise notice 'OK: branding bucket exists';

  -- 4. Four branding storage policies exist.
  select count(*) into v_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'branding_%';
  if v_policies <> 4 then
    raise exception 'FAIL: expected 4 branding policies, got %', v_policies;
  end if;
  raise notice 'OK: 4 branding storage policies present';

  raise notice 'ALL 0016 CHECKS PASSED';
end $$;

rollback;
```

- [ ] **Step 3: Syntax sanity**

Run: `grep -c "raise notice 'OK" supabase/tests/0016_platform_org_mgmt_checks.sql`
Expected: `4`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0016_platform_org_mgmt.sql supabase/tests/0016_platform_org_mgmt_checks.sql
git commit -m "feat(db): archived tenant status + branding Storage bucket (0016)"
```

---

### Task 2: Types + middleware (archived)

**Files:** Modify `lib/types.ts`, `lib/supabase/proxy.ts:163-164`

- [ ] **Step 1: Add `archived` to `TenantStatus`**

In `lib/types.ts`, change:
```ts
export type TenantStatus = "active" | "suspended" | "onboarding";
```
to:
```ts
export type TenantStatus = "active" | "suspended" | "onboarding" | "archived";
```

- [ ] **Step 2: Block archived workspaces in middleware**

In `lib/supabase/proxy.ts`, find the suspended check (in the `/t/[slug]` branch, ~line 163):
```ts
    if (tenant.status === "suspended")
      return rewrite("/workspace-suspended", request, response);
```
Add the archived block immediately after it:
```ts
    if (tenant.status === "suspended")
      return rewrite("/workspace-suspended", request, response);
    if (tenant.status === "archived")
      return rewrite("/workspace-not-found", request, response);
```
(Host mode needs no change — `resolve_tenant_by_host` already filters `status = 'active'`.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/supabase/proxy.ts
git commit -m "feat(tenant): archived status type + middleware workspace block"
```

---

### Task 3: Edit + archive/restore actions

**Files:** Modify `lib/actions/platform.ts` (append 3 actions)

- [ ] **Step 1: Append the actions at the end of `lib/actions/platform.ts`**

```ts
/** Edit an org's core fields (name / slug / member-ID prefix). */
export async function updateTenant(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const prefix = String(formData.get("prefix") ?? "").trim().toUpperCase();
  if (name.length < 2) return { error: "Enter an organization name." };
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    return { error: "Slug must be 2–40 lowercase letters, numbers, or hyphens." };
  }
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
    return { error: "Prefix must be 2–8 uppercase letters or numbers." };
  }

  const { error } = await supabase
    .from("tenants")
    .update({ name, slug, member_id_prefix: prefix })
    .eq("id", tenantId);
  if (error) {
    return {
      error:
        error.code === "23505" || error.message.includes("duplicate")
          ? "That slug is already taken."
          : error.message,
    };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "tenant_updated",
    performed_by: user.id,
    metadata: { name, slug, prefix },
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform");
  return { notice: "Organization updated." };
}

/** Soft-delete: archive an org (data preserved, workspace blocked). */
export async function archiveTenant(formData: FormData): Promise<void> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;
  await supabase.from("tenants").update({ status: "archived" }).eq("id", tenantId);
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "tenant_archived",
    performed_by: user.id,
    metadata: {},
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform");
}

/** Restore an archived org to active. */
export async function restoreTenant(formData: FormData): Promise<void> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;
  await supabase.from("tenants").update({ status: "active" }).eq("id", tenantId);
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "tenant_restored",
    performed_by: user.id,
    metadata: {},
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform");
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/platform.ts
git commit -m "feat(platform): updateTenant + archive/restore actions (audited)"
```

---

### Task 4: Logo upload actions + branding refactor

**Files:** Modify `lib/actions/platform.ts`

- [ ] **Step 1: Append the logo actions at the end of `lib/actions/platform.ts`**

```ts
const LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const LOGO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Upload a tenant logo to the `branding` bucket and store its public URL. */
export async function uploadTenantLogo(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a logo image to upload." };
  }
  if (!LOGO_TYPES.has(file.type)) {
    return { error: "Logo must be a PNG, JPG, WebP, or SVG." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { error: "Logo must be 2 MB or smaller." };
  }

  const filename = `logo-${Date.now()}.${LOGO_EXT[file.type]}`;
  const path = `${tenantId}/${filename}`;
  const { error: upErr } = await supabase.storage
    .from("branding")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { error: upErr.message };

  const {
    data: { publicUrl },
  } = supabase.storage.from("branding").getPublicUrl(path);
  const { error: updErr } = await supabase
    .from("tenants")
    .update({ logo_url: publicUrl })
    .eq("id", tenantId);
  if (updErr) return { error: updErr.message };

  // Prune superseded logos for this tenant.
  const { data: existing } = await supabase.storage.from("branding").list(tenantId);
  const stale = (existing ?? [])
    .filter((f) => f.name !== filename)
    .map((f) => `${tenantId}/${f.name}`);
  if (stale.length) await supabase.storage.from("branding").remove(stale);

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "branding_updated",
    performed_by: user.id,
    metadata: { logo: true },
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Logo updated." };
}

/** Remove a tenant's logo (clears logo_url + deletes the stored files). */
export async function removeTenantLogo(formData: FormData): Promise<void> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const { data: existing } = await supabase.storage.from("branding").list(tenantId);
  const all = (existing ?? []).map((f) => `${tenantId}/${f.name}`);
  if (all.length) await supabase.storage.from("branding").remove(all);

  await supabase.from("tenants").update({ logo_url: null }).eq("id", tenantId);
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "branding_updated",
    performed_by: user.id,
    metadata: { logo: false },
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
}
```

- [ ] **Step 2: Drop `logo_url` from `updateTenantBranding`**

In `lib/actions/platform.ts`, in `updateTenantBranding`, change the `.update({...})` to drop the logo line:
```ts
  const { error } = await supabase
    .from("tenants")
    .update({
      primary_color: clean("primary_color"),
      secondary_color: clean("secondary_color"),
    })
    .eq("id", tenantId);
```
(Keep the rest of the function unchanged. The `clean` helper is still used for the two colors.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/platform.ts
git commit -m "feat(platform): tenant logo upload/remove (branding bucket); colors-only branding"
```

---

### Task 5: Branding form split + EditOrgForm

**Files:** Create `components/platform/edit-org-form.tsx`; rewrite `components/platform/branding-form.tsx`

- [ ] **Step 1: Create `components/platform/edit-org-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Save } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateTenant, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function EditOrgForm({
  tenantId,
  name,
  slug,
  prefix,
}: {
  tenantId: string;
  name: string;
  slug: string;
  prefix: string;
}) {
  const [state, formAction] = useActionState(updateTenant, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{state.notice}</span>
        </Alert>
      )}
      <Field>
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </Field>
      <Field>
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" name="slug" defaultValue={slug} required />
        <p className="text-xs text-amber-500">
          Changing the slug breaks existing /t/{slug} links and QR codes. Custom domains are
          unaffected.
        </p>
      </Field>
      <Field>
        <Label htmlFor="prefix">Member ID prefix</Label>
        <Input id="prefix" name="prefix" defaultValue={prefix} required />
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        <Save />
        Save changes
      </SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: Rewrite `components/platform/branding-form.tsx`** (logo upload + colors)

Replace the ENTIRE file with:

```tsx
"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Paintbrush, Trash2, Upload } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  removeTenantLogo,
  updateTenantBranding,
  uploadTenantLogo,
  type PlatformState,
} from "@/lib/actions/platform";

const initial: PlatformState = {};

export function BrandingForm({
  tenantId,
  name,
  logoUrl,
  primaryColor,
  secondaryColor,
}: {
  tenantId: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  const [logoState, logoAction] = useActionState(uploadTenantLogo, initial);
  const [colorState, colorAction] = useActionState(updateTenantBranding, initial);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {logoState.error && (
          <Alert variant="danger">
            <CircleAlert />
            <span>{logoState.error}</span>
          </Alert>
        )}
        {logoState.notice && (
          <Alert variant="success">
            <CheckCircle2 />
            <span>{logoState.notice}</span>
          </Alert>
        )}
        <div className="flex items-start gap-3">
          <Brandmark name={name} logoUrl={logoUrl} className="size-12 text-base" />
          <div className="min-w-0 flex-1 space-y-1">
            <form action={logoAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tenantId" value={tenantId} />
              <Input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                required
                className="max-w-[220px]"
              />
              <SubmitButton size="sm" pendingText="Uploading…">
                <Upload />
                Upload logo
              </SubmitButton>
            </form>
            <p className="text-xs text-muted-foreground">PNG, JPG, WebP, or SVG · up to 2 MB.</p>
          </div>
        </div>
        {logoUrl && (
          <form action={removeTenantLogo}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <SubmitButton size="sm" variant="outline" pendingText="…">
              <Trash2 />
              Remove logo
            </SubmitButton>
          </form>
        )}
      </div>

      <form action={colorAction} className="space-y-3 border-t border-border pt-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        {colorState.error && (
          <Alert variant="danger">
            <CircleAlert />
            <span>{colorState.error}</span>
          </Alert>
        )}
        {colorState.notice && (
          <Alert variant="success">
            <CheckCircle2 />
            <span>{colorState.notice}</span>
          </Alert>
        )}
        <Field>
          <Label htmlFor="primary_color">Primary color (accent)</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Primary color"
              defaultValue={primaryColor ?? "#e9b82e"}
              onChange={(e) => {
                const t = document.getElementById("primary_color") as HTMLInputElement | null;
                if (t) t.value = e.target.value;
              }}
              className="size-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            />
            <Input id="primary_color" name="primary_color" defaultValue={primaryColor ?? ""} placeholder="#e9b82e" />
          </div>
        </Field>
        <Field>
          <Label htmlFor="secondary_color">Secondary color (surface)</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Secondary color"
              defaultValue={secondaryColor ?? "#050505"}
              onChange={(e) => {
                const t = document.getElementById("secondary_color") as HTMLInputElement | null;
                if (t) t.value = e.target.value;
              }}
              className="size-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            />
            <Input id="secondary_color" name="secondary_color" defaultValue={secondaryColor ?? ""} placeholder="#050505" />
          </div>
        </Field>
        <SubmitButton size="sm" pendingText="Saving…">
          <Paintbrush />
          Save colors
        </SubmitButton>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean. (If `Input` doesn't accept `type="file"`, replace that `<Input type="file" .../>` with a native `<input type="file" .../>` carrying the same `name`/`accept`/`required` — but the shadcn `Input` forwards `type`, so it should pass.)

- [ ] **Step 4: Commit**

```bash
git add components/platform/edit-org-form.tsx components/platform/branding-form.tsx
git commit -m "feat(platform): EditOrgForm + branding card split (logo upload + colors)"
```

---

### Task 6: Wire UI — tenant detail, list, console header

**Files:** Modify `app/platform/(console)/tenants/[id]/page.tsx`, `app/platform/(console)/page.tsx`, `app/platform/(console)/layout.tsx`

- [ ] **Step 1: Tenant detail page — pass `name` to BrandingForm, add Edit + Danger zone**

In `app/platform/(console)/tenants/[id]/page.tsx`:

(a) Add imports near the other `@/components/platform/*` imports:
```tsx
import { EditOrgForm } from "@/components/platform/edit-org-form";
import { archiveTenant, restoreTenant } from "@/lib/actions/platform";
```
(Also ensure `Archive`, `ArchiveRestore` icons are available — add to the existing `lucide-react` import: `import { ArrowLeft, Power, ShieldCheck, Archive, ArchiveRestore } from "lucide-react";`.)

(b) Pass `name` into the existing `<BrandingForm .../>` call:
```tsx
          <BrandingForm
            tenantId={tenant.id}
            name={tenant.name}
            logoUrl={tenant.logo_url}
            primaryColor={tenant.primary_color}
            secondaryColor={tenant.secondary_color}
          />
```

(c) Immediately AFTER the Branding `</Card>` (before the closing `</div>` of the page), add an Edit card and a Danger-zone card:
```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit organization</CardTitle>
        </CardHeader>
        <CardContent>
          <EditOrgForm
            tenantId={tenant.id}
            name={tenant.name}
            slug={tenant.slug}
            prefix={tenant.member_id_prefix}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tenant.status === "archived" ? (
            <>
              <p className="text-sm text-muted-foreground">
                This organization is archived — its workspace is offline and it&apos;s hidden from the
                list. Restore it to bring it back.
              </p>
              <form action={restoreTenant}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <SubmitButton size="sm" pendingText="…">
                  <ArchiveRestore />
                  Restore organization
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Archiving takes the organization offline and hides it from the list. No data is
                deleted; you can restore it anytime.
              </p>
              <form action={archiveTenant}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <SubmitButton size="sm" variant="destructive" pendingText="…">
                  <Archive />
                  Archive organization
                </SubmitButton>
              </form>
            </>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 2: List page — partition out archived**

In `app/platform/(console)/page.tsx`, replace the `PlatformPage` body's tenant handling. After `const tenants = await listTenantsWithStats();`, partition:
```tsx
  const active = tenants.filter((t) => t.status !== "archived");
  const archived = tenants.filter((t) => t.status === "archived");
  const totalMembers = active.reduce((n, t) => n + t.member_count, 0);
  const totalActive = active.reduce((n, t) => n + t.active_count, 0);
```
Change the `Organizations` stat and the main list to use `active`:
- `<Stat label="Organizations" value={active.length} tone="gold" />`
- the `tenants.length === 0 ? ... : tenants.map(...)` block → use `active` (both the empty check and the map).

Then, immediately AFTER the main list `</Card>` (still inside the left `<div className="space-y-6">`), add an archived section:
```tsx
        {archived.length > 0 && (
          <Card className="divide-y divide-border">
            <p className="px-3 pt-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Archived
            </p>
            {archived.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 p-3 opacity-70">
                <Building2 className="size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/platform/tenants/${t.id}`}
                    className="block truncate font-medium text-foreground hover:text-gold"
                  >
                    {t.name}
                  </Link>
                  <span className="tgp-mono text-xs text-muted-foreground">/{t.slug}</span>
                </div>
                <form action={restoreTenant}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <SubmitButton size="sm" variant="outline" pendingText="…">
                    <ArchiveRestore />
                    Restore
                  </SubmitButton>
                </form>
              </div>
            ))}
          </Card>
        )}
```
Add the needed imports at the top of the file:
```tsx
import { ArchiveRestore } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { restoreTenant } from "@/lib/actions/platform";
```
(Merge `ArchiveRestore` into the existing `lucide-react` import line: `import { Building2, Settings2, Users, ArchiveRestore } from "lucide-react";`.)

- [ ] **Step 3: Console header — sign out**

In `app/platform/(console)/layout.tsx`, add imports:
```tsx
import { LogOut } from "lucide-react";

import { signOut } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/submit-button";
```
Replace the header's right-side `<span>…Super Admin</span>` with a flex group containing it + a sign-out form:
```tsx
          <div className="flex items-center gap-3">
            <span className="tgp-eyebrow text-[10px] text-gold/70">Super Admin</span>
            <form action={signOut}>
              <SubmitButton size="sm" variant="ghost" pendingText="…">
                <LogOut />
                Sign out
              </SubmitButton>
            </form>
          </div>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes; routes `/platform`, `/platform/tenants/[id]`, `/platform/login` present.

- [ ] **Step 5: Commit**

```bash
git add "app/platform/(console)/tenants/[id]/page.tsx" "app/platform/(console)/page.tsx" "app/platform/(console)/layout.tsx"
git commit -m "feat(platform): edit/archive UI on tenant detail, archived list section, header sign-out"
```

---

### Task 7: Final verification (manual — user-run)

No code. After Tasks 1–6, hand the user the runbook.

- [ ] **Step 1: Static gates (you run)**

```bash
rm -rf .next && npx tsc --noEmit   # clean
npm run build                      # builds
```

- [ ] **Step 2: User applies `0016` + probe**

1. SQL Editor → paste `0016_platform_org_mgmt.sql` → Run. (If it rejects `ALTER TYPE … ADD VALUE` inside a transaction, run that one line alone first, then the bucket/policies.)
2. Paste `0016_platform_org_mgmt_checks.sql` → Run → expect four `OK:` + `ALL 0016 CHECKS PASSED`, ends in `ROLLBACK`.

- [ ] **Step 3: User runbook (`npm run dev`, as super admin at `/platform`)**
1. Open an org → **Edit organization**: change the name → saved; change the slug → warning shown, `/t/<new-slug>` works.
2. **Upload logo**: pick a PNG/SVG → it appears (preview + on the org's verify card / workspace); **Remove logo** → falls back to the monogram. Try a >2 MB or non-image file → friendly error.
3. **Archive organization** (Danger zone) → it leaves the main list into "Archived"; its `/t/<slug>` workspace → not-found.
4. From the list's **Archived** section (or the detail page) → **Restore** → back in the main list and reachable.
5. **Sign out** (header) → returns to `/platform/login`.
6. TGP + other orgs unaffected.

---

## Notes for the executor
- After all tasks: dispatch the final whole-implementation review, then use `superpowers:finishing-a-development-branch`. This lands on `feat/platform-login-redirect` alongside #7b Part A. **Do not merge** until the user applies `0016` + runs the probe + the runbook and confirms.
- Storage uploads use the anon/authed client — no service-role. They succeed because the `branding` bucket's write policies are gated on `is_platform_admin()`, and the uploader is a verified platform admin.
