# Two-Plane Hierarchy — Part A (Platform Plane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the platform plane from TGP — a neutral root landing + a dedicated super-admin login portal at `/platform/login` — so the SaaS stops wearing TGP's identity.

**Architecture:** Introduce a neutral `PLATFORM` brand and make every "platform default" fall back to it instead of `SITE` (=TGP). Restructure `/platform` so the auth guard lives in a `(console)` route group (URLs unchanged), leaving `/platform/login` ungated. The root page becomes a neutral platform landing that surfaces a "Platform console" link to platform admins.

**Tech Stack:** Next.js 16 App Router (route groups, `redirect`), TypeScript, Supabase (anon key), existing `Brandmark`/`AuthForm`/`AuthBrandHeader` components.

**Context for the implementer:**
- Spec: `docs/superpowers/specs/2026-06-15-two-plane-hierarchy-design.md` (Part A). This is the post-mega-spec sub-project #7b.
- Branch `feat/platform-login-redirect` already contains a `signIn` change (platform admins with default `next` → `/platform`). Build on that branch; do not revert it.
- No pure-logic units here (UI + routing). Gates per task are `npx tsc --noEmit` + `npm run build` + the manual runbook in the final task — matching how prior UI sub-projects in this repo are verified. Do not invent a test framework.
- `SITE` (in `lib/constants.ts`) stays — it's TGP's identity, used on TGP tenant surfaces. We only stop using it as the *platform* default.

---

## File Structure
- **New:** `app/platform/login/page.tsx` (ungated super-admin portal), `app/platform/(console)/layout.tsx` (moved guard+chrome).
- **Moved (git mv):** `app/platform/page.tsx` → `app/platform/(console)/page.tsx`; `app/platform/tenants/` → `app/platform/(console)/tenants/`; `app/platform/layout.tsx` → `app/platform/(console)/layout.tsx`.
- **Modified:** `lib/constants.ts` (`PLATFORM`), `lib/branding/brand.ts` (default → `PLATFORM`), `lib/platform.ts` (`isPlatformAdmin()` boolean + `requirePlatformAdmin` → `/platform/login`), `app/page.tsx` (neutral landing + console link).

---

### Task 1: Neutral `PLATFORM` brand constant

**Files:** Modify `lib/constants.ts`

- [ ] **Step 1: Add the constant**

In `lib/constants.ts`, immediately after the existing `export const SITE = {...} as const;` block, add:

```ts
/**
 * Neutral PLATFORM identity for the platform plane (root landing, /platform,
 * the super-admin portal). Distinct from SITE, which is TGP's tenant identity.
 */
export const PLATFORM = {
  name: "Organization Registry",
  tagline: "Multi-tenant membership platform",
  description:
    "A multi-tenant platform for organizations to issue digital member IDs, manage chapters, and verify membership instantly via NFC.",
} as const;
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(brand): add neutral PLATFORM identity constant"
```

---

### Task 2: Platform defaults → `PLATFORM` + `isPlatformAdmin()` helper

**Files:** Modify `lib/branding/brand.ts`, `lib/platform.ts`

- [ ] **Step 1: Point brand defaults at PLATFORM**

In `lib/branding/brand.ts`, replace the `SITE` import and both fallbacks. Change the import line:

```ts
import { SITE } from "@/lib/constants";
```
to
```ts
import { PLATFORM } from "@/lib/constants";
```

Then in `getBrand()` change the fallback return:
```ts
  return { name: SITE.name, logoUrl: null };
```
to
```ts
  return { name: PLATFORM.name, logoUrl: null };
```

And in `brandForSlug()` change the final return:
```ts
  return { brand: { name: SITE.name, logoUrl: null }, primary: null, secondary: null };
```
to
```ts
  return { brand: { name: PLATFORM.name, logoUrl: null }, primary: null, secondary: null };
```

- [ ] **Step 2: Add the `isPlatformAdmin()` boolean helper**

In `lib/platform.ts`, add this exported function right after the existing `requirePlatformAdmin` function (it reuses the already-imported `getSessionUser` and `createClient`):

```ts
/** Boolean platform-admin check (no redirect) — for conditional UI. */
export async function isPlatformAdmin(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return Boolean(data);
}
```

- [ ] **Step 3: Verify tsc**

Run: `npx tsc --noEmit` → clean (no "SITE is declared but never read" — confirm `SITE` is no longer imported in `brand.ts`).

- [ ] **Step 4: Commit**

```bash
git add lib/branding/brand.ts lib/platform.ts
git commit -m "feat(brand): platform default = PLATFORM; add isPlatformAdmin() helper"
```

---

### Task 3: Restructure `/platform` into a `(console)` group + redirect to the portal

**Files:** git mv 3 paths; modify `lib/platform.ts`

**Scene-setting:** `/platform` is guarded by `app/platform/layout.tsx` (`requirePlatformAdmin()` + console chrome). To add an *ungated* `/platform/login`, the guard must move into a `(console)` route group (route groups don't change URLs). After this, `/platform` and `/platform/tenants/[id]` still resolve identically, but `/platform/login` (added in Task 4) sits outside the guard.

- [ ] **Step 1: Create the group and move files**

```bash
mkdir -p "app/platform/(console)"
git mv app/platform/layout.tsx "app/platform/(console)/layout.tsx"
git mv app/platform/page.tsx "app/platform/(console)/page.tsx"
git mv app/platform/tenants "app/platform/(console)/tenants"
```

(The moved `(console)/layout.tsx` keeps `requirePlatformAdmin()` + the "Platform Console / Super Admin" chrome verbatim — no edit needed; its `<Link href="/platform">` still resolves.)

- [ ] **Step 2: Point the guard at the portal**

In `lib/platform.ts`, in `requirePlatformAdmin()`, change:
```ts
  if (!user) redirect("/login");
```
to
```ts
  if (!user) redirect("/platform/login");
```

- [ ] **Step 3: Verify build (routing change)**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes; the route table still lists `/platform` and `/platform/tenants/[id]` (route groups don't alter paths).

- [ ] **Step 4: Commit**

```bash
git add -A app/platform lib/platform.ts
git commit -m "refactor(platform): move guard into (console) group; guard → /platform/login"
```

---

### Task 4: The dedicated `/platform/login` portal

**Files:** Create `app/platform/login/page.tsx`

- [ ] **Step 1: Create the portal page**

Create `app/platform/login/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORM } from "@/lib/constants";
import { isPlatformAdmin } from "@/lib/platform";

export const metadata: Metadata = { title: "Administrator Sign In" };

export default async function PlatformLoginPage() {
  // Already a platform admin → straight to the console.
  if (await isPlatformAdmin()) redirect("/platform");

  return (
    <main className="relative isolate flex min-h-svh w-full flex-col items-center justify-center px-4 py-16">
      <AuthBrandHeader name={PLATFORM.name} logoUrl={null} />
      <Card className="mx-auto w-full max-w-md border-gold/30 tgp-frame tgp-glow">
        <CardHeader className="text-center">
          <p className="tgp-eyebrow text-[10px] text-gold/70">Super Admin</p>
          <CardTitle className="text-2xl">Administrator Sign In</CardTitle>
          <CardDescription>
            Access the platform console to manage organizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuthForm mode="login" next="/platform" />
        </CardContent>
      </Card>
    </main>
  );
}
```

(`AuthForm` posts `next="/platform"`; after a successful sign-in `signIn` redirects there, and `/platform`'s `requirePlatformAdmin()` lets admins in or sends a non-admin to `/forbidden`. `AuthBrandHeader` takes `{ name, logoUrl }` — confirmed by `app/(auth)/login/page.tsx`.)

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run build` → completes; route table now includes `/platform/login`.

- [ ] **Step 3: Commit**

```bash
git add "app/platform/login/page.tsx"
git commit -m "feat(platform): dedicated /platform/login super-admin portal"
```

---

### Task 5: Neutral root landing + Platform-console link

**Files:** Modify `app/page.tsx` (full rewrite)

**Scene-setting:** The root currently renders the TGP seal + "TAU GAMMA PHI" + `SITE`. Replace it with a neutral platform landing using `PLATFORM` + the existing `Brandmark` (neutral monogram). Keep the logged-in workspace-switcher, but (a) de-TGP its chrome and (b) show a "Platform console" card to platform admins (this is the discoverability fix). Platform admins are no longer auto-redirected into a single tenant.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `app/page.tsx` with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Nfc, ScanLine, ShieldCheck, Building2, ArrowRight } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PLATFORM } from "@/lib/constants";
import { getSessionUser, listMemberships } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";

const FEATURES = [
  {
    icon: Nfc,
    title: "NFC Verification",
    body: "Every member carries an NFC card that resolves to a live, official verification page on tap.",
  },
  {
    icon: ShieldCheck,
    title: "Digital Identity",
    body: "A tamper-resistant digital ID, issued and governed by each organization's administration.",
  },
  {
    icon: ScanLine,
    title: "Authoritative Registry",
    body: "A single source of truth for membership standing, secured end to end with row-level access control.",
  },
];

export default async function HomePage() {
  const user = await getSessionUser();

  if (user) {
    const [memberships, admin] = await Promise.all([
      listMemberships(),
      isPlatformAdmin(),
    ]);
    // Non-admins with exactly one workspace go straight in; admins stay to see
    // the console link.
    if (!admin && memberships.length === 1) {
      redirect(`/t/${memberships[0].tenant.slug}/dashboard`);
    }
    return (
      <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <Brandmark name={PLATFORM.name} logoUrl={null} className="mx-auto size-16 text-xl" />
            <h1 className="tgp-display mt-4 text-2xl font-bold">
              {memberships.length === 0 ? "No workspaces yet" : "Your workspaces"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {memberships.length === 0
                ? "You're signed in but not a member of any organization yet."
                : "Choose a workspace to continue."}
            </p>
          </div>

          {admin && (
            <Card className="mb-3 border-gold/40 p-0">
              <Link
                href="/platform"
                className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
              >
                <ShieldCheck className="size-5 text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">Platform console</span>
                  <span className="text-xs text-muted-foreground">Manage all organizations</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            </Card>
          )}

          {memberships.length > 0 && (
            <div className="space-y-2">
              {memberships.map(({ tenant, role }) => (
                <Card key={tenant.id} className="p-0">
                  <Link
                    href={`/t/${tenant.slug}/dashboard`}
                    className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
                  >
                    <Building2 className="size-5 text-gold" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{tenant.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">{role}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </Card>
              ))}
            </div>
          )}

          <div className="mt-6 text-center">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Switch account</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <Brandmark name={PLATFORM.name} logoUrl={null} className="size-24 text-3xl tgp-glow" />
        <p className="tgp-eyebrow mt-8 text-[11px] text-gold/80">{PLATFORM.tagline}</p>
        <h1 className="tgp-display tgp-gild mt-3 text-4xl font-black tracking-[0.06em] sm:text-5xl">
          {PLATFORM.name}
        </h1>
        <p className="mt-6 max-w-xl text-balance text-muted-foreground">
          {PLATFORM.description}
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/platform/login">Administrator sign-in</Link>
          </Button>
        </div>
        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-card/60 p-5 text-left"
              >
                <Icon className="size-5 text-gold" />
                <h2 className="tgp-display mt-3 text-sm font-semibold tracking-wide">
                  {feature.title}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
              </div>
            );
          })}
        </div>
      </div>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {PLATFORM.name}
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit` → clean (no unused `SITE`/`TgpSeal` imports remain in this file).
Run: `npm run build` → completes.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(platform): neutral root landing + platform-console link for admins"
```

---

### Task 6: Final verification (manual — user-run)

No code. After Tasks 1–5, hand the user this runbook.

- [ ] **Step 1: Static gates (you run)**

```bash
npx tsc --noEmit   # clean
npm run build      # builds; routes include /platform, /platform/login, /platform/tenants/[id]
```

- [ ] **Step 2: Manual runbook (user, `npm run dev`)**
1. **Logged out, visit `/`** → neutral "Organization Registry" landing (no TGP seal / no "TAU GAMMA PHI"); a single **"Administrator sign-in"** button → `/platform/login`.
2. **Visit `/platform` logged out** → redirected to **`/platform/login`** (not `/login`).
3. **Sign in at `/platform/login`** as the super admin (`jasonjay.ababao1968@gmail.com`) → lands on **`/platform`** console.
4. **Logged in, visit `/`** → workspace switcher shows a **"Platform console"** card (because you're a platform admin) + any workspaces; no auto-redirect away.
5. **A non-admin** signing in at `/platform/login` → bounced to `/forbidden`.
6. **TGP surfaces unchanged:** `/t/tgp/...` still shows TGP's name/branding (from its tenant row). `/login?tenant=tgp` still resolves and is TGP-branded.

---

## Notes for the executor
- This is Part A only. Tenant-scoped `/t/[slug]/login` + `/register`, custom-domain root → homepage, and homepage buttons are **Part B** (separate plan).
- After all tasks: dispatch the final whole-implementation review, then use `superpowers:finishing-a-development-branch`. The branch `feat/platform-login-redirect` already holds the `signIn` redirect + both specs; this Part A work lands on the same branch. **Merge only after the user runs the runbook and confirms.**
- Optional follow-up (operational, not code): set TGP's `tenants.logo_url` so TGP shows its seal on its own surfaces — a one-line SQL/console step, not part of this plan.
