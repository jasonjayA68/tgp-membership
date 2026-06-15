# Two-Plane Hierarchy — Part B (Tenant Entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every tenant a self-contained public entry — branded `/t/[slug]/login` + `/register` routes, a custom-domain root that lands on the org homepage, and homepage Sign-In / Apply buttons.

**Architecture:** Extract a shared `AuthScreen` server component from the existing `(auth)` pages, then reuse it for new tenant-scoped routes under `app/t/[tenant]/`. Middleware passes `/t/[slug]/login|register` through (like `id`/`home`) and, on a custom domain, rewrites root → the homepage and `login`/`register` → the branded `/t/[slug]` routes. No DB changes.

**Tech Stack:** Next.js 16 App Router (route groups, middleware rewrites), TypeScript, existing `AuthForm`/`RegisterForm`/`AuthBrandHeader`/`brandForSlug`.

**Context for the implementer:**
- Spec: `docs/superpowers/specs/2026-06-15-two-plane-hierarchy-design.md` (Part B). #7b Part A is already merged to `main`.
- Branch from `main`: `feat/tenant-entry`.
- No pure-logic units; gates are `npx tsc --noEmit` + `npm run build` + the manual runbook (final task), as with prior UI sub-projects.
- `brandForSlug(slug)` returns `{ brand: {name, logoUrl}, primary, secondary }` (tenant brand, or neutral PLATFORM default when slug is undefined/unknown). `tenantThemeStyle(primary, secondary)` → inline CSS-var style. `AuthForm` props `{ mode, next?, tenant? }`; `RegisterForm` props `{ tenant? }`. `getSessionUser()` from `@/lib/auth`.

---

## File Structure
- **New:** `components/auth/auth-screen.tsx` (shared screen), `app/t/[tenant]/login/page.tsx`, `app/t/[tenant]/register/page.tsx`.
- **Modified:** `app/(auth)/login/page.tsx` + `app/(auth)/register/page.tsx` (use `AuthScreen`), `lib/supabase/proxy.ts` (passthrough + host-mode), `app/t/[tenant]/home/page.tsx` (Sign-In + Apply buttons).

---

### Task 1: Shared `AuthScreen` + refactor the global auth pages

**Files:** Create `components/auth/auth-screen.tsx`; rewrite `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`.

- [ ] **Step 1: Create `components/auth/auth-screen.tsx`**

```tsx
import Link from "next/link";
import { CircleAlert } from "lucide-react";

import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { AuthForm } from "@/components/auth/auth-form";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { brandForSlug, tenantThemeStyle } from "@/lib/branding/brand";

/**
 * The shared auth screen (brand header + themed card + form + cross-link) used by
 * the global `(auth)` pages AND the tenant-scoped `/t/[slug]` routes. Server
 * component — resolves the tenant brand by slug (undefined slug = neutral
 * platform default).
 */
export async function AuthScreen({
  mode,
  tenant,
  next,
  error,
  loginHref,
  registerHref,
}: {
  mode: "login" | "register";
  tenant?: string;
  next?: string;
  error?: string;
  loginHref: string;
  registerHref: string;
}) {
  const { brand, primary, secondary } = await brandForSlug(tenant);
  const themeStyle = tenantThemeStyle(primary, secondary);
  const isLogin = mode === "login";

  return (
    <div style={themeStyle} className="relative isolate flex w-full flex-col items-center">
      <AuthBrandHeader name={brand.name} logoUrl={brand.logoUrl} />
      <Card
        className={`mx-auto w-full ${isLogin ? "max-w-md" : "max-w-2xl"} border-gold/30 tgp-frame tgp-glow`}
      >
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isLogin ? "Member Sign In" : "Apply for Membership"}
          </CardTitle>
          <CardDescription className={isLogin ? undefined : "mx-auto max-w-md"}>
            {isLogin
              ? tenant
                ? `Sign in to continue to ${brand.name}.`
                : "Access your membership portal and digital ID."
              : "Submit your registration. An administrator will review and approve your membership before your digital ID is issued."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLogin && error === "confirm" && (
            <Alert variant="danger">
              <CircleAlert />
              <span>
                That confirmation link is invalid or expired. Sign in or request a new one.
              </span>
            </Alert>
          )}
          {isLogin ? (
            <AuthForm mode="login" next={next} tenant={tenant} />
          ) : (
            <RegisterForm tenant={tenant} />
          )}
        </CardContent>
        <CardFooter className="justify-center border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            {isLogin ? "No account yet? " : "Already a member? "}
            <Link
              href={isLogin ? registerHref : loginHref}
              className="font-medium text-gold underline-offset-4 hover:underline"
            >
              {isLogin ? "Register" : "Sign in"}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `app/(auth)/login/page.tsx`** to use it

```tsx
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; tenant?: string }>;
}) {
  const { next, error, tenant } = await searchParams;
  const t = typeof tenant === "string" ? tenant : undefined;
  return (
    <AuthScreen
      mode="login"
      tenant={t}
      next={typeof next === "string" ? next : undefined}
      error={typeof error === "string" ? error : undefined}
      loginHref={t ? `/login?tenant=${encodeURIComponent(t)}` : "/login"}
      registerHref={t ? `/register?tenant=${encodeURIComponent(t)}` : "/register"}
    />
  );
}
```

- [ ] **Step 3: Rewrite `app/(auth)/register/page.tsx`** to use it

```tsx
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant } = await searchParams;
  const t = typeof tenant === "string" ? tenant : undefined;
  return (
    <AuthScreen
      mode="register"
      tenant={t}
      loginHref={t ? `/login?tenant=${encodeURIComponent(t)}` : "/login"}
      registerHref={t ? `/register?tenant=${encodeURIComponent(t)}` : "/register"}
    />
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes. (The `(auth)` layout still wraps these pages with the centered `<main>`.)

- [ ] **Step 5: Commit**

```bash
git add components/auth/auth-screen.tsx "app/(auth)/login/page.tsx" "app/(auth)/register/page.tsx"
git commit -m "feat(auth): shared AuthScreen; global login/register use it"
```

---

### Task 2: Tenant-scoped `/t/[tenant]/login` + `/register` routes

**Files:** Create `app/t/[tenant]/login/page.tsx`, `app/t/[tenant]/register/page.tsx`.

**Scene-setting:** These live under `app/t/[tenant]/` (outside the `(auth)` group), so they get only the root layout — they must provide their own centered `<main>` wrapper (same classes the `(auth)` layout uses). They reuse `AuthScreen` with the slug from the route param, and redirect an already-signed-in user to the dashboard.

- [ ] **Step 1: Create `app/t/[tenant]/login/page.tsx`**

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function TenantLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { tenant } = await params;
  const { next, error } = await searchParams;
  const dest = typeof next === "string" ? next : `/t/${tenant}/dashboard`;

  // Already signed in → go straight to the destination.
  if (await getSessionUser()) redirect(dest);

  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      <AuthScreen
        mode="login"
        tenant={tenant}
        next={dest}
        error={typeof error === "string" ? error : undefined}
        loginHref={`/t/${tenant}/login`}
        registerHref={`/t/${tenant}/register`}
      />
    </main>
  );
}
```

- [ ] **Step 2: Create `app/t/[tenant]/register/page.tsx`**

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Register" };

export default async function TenantRegisterPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  if (await getSessionUser()) redirect(`/t/${tenant}/dashboard`);

  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      <AuthScreen
        mode="register"
        tenant={tenant}
        loginHref={`/t/${tenant}/login`}
        registerHref={`/t/${tenant}/register`}
      />
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes; routes `/t/[tenant]/login` + `/t/[tenant]/register` present.
(Note: these won't render correctly until Task 3 lets middleware pass them through — visiting `/t/tgp/login` before Task 3 redirects to the global login. That's expected; verify in the runbook after Task 3.)

- [ ] **Step 4: Commit**

```bash
git add "app/t/[tenant]/login/page.tsx" "app/t/[tenant]/register/page.tsx"
git commit -m "feat(tenant): branded /t/[slug]/login + /register routes"
```

---

### Task 3: Middleware — passthrough + custom-domain entry

**Files:** Modify `lib/supabase/proxy.ts` (the `/t` branch passthrough ~line 152, and the host-mode branch ~lines 106-117).

- [ ] **Step 1: Pass `login`/`register` through in the `/t` branch**

In `lib/supabase/proxy.ts`, find (in the `// ---- Tenant-scoped routes: /t/[slug]/<rest>` branch):
```ts
    // Public per-tenant verification + homepage (/t/[slug]/id|home/...) are
    // anonymous — strip any spoofed tenant headers and route straight through
    // (no auth gate).
    if (segs[2] === "id" || segs[2] === "home") {
```
Change that condition to also pass through login/register:
```ts
    // Public per-tenant verification, homepage, and the branded login/register
    // routes are anonymous — strip any spoofed tenant headers and route straight
    // through (no auth gate).
    if (
      segs[2] === "id" ||
      segs[2] === "home" ||
      segs[2] === "login" ||
      segs[2] === "register"
    ) {
```
(Leave the body — the header-stripping passthrough — unchanged.)

- [ ] **Step 2: Custom-domain root → homepage + login/register → branded routes**

In the host-mode branch, replace this block:
```ts
    // Global auth routes render same-origin on the custom domain (no tenant gate,
    // no rewrite into the /t tree) — otherwise the logged-out redirect below
    // would target /login and loop forever.
    if (seg0 === "login" || seg0 === "register" || seg0 === "auth") {
      return rewrite(relPath, request, response, clean);
    }

    // Public per-tenant verification + homepage are anonymous. Their real routes
    // live under app/t/[tenant]/..., so rewrite to the /t/<slug> path.
    if (seg0 === "id" || seg0 === "home") {
      return rewrite(`/t/${tenant.slug}${relPath}`, request, response, clean);
    }
```
with:
```ts
    // Custom-domain root → the tenant's public homepage (the front door).
    if (relPath === "/") {
      return rewrite(`/t/${tenant.slug}/home`, request, response, clean);
    }

    // Tenant-scoped public routes (login, register, id, home) render their branded
    // /t/[tenant] routes. These are anonymous — no auth gate, no loop.
    if (
      seg0 === "login" ||
      seg0 === "register" ||
      seg0 === "id" ||
      seg0 === "home"
    ) {
      return rewrite(`/t/${tenant.slug}${relPath}`, request, response, clean);
    }

    // The Supabase auth callback stays a global route.
    if (seg0 === "auth") {
      return rewrite(relPath, request, response, clean);
    }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/proxy.ts
git commit -m "feat(middleware): /t login/register passthrough; custom-domain root→home + branded auth"
```

---

### Task 4: Homepage Sign-In + Apply buttons

**Files:** Modify `app/t/[tenant]/home/page.tsx`

- [ ] **Step 1: Replace the header's single Sign-in button with Sign-In + Apply**

In `app/t/[tenant]/home/page.tsx`, find the header's button:
```tsx
          <Button asChild size="sm" variant="outline">
            <Link href={`/login?tenant=${home.tenant_slug}`}>Sign in</Link>
          </Button>
```
Replace it with a two-button group pointing at the tenant-scoped routes:
```tsx
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/t/${home.tenant_slug}/login`}>Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/t/${home.tenant_slug}/register`}>Apply for membership</Link>
            </Button>
          </div>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes.

- [ ] **Step 3: Commit**

```bash
git add "app/t/[tenant]/home/page.tsx"
git commit -m "feat(homepage): Sign-In + Apply buttons → tenant-scoped auth routes"
```

---

### Task 5: Final verification (manual — user-run)

No code. After Tasks 1–4, hand the user the runbook.

- [ ] **Step 1: Static gates (you run)**

```bash
rm -rf .next && npx tsc --noEmit   # clean
npm run build                      # builds; routes /t/[tenant]/login + /register present
```

- [ ] **Step 2: Manual runbook (`npm run dev`)**
1. **Path mode:** visit `/t/tgp/login` → TGP-branded sign-in (logo/colors), no redirect loop; the "Register" link → `/t/tgp/register`; signing in → `/t/tgp/dashboard`.
2. `/t/tgp/register` → TGP-branded apply form; "Sign in" link → `/t/tgp/login`.
3. **Homepage front door:** `/t/tgp/home` → header shows **Sign in** (→ `/t/tgp/login`) + **Apply for membership** (→ `/t/tgp/register`).
4. **Already signed in:** while logged in, visit `/t/tgp/login` → redirected straight to `/t/tgp/dashboard`.
5. **Global pages still work:** `/login` and `/login?tenant=tgp` render (neutral vs TGP-branded); `/register` works.
6. **Custom domain** (if you have one verified): `https://<domain>/` → the org homepage (not the dashboard); `https://<domain>/login` → that tenant's *branded* login; `https://<domain>/register` → branded apply; `https://<domain>/id/<card>` → verify card. All themed for that tenant.

---

## Notes for the executor
- This is Part B; #7a (invite-only lockdown) is the next sub-project and will convert the `/register` routes into invite-claim — the "Apply for membership" button already points at the right place.
- After all tasks: dispatch the final whole-implementation review, then use `superpowers:finishing-a-development-branch`. No migration in Part B, so the only manual gate is the runbook. **Do not merge** until the user runs the runbook and confirms.
