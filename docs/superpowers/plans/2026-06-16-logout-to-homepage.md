# Logout to Organization Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign-out lands a member on their organization's homepage (where they can sign back in), while the super admin still lands on `/platform/login`.

**Architecture:** `signOut` becomes destination-aware — it reads a sanitized `redirectTo` from the form (open-redirect-guarded), defaulting to `/login`. The member nav passes the tenant homepage; the platform console passes `/platform/login`.

**Tech Stack:** Next.js 16 server actions (FormData), TypeScript, existing `tenantHref`.

**Context for the implementer:**
- Spec: `docs/superpowers/specs/2026-06-16-logout-to-homepage-design.md`. Follows #7b Part B (merged).
- Branch from `main`: `feat/logout-homepage`.
- No DB changes, no pure-logic units; gates are `npx tsc --noEmit` + `npm run build` + the manual runbook (Task 2).
- `signOut` is called from exactly two places — `components/app/app-nav.tsx` and `app/platform/(console)/layout.tsx` — both via `<form action={signOut}>`, so changing its signature to take `FormData` is safe (the form supplies it).
- `AppNav` already receives `basePath: string` and imports `tenantHref` from `@/lib/tenant/links`. `tenantHref(basePath, "/home")` → `/t/<slug>/home` (path mode) or `/home` (custom domain → host-mode → homepage).

---

### Task 1: Destination-aware sign-out

**Files:** Modify `lib/actions/auth.ts` (the `signOut` function), `components/app/app-nav.tsx`, `app/platform/(console)/layout.tsx`.

- [ ] **Step 1: Make `signOut` read a sanitized `redirectTo`**

In `lib/actions/auth.ts`, replace the entire `signOut` function:
```ts
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```
with:
```ts
export async function signOut(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Destination-aware: members → their org homepage, super admins → /platform/login.
  // Only accept an internal, non-protocol-relative path (open-redirect guard).
  const raw = formData.get("redirectTo");
  const dest =
    typeof raw === "string" &&
    raw.startsWith("/") &&
    !raw.startsWith("//") &&
    !raw.startsWith("/\\")
      ? raw
      : "/login";
  redirect(dest);
}
```

- [ ] **Step 2: Member nav passes the org homepage**

In `components/app/app-nav.tsx`, find the sign-out form:
```tsx
          <form action={signOut}>
            <Button type="submit" size="sm" variant="ghost">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
```
Add the hidden field as the form's first child:
```tsx
          <form action={signOut}>
            <input type="hidden" name="redirectTo" value={tenantHref(basePath, "/home")} />
            <Button type="submit" size="sm" variant="ghost">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
```
(`tenantHref` and `basePath` are already imported/in scope in this file.)

- [ ] **Step 3: Platform console passes the platform login**

In `app/platform/(console)/layout.tsx`, find the sign-out form:
```tsx
            <form action={signOut}>
              <SubmitButton size="sm" variant="ghost" pendingText="…">
                <LogOut />
                Sign out
              </SubmitButton>
            </form>
```
Add the hidden field as the form's first child:
```tsx
            <form action={signOut}>
              <input type="hidden" name="redirectTo" value="/platform/login" />
              <SubmitButton size="sm" variant="ghost" pendingText="…">
                <LogOut />
                Sign out
              </SubmitButton>
            </form>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean. (Confirm there are no OTHER callers of `signOut` that would break on the new `FormData` param — `grep -rn "signOut" components app lib | grep -v node_modules` should show only the two `<form action={signOut}>` sites + the definition.)
Run: `npm run build` → completes.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/auth.ts components/app/app-nav.tsx "app/platform/(console)/layout.tsx"
git commit -m "feat(auth): sign-out returns members to their org homepage (super admins → /platform/login)"
```

---

### Task 2: Final verification (manual — user-run)

No code.

- [ ] **Step 1: Static gates (you run)**

```bash
rm -rf .next && npx tsc --noEmit   # clean
npm run build                      # builds
```

- [ ] **Step 2: Manual runbook (`npm run dev`)**
1. Sign in as a **TGP member** → at `/t/tgp/dashboard`, click **Sign out** → lands on **`/t/tgp/home`** (the org homepage, with Sign in / Apply buttons); signing in again works.
2. Sign in as the **super admin** → in the `/platform` console, click **Sign out** → lands on **`/platform/login`**.
3. (If you have a verified custom domain) a member on `https://<domain>/...` → Sign out → `https://<domain>/` homepage.

---

## Notes for the executor
- After the task: dispatch the final review, then use `superpowers:finishing-a-development-branch`. No migration, so the runbook is the only manual gate. **Do not merge** until the user runs the runbook and confirms.
