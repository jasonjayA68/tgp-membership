# Tenant Homepage ("Light over Darkness") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shared tenant homepage a real "Light over Darkness" design — a fixed brand-driven hero (logo + name per tenant) plus substantive, editable default content below.

**Architecture:** The homepage page renders a fixed brand hero from the tenant's own data (`tenant_name`/`tenant_logo_url`/colors), then the existing CMS blocks. A richer `DEFAULT_HOME` gives the un-customized page substance; block CTA fallbacks point at the Part B tenant routes. Shared copy lives in one `HOMEPAGE` constant.

**Tech Stack:** Next.js 16 App Router, TypeScript, existing `Brandmark`/`Button`/`tenantThemeStyle`, the CMS block system, zod.

**Context for the implementer:**
- Spec: `docs/superpowers/specs/2026-06-16-tenant-homepage-design.md`. Builds on #5b (CMS) + #7b Part B.
- Branch from `main`: `feat/tenant-homepage`.
- No DB changes. Pure-logic gate: `node lib/cms/blocks.check.mts` (tsconfig-excluded, run with `node`). Plus `npx tsc --noEmit` + `npm run build` + visual check.
- The homepage page `app/t/[tenant]/home/page.tsx` already imports `Link`, `Brandmark`, `Button`, `tenantThemeStyle`, `DEFAULT_HOME`, `HomeContentSchema`. It exposes `home.tenant_name`, `home.tenant_logo_url`, `home.tenant_slug` and a `content` object (parsed blocks or `DEFAULT_HOME`).

---

## File Structure
- **Modified:** `lib/constants.ts` (`HOMEPAGE` copy), `lib/cms/blocks.ts` (`DEFAULT_HOME`), `lib/cms/blocks.check.mts` (assert DEFAULT_HOME valid), `components/cms/home-blocks.tsx` (CTA hrefs), `app/t/[tenant]/home/page.tsx` (brand hero + footer).

---

### Task 1: `HOMEPAGE` shared copy constant

**Files:** Modify `lib/constants.ts`

- [ ] **Step 1: Add the constant**

In `lib/constants.ts`, after the existing `PLATFORM` constant block, add:

```ts
/**
 * Shared homepage copy (motto/tagline). One swap point for now; a per-tenant
 * `tagline` field is the future change. First tenants are TGP councils.
 */
export const HOMEPAGE = {
  eyebrow: "Official Membership Registry",
  tagline: "Fortis Voluntas Fraternitas",
  subtext:
    "Light over darkness — your standing in the brotherhood, recorded, sealed, and verifiable in real time.",
} as const;
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(homepage): HOMEPAGE shared copy constant"
```

---

### Task 2: Richer `DEFAULT_HOME` + test guard

**Files:** Modify `lib/cms/blocks.ts`, `lib/cms/blocks.check.mts`

- [ ] **Step 1: Replace `DEFAULT_HOME`**

In `lib/cms/blocks.ts`, replace the existing `DEFAULT_HOME`:
```ts
export const DEFAULT_HOME: HomeContent = {
  blocks: [
    {
      id: "default-hero",
      type: "hero",
      props: { heading: "", subheading: "", ctaLabel: "Sign in", ctaHref: null },
    },
  ],
};
```
with:
```ts
export const DEFAULT_HOME: HomeContent = {
  blocks: [
    {
      id: "default-about",
      type: "text",
      props: {
        heading: "About",
        body: "Welcome to the official membership registry. Every member carries a tamper-resistant digital ID, verifiable in real time via NFC. Sign in to access your member portal, or apply for membership to get started.",
      },
    },
    {
      id: "default-members",
      type: "members",
      props: { heading: "Our community" },
    },
    {
      id: "default-cta",
      type: "cta",
      props: { heading: "Ready to join?", label: "Apply for membership", href: null },
    },
  ],
};
```

- [ ] **Step 2: Add a validity assertion to the node test**

In `lib/cms/blocks.check.mts`, change the import line:
```ts
import { HomeContentSchema, safeHref, newBlock } from "./blocks.ts";
```
to add `DEFAULT_HOME`:
```ts
import { HomeContentSchema, safeHref, newBlock, DEFAULT_HOME } from "./blocks.ts";
```
Then add this assertion just before the final `console.log(...)` line:
```ts
// The shipped default homepage is a valid document.
assert(HomeContentSchema.safeParse(DEFAULT_HOME).success, "DEFAULT_HOME is valid");
```

- [ ] **Step 3: Run the node test**

Run: `node lib/cms/blocks.check.mts`
Expected: `OK: blocks validator checks pass`

- [ ] **Step 4: Verify tsc**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/cms/blocks.ts lib/cms/blocks.check.mts
git commit -m "feat(homepage): substantive DEFAULT_HOME (about + members + apply CTA)"
```

---

### Task 3: Block CTA fallbacks → tenant routes

**Files:** Modify `components/cms/home-blocks.tsx`

- [ ] **Step 1: Hero fallback → `/t/<slug>/login`**

In `components/cms/home-blocks.tsx`, in the `case "hero":` block, change:
```ts
      const href = block.props.ctaHref ?? `/login?tenant=${ctx.slug}`;
```
to:
```ts
      const href = block.props.ctaHref ?? `/t/${ctx.slug}/login`;
```

- [ ] **Step 2: CTA fallback → `/t/<slug>/register`**

In the `case "cta":` block, change:
```tsx
            <Link href={block.props.href ?? `/login?tenant=${ctx.slug}`}>{block.props.label}</Link>
```
to:
```tsx
            <Link href={block.props.href ?? `/t/${ctx.slug}/register`}>{block.props.label}</Link>
```

(A "join/apply" CTA defaults to the apply page; an admin can still set an explicit `href`.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add components/cms/home-blocks.tsx
git commit -m "feat(homepage): block CTA fallbacks use Part B tenant routes"
```

---

### Task 4: Brand hero + footer on the homepage

**Files:** Modify `app/t/[tenant]/home/page.tsx`

- [ ] **Step 1: Import `HOMEPAGE`**

In `app/t/[tenant]/home/page.tsx`, add to the imports (alongside the other `@/lib/*` imports):
```ts
import { HOMEPAGE } from "@/lib/constants";
```

- [ ] **Step 2: Insert the brand hero + footer**

In the returned JSX, find the closing `</header>` and the CMS blocks `<div>`:
```tsx
      </header>

      <div className="mx-auto max-w-3xl px-4 pb-16">
        {content.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} ctx={ctx} />
        ))}
      </div>
    </main>
```
Replace that with (brand hero between header and blocks; footer after blocks):
```tsx
      </header>

      <section className="relative isolate overflow-hidden px-4 py-16 text-center sm:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(ellipse_82%_55%_at_50%_0%,color-mix(in_oklab,var(--gold)_18%,transparent),color-mix(in_oklab,var(--gold)_6%,transparent)_40%,transparent_72%)]"
        />
        <span className="relative inline-block">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 scale-[1.9] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--gold)_34%,transparent),transparent_68%)] blur-lg"
          />
          <Brandmark
            name={home.tenant_name}
            logoUrl={home.tenant_logo_url}
            className="size-24 tgp-frame tgp-glow sm:size-28"
          />
        </span>
        <p className="tgp-eyebrow mt-6 text-[11px] text-gold/80">{HOMEPAGE.eyebrow}</p>
        <h1 className="tgp-display tgp-gild mt-3 text-4xl font-black tracking-[0.06em] sm:text-6xl">
          {home.tenant_name}
        </h1>
        <p className="tgp-eyebrow mt-3 text-xs text-foreground/70">{HOMEPAGE.tagline}</p>
        <p className="mx-auto mt-5 max-w-xl text-balance text-muted-foreground">
          {HOMEPAGE.subtext}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href={`/t/${home.tenant_slug}/login`}>Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/t/${home.tenant_slug}/register`}>Apply for membership</Link>
          </Button>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 pb-16">
        {content.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} ctx={ctx} />
        ))}
      </div>

      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        © {home.tenant_name}
      </footer>
    </main>
```

- [ ] **Step 3: Verify**

Run: `rm -rf .next && npx tsc --noEmit` → clean.
Run: `npm run build` → completes.

- [ ] **Step 4: Commit**

```bash
git add "app/t/[tenant]/home/page.tsx"
git commit -m "feat(homepage): brand-driven Light-over-Darkness hero + footer"
```

---

### Task 5: Final verification (manual — user-run)

No code.

- [ ] **Step 1: Static gates (you run)**

```bash
node lib/cms/blocks.check.mts   # OK: blocks validator checks pass
rm -rf .next && npx tsc --noEmit # clean
npm run build                    # builds
```

- [ ] **Step 2: Visual runbook (`npm run dev`)**
1. Visit **`/t/tgp/home`** → a designed homepage: glowing TGP logo, "Official Membership Registry" eyebrow, gilded **Tau Gamma Phi**, the motto + subtext, **Sign in** (→ `/t/tgp/login`) + **Apply for membership** (→ `/t/tgp/register`) buttons; below: the **About** text, the live **member count**, a **Ready to join? → Apply** CTA (→ `/t/tgp/register`); a footer.
2. A second tenant (e.g. `org-b`) at `/t/org-b/home` → same design but **its own** logo/name (brand-driven), shared motto.
3. A tenant that customized its homepage (non-empty content) → brand hero on top, **its own** blocks below (not the default).
4. On a verified custom domain → `https://<domain>/` shows the same homepage.

---

## Notes for the executor
- After all tasks: dispatch the final review, then use `superpowers:finishing-a-development-branch`. No migration; the runbook is a visual check. **Do not merge** until the user eyeballs `/t/tgp/home` and confirms.
- Future (out of scope, flagged): a per-tenant `tenants.tagline` field to replace the shared `HOMEPAGE.tagline`.
