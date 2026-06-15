# Per-Tenant Branding & Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each tenant's `logo_url` + `primary_color` + `secondary_color` actually theme their workspace, verify card, and `?tenant` auth pages — via a contrast-safe two-color theme generator and a tenant brand identity that replaces the hardcoded `SITE`/`TgpSeal`.

**Architecture:** A pure, Node-testable `buildTenantTheme(primary, secondary)` generates a contrast-safe CSS-variable map (surface from secondary, accent from primary, foregrounds auto-derived by luminance). The vars are applied as a scoped inline `style` on each tenant-surface wrapper, re-tinting all existing `text-gold`/`bg-background` classes with zero per-component edits. A `getBrand()`/`Brandmark` pair replaces hardcoded TGP identity on tenant surfaces. Migration `0011` extends `get_member_card` so the anon verify card can theme.

**Tech Stack:** Next.js 16 (App Router), Tailwind v4 (`@theme inline` CSS vars), Supabase, TypeScript. Node 24 runs the generator's `.mts` test directly (type-stripping).

---

## Environment & tooling notes (read first)

- **The theme generator is a pure function and IS unit-tested** via a `.mts` script run with `node` (Node 24 strips types: `node lib/branding/theme.check.mts` works with no flags — verified). Everything else is verified via `npx tsc --noEmit`, `npm run build`, and a manual runbook (Task 9). Migration `0011` is applied manually in the Supabase SQL Editor.
- Run all commands from repo root: `/Users/jasonjayababao/tgp-membership`. The executor (subagent-driven skill) creates a feature branch first.
- The theme tokens come from `app/globals.css` `:root` (the default gold/black palette — `--background:#050505`, `--foreground:#f5f1e6`, `--gold:#e9b82e`, etc.). The generator's job is to produce the same SHAPE of tokens from a tenant's two colors. When a tenant has NO colors, the generator returns `{}` and the `:root` defaults apply unchanged.
- `resolve_tenant_by_slug` (and thus `getActiveTenant()` → `ResolvedTenant`) ALREADY returns `primary_color`/`secondary_color`/`logo_url`, so the workspace needs no DB change; only the verify card (via `get_member_card`) does.

## File structure

- **New:** `lib/branding/theme.ts` (pure color lib + `buildTenantTheme`), `lib/branding/theme.check.mts` (Node test), `lib/branding/brand.ts` (`getBrand`, `tenantThemeStyle`), `components/brand/brandmark.tsx`, `components/auth/auth-brand-header.tsx`, `supabase/migrations/0011_member_card_branding.sql`, `supabase/tests/0011_branding_checks.sql`.
- **Modify:** `tsconfig.json` (exclude the `.mts` test), `lib/types.ts` (`MemberCard` + RPC return), `app/(app)/layout.tsx`, `components/app/app-nav.tsx`, `components/brand/wordmark.tsx`, `components/id-card.tsx` + its two builders (`app/(app)/dashboard/page.tsx`, `app/(app)/admin/members/[id]/page.tsx`), `app/t/[tenant]/id/[slug]/page.tsx`, `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`, `components/platform/branding-form.tsx`.

---

## Task 1: Contrast-safe theme generator (with a real test)

**Files:**
- Create: `lib/branding/theme.ts`
- Create: `lib/branding/theme.check.mts`
- Modify: `tsconfig.json` (exclude the test script)

- [ ] **Step 0: Exclude the test script from `tsc`**

The check imports `./theme.ts` with an explicit `.ts` extension (Node ESM requires it). `tsconfig.json` globs `**/*.mts`, and `tsc` would reject that extension (no `allowImportingTsExtensions`). The script is run by Node, not type-checked by the app's `tsc`, so exclude it. In `tsconfig.json`, change the `"exclude"` array to:

```json
  "exclude": ["node_modules", "lib/branding/theme.check.mts"]
```

- [ ] **Step 1: Write the failing test**

Create `lib/branding/theme.check.mts`:

```ts
import { buildTenantTheme } from "./theme.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// Both colors null → empty map → default :root theme applies.
assert(Object.keys(buildTenantTheme(null, null)).length === 0, "null/null must be empty");

// A LIGHT surface must get a DARK foreground (the near-black constant).
const light = buildTenantTheme("#2563eb", "#f5f5f5");
assert(light["--background"] === "#f5f5f5", "background = secondary");
assert(light["--foreground"] === "#0a0a08", "light surface → near-black fg (got " + light["--foreground"] + ")");

// A DARK surface must get a LIGHT foreground (the near-white constant).
const dark = buildTenantTheme("#2563eb", "#101010");
assert(dark["--foreground"] === "#f5f1e6", "dark surface → near-white fg (got " + dark["--foreground"] + ")");

// Accent maps from primary; a full token set is produced.
assert(light["--gold"] === "#2563eb", "--gold = primary accent");
assert(typeof light["--gold-bright"] === "string" && light["--gold-bright"] !== light["--gold"], "derived bright shade");

// Only-primary or only-secondary still produces a themed map (not empty).
assert(Object.keys(buildTenantTheme("#2563eb", null)).length > 0, "primary-only themes");

console.log("OK: theme generator checks pass");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node lib/branding/theme.check.mts`
Expected: FAIL — `Cannot find module './theme.ts'` (the generator doesn't exist yet).

- [ ] **Step 3: Implement `lib/branding/theme.ts`**

```ts
/**
 * Pure, dependency-free two-color theme generator. Given a tenant's primary
 * (accent) and secondary (surface) colors, produces a contrast-safe map of
 * CSS custom properties matching the app's token shape (see app/globals.css).
 * Both null → {} (the default :root palette applies). Node-testable (no React).
 */

type RGB = { r: number; g: number; b: number };

const DEFAULT_PRIMARY = "#e9b82e"; // app's gold
const DEFAULT_SECONDARY = "#050505"; // app's near-black
const NEAR_WHITE: RGB = { r: 245, g: 241, b: 230 }; // matches --foreground
const NEAR_BLACK: RGB = { r: 10, g: 10, b: 8 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** WCAG relative luminance. */
function relLum({ r, g, b }: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const la = relLum(a);
  const lb = relLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of near-white / near-black contrasts better on `bg`. */
function readableOn(bg: RGB): RGB {
  return contrast(NEAR_WHITE, bg) >= contrast(NEAR_BLACK, bg) ? NEAR_WHITE : NEAR_BLACK;
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };

export type ThemeVars = Record<string, string>;

export function buildTenantTheme(
  primary: string | null,
  secondary: string | null,
): ThemeVars {
  if (!primary && !secondary) return {};

  const acc = parseHex(primary ?? DEFAULT_PRIMARY) ?? parseHex(DEFAULT_PRIMARY)!;
  const surf = parseHex(secondary ?? DEFAULT_SECONDARY) ?? parseHex(DEFAULT_SECONDARY)!;
  const fg = readableOn(surf);
  const onAcc = readableOn(acc);

  const card = mix(surf, fg, 0.06);
  const border = mix(surf, fg, 0.16);

  return {
    "--background": toHex(surf),
    "--foreground": toHex(fg),
    "--card": toHex(card),
    "--card-foreground": toHex(fg),
    "--popover": toHex(card),
    "--popover-foreground": toHex(fg),
    "--secondary": toHex(mix(surf, fg, 0.08)),
    "--secondary-foreground": toHex(fg),
    "--muted": toHex(mix(surf, fg, 0.04)),
    "--muted-foreground": toHex(mix(fg, surf, 0.35)),
    "--accent": toHex(mix(surf, acc, 0.15)),
    "--accent-foreground": toHex(acc),
    "--border": toHex(border),
    "--input": toHex(border),
    "--ring": toHex(acc),
    "--primary": toHex(acc),
    "--primary-foreground": toHex(onAcc),
    "--gold": toHex(acc),
    "--gold-bright": toHex(mix(acc, WHITE, 0.2)),
    "--gold-soft": toHex(mix(acc, fg, 0.45)),
    "--gold-deep": toHex(mix(acc, BLACK, 0.4)),
    "--ink": toHex(surf),
    "--sidebar": toHex(mix(surf, fg, 0.02)),
    "--sidebar-foreground": toHex(fg),
    "--sidebar-primary": toHex(acc),
    "--sidebar-primary-foreground": toHex(onAcc),
    "--sidebar-accent": toHex(mix(surf, acc, 0.15)),
    "--sidebar-accent-foreground": toHex(acc),
    "--sidebar-border": toHex(border),
    "--sidebar-ring": toHex(acc),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node lib/branding/theme.check.mts`
Expected: `OK: theme generator checks pass`

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean — the `.mts` is excluded, so no extension error).

```bash
git add lib/branding/theme.ts lib/branding/theme.check.mts tsconfig.json
git commit -m "feat(branding): contrast-safe two-color theme generator (+ node test)"
```

---

## Task 2: Brand helpers + Brandmark

**Files:**
- Create: `lib/branding/brand.ts`
- Create: `components/brand/brandmark.tsx`

- [ ] **Step 1: Create `lib/branding/brand.ts`**

```ts
import "server-only";

import type { CSSProperties } from "react";

import { buildTenantTheme } from "@/lib/branding/theme";
import { SITE } from "@/lib/constants";
import { getActiveTenant } from "@/lib/tenant/context";

export type Brand = { name: string; logoUrl: string | null };

/** The active tenant's brand on tenant surfaces; the platform default elsewhere. */
export async function getBrand(): Promise<Brand> {
  const tenant = await getActiveTenant();
  if (tenant) return { name: tenant.name, logoUrl: tenant.logo_url };
  return { name: SITE.name, logoUrl: null };
}

/** Inline `style` of CSS-variable overrides for a tenant's colors ({} = default). */
export function tenantThemeStyle(
  primary: string | null,
  secondary: string | null,
): CSSProperties {
  return buildTenantTheme(primary, secondary) as CSSProperties;
}
```

- [ ] **Step 2: Create `components/brand/brandmark.tsx`**

```tsx
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((w) => w[0]).join("").toUpperCase() || "•";
}

/** Tenant logo image if set, else an accent-tinted initials monogram. */
export function Brandmark({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt=""
        className={cn("rounded-full object-cover ring-1 ring-gold/40", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "tgp-display inline-flex items-center justify-center rounded-full bg-ink font-bold text-gold ring-1 ring-gold/40",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add lib/branding/brand.ts components/brand/brandmark.tsx
git commit -m "feat(branding): getBrand/tenantThemeStyle helpers + Brandmark component"
```

---

## Task 3: Migration `0011` — verify-card colors

**Files:**
- Create: `supabase/tests/0011_branding_checks.sql`
- Create: `supabase/migrations/0011_member_card_branding.sql`
- Modify: `lib/types.ts`

- [ ] **Step 1: Write the probe (fails before migration)**

Create `supabase/tests/0011_branding_checks.sql`:

```sql
-- Run in the Supabase SQL Editor AFTER applying 0011. Transactional; rolls back.
begin;

-- Give TGP colors + a throwaway card, then confirm get_member_card returns them.
update public.tenants
   set primary_color = '#2563eb', secondary_color = '#f5f5f5'
 where slug = 'tgp';

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777',
        'authenticated','authenticated','probe-brand@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb, false);

insert into public.nfc_cards (tenant_id, profile_id, slug)
select tenant_id, id, 'probe-card-0011'
from public.profiles where user_id = '77777777-7777-7777-7777-777777777777';

do $$
declare r record;
begin
  select * into r from public.get_member_card('probe-card-0011');
  if r.tenant_primary_color is distinct from '#2563eb' then
    raise exception 'FAIL: primary not returned (%)', r.tenant_primary_color; end if;
  if r.tenant_secondary_color is distinct from '#f5f5f5' then
    raise exception 'FAIL: secondary not returned (%)', r.tenant_secondary_color; end if;
  raise notice 'OK: get_member_card returns tenant branding colors';
end $$;

rollback;
```

- [ ] **Step 2: Confirm it fails today**

Paste into the SQL Editor, Run. Expected: **FAIL** — `column "tenant_primary_color" does not exist`. Record that it errored.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0011_member_card_branding.sql`. This re-declares the `0009` `get_member_card` verbatim PLUS two new returned columns (`tenant_primary_color`, `tenant_secondary_color`) sourced from `t.primary_color`/`t.secondary_color`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0011: verify-card branding colors
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0009/0010. Re-declares get_member_card (still a pure read) to
-- also return the tenant's primary/secondary colors, so the anon verify card
-- can theme from one call.
-- =============================================================================

drop function if exists public.get_member_card(text) cascade;

create or replace function public.get_member_card(card_slug text)
returns table (
  full_name             text,
  member_id             text,
  batch_year            int,
  status                public.member_status,
  photo_url             text,
  chapter               text,
  district              text,
  region                text,
  card_active           boolean,
  verify_contact_name   text,
  verify_contact_number text,
  tenant_name           text,
  tenant_slug           text,
  tenant_logo_url       text,
  tenant_primary_color  text,
  tenant_secondary_color text,
  public_fields         jsonb
)
language sql stable security definer set search_path = public as $$
  select p.full_name,
         p.member_id,
         p.batch_year,
         p.status,
         p.photo_url,
         c.name,
         c.district,
         c.region,
         n.active,
         coalesce(chap_officer.full_name, dist_officer.full_name),
         coalesce(nullif(chap_officer.custom_fields ->> 'contact_number', ''),
                  nullif(dist_officer.custom_fields ->> 'contact_number', '')),
         t.name,
         t.slug,
         t.logo_url,
         t.primary_color,
         t.secondary_color,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object('key', s.key, 'label', s.label,
                                       'type', s.type, 'value', p.custom_fields ->> s.key)
                    order by s.sort_order)
           from public.tenant_field_schema s
           where s.tenant_id = p.tenant_id and s.is_public
             and nullif(p.custom_fields ->> s.key, '') is not null
         ), '[]'::jsonb)
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  join public.tenants   t on t.id = p.tenant_id
  left join public.chapters c on c.id = p.chapter_id
  left join public.profiles chap_officer
         on chap_officer.id = c.verify_officer_id
        and nullif(chap_officer.custom_fields ->> 'contact_number', '') is not null
  left join public.district_officers d_off
         on d_off.tenant_id = p.tenant_id and d_off.district = c.district
  left join public.profiles dist_officer
         on dist_officer.id = d_off.officer_id
        and nullif(dist_officer.custom_fields ->> 'contact_number', '') is not null
  where n.slug = card_slug;
$$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;
```

- [ ] **Step 4: Update `MemberCard` in `lib/types.ts`**

In the `MemberCard` type, add the two fields after `tenant_logo_url`:

```ts
  tenant_logo_url: string | null;
  tenant_primary_color: string | null;
  tenant_secondary_color: string | null;
```

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add supabase/tests/0011_branding_checks.sql supabase/migrations/0011_member_card_branding.sql lib/types.ts
git commit -m "feat(db): 0011 — get_member_card returns tenant branding colors"
```

---

## Task 4: Theme + brand the workspace

**Files:**
- Modify: `app/(app)/layout.tsx`
- Modify: `components/app/app-nav.tsx`
- Modify: `components/brand/wordmark.tsx`

- [ ] **Step 1: `app/(app)/layout.tsx` — inject theme + pass brand**

Add imports:

```tsx
import { tenantThemeStyle } from "@/lib/branding/brand";
```

The layout already destructures `{ role, tenant }` from `requireUser()` and computes `basePath`. After computing `basePath`, build the theme and apply it to the root wrapper, and pass a `brand` prop to `AppNav`:

```tsx
  const basePath = await getActiveTenantBasePath();
  const themeStyle = tenantThemeStyle(tenant.primary_color, tenant.secondary_color);

  return (
    <div style={themeStyle} className="flex min-h-svh flex-col bg-background">
      <AppNav
        basePath={basePath}
        isAdmin={isTenantAdminRole(role)}
        brand={{ name: tenant.name, logoUrl: tenant.logo_url }}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {tenant.name}
      </footer>
    </div>
  );
```

(The footer's hardcoded `SITE.legalName · …` becomes the tenant name; remove the now-unused `SITE` import if it's no longer referenced in this file.)

- [ ] **Step 2: `components/app/app-nav.tsx` — accept + render brand**

Add a `brand` prop and pass it to `Wordmark`. Change the component signature:

```tsx
export function AppNav({
  basePath,
  isAdmin,
  brand,
}: {
  basePath: string;
  isAdmin: boolean;
  brand: { name: string; logoUrl: string | null };
}) {
```

And the brand link (currently `<Wordmark showRegistry={false} sealClassName="size-9" />`):

```tsx
        <Link href={tenantHref(basePath, "/dashboard")} aria-label={`${brand.name} home`}>
          <Wordmark name={brand.name} logoUrl={brand.logoUrl} showRegistry={false} sealClassName="size-9" />
        </Link>
```

- [ ] **Step 3: `components/brand/wordmark.tsx` — tenant brand**

Replace the file with a brand-driven version (uses `Brandmark` + the tenant name):

```tsx
import { Brandmark } from "@/components/brand/brandmark";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Wordmark({
  name,
  logoUrl,
  className,
  sealClassName,
  showRegistry = true,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
  sealClassName?: string;
  showRegistry?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Brandmark name={name} logoUrl={logoUrl} className={cn("size-10", sealClassName)} />
      <div className="leading-tight">
        <div className="tgp-display text-sm font-bold tracking-[0.18em] text-foreground">
          {name}
        </div>
        {showRegistry && (
          <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">
            {SITE.registry}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Find + fix any other `Wordmark` callers**

Run: `grep -rns "<Wordmark" app components`
For every caller, ensure it passes `name` + `logoUrl`. (The known caller is `app-nav.tsx`, fixed above. If any other caller exists on a tenant surface, pass the tenant brand; on a global surface, pass `name={SITE.name} logoUrl={null}`.)

- [ ] **Step 5: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add "app/(app)/layout.tsx" components/app/app-nav.tsx components/brand/wordmark.tsx
git commit -m "feat(branding): theme + brand the workspace (nav, footer)"
```

---

## Task 5: Brand the dashboard ID-card preview

**Files:**
- Modify: `components/id-card.tsx`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/admin/members/[id]/page.tsx`

- [ ] **Step 1: `components/id-card.tsx` — add brand to `IdCardData`, use Brandmark**

Add two fields to the `IdCardData` type (alongside `fullName` etc.):

```ts
  orgName: string;
  orgLogoUrl: string | null;
```

Replace the import of `TgpSeal` with `Brandmark`:

```ts
import { Brandmark } from "@/components/brand/brandmark";
```

Replace each `<TgpSeal className="size-8" />` / `<TgpSeal ... />` usage with:

```tsx
<Brandmark name={data.orgName} logoUrl={data.orgLogoUrl} className="size-8" />
```

(match the original `className` size on each occurrence). Replace the hardcoded `TAU GAMMA PHI` header text with `{data.orgName}`, and replace the `{SITE.motto}` line with `{data.orgName}` (or remove that line — tenants have no motto). Remove the now-unused `SITE`/`TgpSeal` imports.

- [ ] **Step 2: `app/(app)/dashboard/page.tsx` — pass brand into `cardData`**

The dashboard has `auth.tenant`. In the `cardData: IdCardData = {...}` object, add:

```tsx
    orgName: tenant.name,
    orgLogoUrl: tenant.logo_url,
```

(ensure `tenant` is destructured from `auth` — it already is for the verify URL in Sub-project #3).

- [ ] **Step 3: `app/(app)/admin/members/[id]/page.tsx` — pass brand into `cardData`**

This page has `auth` from `requireTenantAdmin()`. In its `cardData: IdCardData = {...}`, add:

```tsx
    orgName: auth.tenant.name,
    orgLogoUrl: auth.tenant.logo_url,
```

- [ ] **Step 4: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add components/id-card.tsx "app/(app)/dashboard/page.tsx" "app/(app)/admin/members/[id]/page.tsx"
git commit -m "feat(branding): tenant brand on the dashboard ID-card preview"
```

---

## Task 6: Theme + brand the verify card

**Files:**
- Modify: `app/t/[tenant]/id/[slug]/page.tsx`

- [ ] **Step 1: Inject the theme + use Brandmark**

Add imports:

```tsx
import { Brandmark } from "@/components/brand/brandmark";
import { tenantThemeStyle } from "@/lib/branding/brand";
```

In `PageShell`, accept and apply a theme style so the whole card surface re-tints. Change `PageShell` to:

```tsx
function PageShell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <main
      style={style}
      className="relative flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10"
    >
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
        Official digital membership verification record.
      </p>
    </main>
  );
}
```

In the page component, after `record_card_scan`, compute the theme and pass it to `PageShell`, and replace the header logo block with `Brandmark`:

```tsx
  const themeStyle = tenantThemeStyle(card.tenant_primary_color, card.tenant_secondary_color);
```

Wrap the success render's `<PageShell>` with `<PageShell style={themeStyle}>`. Replace the header's logo/neutral-mark block (the `{card.tenant_logo_url ? <img …/> : <span …><ShieldCheck/></span>}`) with:

```tsx
            <Brandmark name={card.tenant_name} logoUrl={card.tenant_logo_url} className="size-9" />
```

(The not-found `<PageShell>` keeps the default theme — no `style`.)

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add "app/t/[tenant]/id/[slug]/page.tsx"
git commit -m "feat(branding): theme + Brandmark the public verify card"
```

---

## Task 7: Theme + brand the `?tenant` auth pages

**Files:**
- Create: `components/auth/auth-brand-header.tsx`
- Modify: `app/(auth)/layout.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/register/page.tsx`

- [ ] **Step 1: Create `components/auth/auth-brand-header.tsx`**

This is the brand header the pages render (so it can be tenant-aware — layouts can't read `searchParams`):

```tsx
import Link from "next/link";

import { Brandmark } from "@/components/brand/brandmark";

export function AuthBrandHeader({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  return (
    <Link
      href="/"
      className="mb-8 flex flex-col items-center gap-3 text-center transition-opacity hover:opacity-90"
    >
      <span className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 scale-[1.9] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--gold)_34%,transparent),transparent_68%)] blur-lg"
        />
        <Brandmark name={name} logoUrl={logoUrl} className="size-20 tgp-frame tgp-glow" />
      </span>
      <span className="block">
        <span className="tgp-eyebrow block text-[10px] text-gold/80">Official Registry</span>
        <span className="tgp-display block text-xl font-bold tracking-[0.16em]">{name}</span>
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: `app/(auth)/layout.tsx` — strip the hardcoded brand**

The layout becomes a neutral themed shell; the brand header moves to the pages. Replace the file with:

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[640px] bg-[radial-gradient(ellipse_82%_55%_at_50%_0%,color-mix(in_oklab,var(--gold)_18%,transparent),color-mix(in_oklab,var(--gold)_6%,transparent)_40%,transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[520px] bg-gradient-to-b from-transparent to-background [mask-image:linear-gradient(to_bottom,transparent,black_88%)]"
      />
      {children}
    </main>
  );
}
```

- [ ] **Step 3: A shared page-shell helper for the auth pages**

Both pages need to: resolve the optional `?tenant` brand+theme, render the themed wrapper + `AuthBrandHeader` + their card. Add a small server helper to `lib/branding/brand.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { ResolvedTenant } from "@/lib/types";

/** Resolve a tenant's public brand by slug (for ?tenant auth pages). Null → platform default. */
export async function brandForSlug(
  slug: string | undefined,
): Promise<{ brand: Brand; primary: string | null; secondary: string | null }> {
  if (slug) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_tenant_by_slug", { p_slug: slug });
    const t = data?.[0] as ResolvedTenant | undefined;
    if (t) {
      return {
        brand: { name: t.name, logoUrl: t.logo_url },
        primary: t.primary_color,
        secondary: t.secondary_color,
      };
    }
  }
  return { brand: { name: SITE.name, logoUrl: null }, primary: null, secondary: null };
}
```

(Add the needed imports — `createClient`, `ResolvedTenant` — at the top of `lib/branding/brand.ts`.)

- [ ] **Step 4: `app/(auth)/login/page.tsx` — themed brand header**

The page already reads `searchParams` (incl. `tenant`). At the top of the component, resolve the brand and wrap the existing `<Card>` in a themed container with the header. Add imports:

```tsx
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { brandForSlug, tenantThemeStyle } from "@/lib/branding/brand";
```

After destructuring `{ next, error, tenant }`, add:

```tsx
  const { brand, primary, secondary } = await brandForSlug(tenant);
  const themeStyle = tenantThemeStyle(primary, secondary);
```

Wrap the returned JSX so the brand header sits above the card, all inside a themed div:

```tsx
  return (
    <div style={themeStyle} className="flex w-full flex-col items-center">
      <AuthBrandHeader name={brand.name} logoUrl={brand.logoUrl} />
      <Card className="mx-auto w-full max-w-md border-gold/30 tgp-frame tgp-glow">
        {/* …existing CardHeader/CardContent/CardFooter unchanged… */}
      </Card>
    </div>
  );
```

(Keep the existing card internals exactly; only wrap them.)

- [ ] **Step 5: `app/(auth)/register/page.tsx` — themed brand header**

`register/page.tsx` already reads `{ tenant }` from `searchParams`. Apply the same pattern: add the imports, resolve `const { brand, primary, secondary } = await brandForSlug(tenant); const themeStyle = tenantThemeStyle(primary, secondary);`, and wrap the existing `<Card>` in:

```tsx
  return (
    <div style={themeStyle} className="flex w-full flex-col items-center">
      <AuthBrandHeader name={brand.name} logoUrl={brand.logoUrl} />
      <Card className="mx-auto w-full max-w-2xl border-gold/30 tgp-frame tgp-glow">
        {/* …existing card internals unchanged… */}
      </Card>
    </div>
  );
```

- [ ] **Step 6: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add components/auth/auth-brand-header.tsx "app/(auth)/layout.tsx" "app/(auth)/login/page.tsx" "app/(auth)/register/page.tsx" lib/branding/brand.ts
git commit -m "feat(branding): theme + brand the ?tenant login/register pages"
```

---

## Task 8: Console color pickers

**Files:**
- Modify: `components/platform/branding-form.tsx`

- [ ] **Step 1: Upgrade the color inputs**

In `components/platform/branding-form.tsx`, change the `primary_color` and `secondary_color` `<Input>`s to native color inputs paired with a text input + swatch. Replace the two color `<Field>` blocks with:

```tsx
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
```

(`branding-form.tsx` is already a `"use client"` component, so the `onChange` handler is fine. The text input remains the submitted `name="primary_color"`/`secondary_color` value; the color picker just writes into it.)

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add components/platform/branding-form.tsx
git commit -m "feat(platform): color-picker inputs on the tenant branding form"
```

---

## Task 9: Verification + manual runbook

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Re-run the generator test + static gates**

Run: `node lib/branding/theme.check.mts` (expect `OK: …`), then `npx tsc --noEmit` (clean) then `npm run build` (success).

- [ ] **Step 2: Apply migration `0011` (human, Supabase SQL Editor)**

Paste `supabase/migrations/0011_member_card_branding.sql` → Run. Then paste
`supabase/tests/0011_branding_checks.sql` → expect `OK: get_member_card returns tenant branding colors`, no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 3: Manual dev runbook (human)**

`npm run dev`:
1. **Org-B re-tint:** in `/platform`, open Org-B → set primary `#2563eb` (blue) + secondary `#f5f5f5` (light). Sign in as an Org-B member → `/t/org-b/dashboard` renders blue-on-light and **readable**; the nav/buttons/accents are blue, the background light. An Org-B verify card (`/t/org-b/id/<slug>`) re-tints too.
2. **TGP unchanged by default:** `/t/tgp/...` still looks gold-on-black (TGP has no colors set) — confirms the empty-map default.
3. **TGP seal returns:** set TGP `logo_url` to `/tgp-seal.png` (or a hosted URL) in `/platform` → the workspace nav + verify header show the seal image.
4. **Branded entry:** open `/login?tenant=org-b` → Org-B's colors + name/logo in the header.
5. **Global unchanged:** `/` and `/platform` stay gold/black (default theme).

Record results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 4: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "chore: branding/theming verified (generator test, build, probe, runbook)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 generator → Task 1; §2 injection → Tasks 2 (`tenantThemeStyle`), 4/6/7 (apply); §3 brand identity → Tasks 2 (`getBrand`/`Brandmark`), 4/5/6/7; §4 DB → Task 3; §5 surfaces → Tasks 4 (workspace), 6 (verify), 7 (auth), with global untouched; §6 console pickers → Task 8; §9 verification → Tasks 1, 9.
- **Generator is genuinely tested** (Task 1, Node type-stripping) — the contrast crux has a real assertion (light→dark fg `#0a0a08`, dark→light fg `#f5f1e6`, null→`{}`).
- **Type consistency:** `buildTenantTheme`/`ThemeVars` (Task 1) ↔ `tenantThemeStyle` (Task 2); `Brand`/`getBrand`/`brandForSlug` (Tasks 2,7); `Brandmark({name,logoUrl,className})` used identically in Tasks 4–7; `IdCardData.orgName/orgLogoUrl` (Task 5) set by both builders; `MemberCard.tenant_primary_color/secondary_color` (Task 3) consumed in Task 6; `AppNav`'s new `brand` prop (Task 4) matches its caller (the workspace layout).
- **Out of scope confirmed absent:** no per-tenant typography, no homepage CMS, no custom-domain work. Global surfaces (`/`, `/platform`) deliberately keep the default theme.
- **TGP-unchanged guarantee:** TGP has null colors → `buildTenantTheme` returns `{}` → `:root` applies → identical to today, until colors/logo are set in `/platform`.
