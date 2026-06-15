# Homepage CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, editable per-tenant homepage at `/t/[slug]/home` — JSON content blocks (hero/text/banner/cta/members), a themed public renderer, and a form-based tenant-admin editor — with no HTML/markdown (zero XSS).

**Architecture:** A `tenant_pages` table holds `content_json`; a public `get_tenant_homepage(slug)` RPC returns it + branding + the live member count in one anon call. A pure `lib/cms/blocks.ts` (zod-validated) defines the block model; a block registry renders them on the public page (themed via #5a). A client form editor saves the whole document through an admin-gated, validated action. Middleware passes `/t/[slug]/home` through publicly (like `/id`).

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + RLS), zod, TypeScript. Node 24 runs the `.mts` validator test (type-stripping).

---

## Environment & tooling notes (read first)

- **No test runner / no Supabase CLI.** Migration `0012` is applied manually in the Supabase SQL Editor (additive over `0007`–`0011`, already live). Verification = the SQL probe, the Node validator test (`node lib/cms/blocks.check.mts` — verified it runs `.mts`→`.ts`→zod), `npx tsc --noEmit`, `npm run build`, and a manual runbook (Task 8).
- Run all commands from repo root. The executor (subagent-driven skill) creates a feature branch first.
- Patterns to mirror: `app/t/[tenant]/id/[slug]/page.tsx` (public tenant route + `cache()` loader + `tenantThemeStyle` + `Brandmark`), `lib/supabase/proxy.ts` (the `id` passthrough), `lib/actions/admin.ts` (`getAdminContext` + inline-state action), `components/admin/homepage-editor.tsx` will be a client component like `components/auth/auth-form.tsx`, `components/admin/admin-nav.tsx` (nav links via `tenantHref`), `lib/branding/theme.check.mts` + the `tsconfig.json` exclude (same trick for the new `.mts`).
- `lib/cms/blocks.ts` MUST stay pure (only `import { z } from "zod"`; no React, no `server-only`, no `@/` imports) so the Node test can import it.

## File structure

- **New:** `supabase/migrations/0012_tenant_pages.sql`, `supabase/tests/0012_homepage_checks.sql`, `lib/cms/blocks.ts`, `lib/cms/blocks.check.mts`, `components/cms/home-blocks.tsx` (renderers + registry), `app/t/[tenant]/home/page.tsx` (+ `loading.tsx`), `lib/actions/homepage.ts`, `components/admin/homepage-editor.tsx`, `app/(app)/admin/homepage/page.tsx`.
- **Modify:** `tsconfig.json` (exclude the new `.mts`), `lib/types.ts` (`TenantPage` + `tenant_pages` + RPC), `lib/supabase/proxy.ts` (home passthrough), `components/admin/admin-nav.tsx` (Homepage link).

---

## Task 1: Migration `0012` — `tenant_pages` + homepage RPC (+ probe)

**Files:**
- Create: `supabase/tests/0012_homepage_checks.sql`
- Create: `supabase/migrations/0012_tenant_pages.sql`

- [ ] **Step 1: Write the probe (fails before migration)**

Create `supabase/tests/0012_homepage_checks.sql`:

```sql
-- Run in the Supabase SQL Editor AFTER applying 0012. Transactional; rolls back.
begin;

insert into public.tenant_pages (tenant_id, page_type, content_json)
select id, 'home',
       '{"blocks":[{"id":"b1","type":"hero","props":{"heading":"Welcome"}}]}'::jsonb
from public.tenants where slug = 'tgp'
on conflict (tenant_id, page_type) do update set content_json = excluded.content_json;

do $$
declare r record;
begin
  select * into r from public.get_tenant_homepage('tgp');
  if r.tenant_slug <> 'tgp' then raise exception 'FAIL: slug %', r.tenant_slug; end if;
  if r.content_json -> 'blocks' -> 0 ->> 'type' <> 'hero' then raise exception 'FAIL: blocks not returned'; end if;
  if r.member_count is null then raise exception 'FAIL: member_count null'; end if;
  raise notice 'OK: get_tenant_homepage returns content + branding + count';
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.get_tenant_homepage('does-not-exist');
  if n <> 0 then raise exception 'FAIL: unknown slug returned % rows', n; end if;
  raise notice 'OK: unknown slug -> 0 rows';
end $$;

-- A non-admin tgp member cannot write tenant_pages (RLS write = is_tenant_admin).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','88888888-8888-8888-8888-888888888888',
        'authenticated','authenticated','probe-cms@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
do $$
begin
  begin
    insert into public.tenant_pages (tenant_id, page_type, content_json)
    select id, 'home', '{"blocks":[]}'::jsonb from public.tenants where slug = 'tgp';
    raise exception 'FAIL: non-admin wrote tenant_pages';
  exception
    when insufficient_privilege then raise notice 'OK: RLS blocked non-admin write';
    when others then
      if position('FAIL' in sqlerrm) > 0 then raise; end if;
      raise notice 'OK: non-admin write rejected (%)', sqlerrm;
  end;
end $$;
reset role;

rollback;
```

- [ ] **Step 2: Confirm it fails today**

Paste into the SQL Editor, Run. Expected: **FAIL** — `relation "public.tenant_pages" does not exist`. Record that it errored.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0012_tenant_pages.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0012: tenant_pages (homepage CMS)
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007–0011. One table + one public read RPC. RLS: members read
-- (for editing), admins write, anon only via get_tenant_homepage.
-- =============================================================================

create table if not exists public.tenant_pages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  page_type    text not null,
  content_json jsonb not null default '{"blocks":[]}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, page_type)
);
create index if not exists tenant_pages_tenant_idx on public.tenant_pages (tenant_id);

alter table public.tenant_pages enable row level security;

drop policy if exists tenant_pages_select on public.tenant_pages;
drop policy if exists tenant_pages_write  on public.tenant_pages;

create policy tenant_pages_select on public.tenant_pages for select
  using (public.is_tenant_member(tenant_id));
create policy tenant_pages_write on public.tenant_pages for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- Public homepage read: branding + content + live active-member count.
drop function if exists public.get_tenant_homepage(text) cascade;

create or replace function public.get_tenant_homepage(p_slug text)
returns table (
  tenant_name            text,
  tenant_slug            text,
  tenant_status          public.tenant_status,
  tenant_logo_url        text,
  tenant_primary_color   text,
  tenant_secondary_color text,
  content_json           jsonb,
  member_count           bigint
)
language sql stable security definer set search_path = public as $$
  select t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color,
         coalesce(p.content_json, '{"blocks":[]}'::jsonb),
         (select count(*) from public.profiles pr
           where pr.tenant_id = t.id and pr.status = 'active')
  from public.tenants t
  left join public.tenant_pages p on p.tenant_id = t.id and p.page_type = 'home'
  where t.slug = p_slug;
$$;

revoke all on function public.get_tenant_homepage(text) from public;
grant execute on function public.get_tenant_homepage(text) to anon, authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0012_homepage_checks.sql supabase/migrations/0012_tenant_pages.sql
git commit -m "feat(db): 0012 — tenant_pages + get_tenant_homepage RPC"
```

---

## Task 2: Types — `TenantPage` + `tenant_pages` + RPC

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `TenantPage` + `HomepageResult`**

In `lib/types.ts`, after the `Tenant` type, add:

```ts
export type TenantPage = {
  id: string;
  tenant_id: string;
  page_type: string;
  content_json: { blocks: unknown[] };
  updated_at: string;
};

/** Row shape returned by the public `get_tenant_homepage` RPC. */
export type HomepageResult = {
  tenant_name: string;
  tenant_slug: string;
  tenant_status: TenantStatus;
  tenant_logo_url: string | null;
  tenant_primary_color: string | null;
  tenant_secondary_color: string | null;
  content_json: { blocks: unknown[] };
  member_count: number;
};
```

- [ ] **Step 2: Register the table + RPC in `Database`**

In `Database.public.Tables`, add `tenant_pages: Generated<TenantPage>;`. In `Database.public.Functions`, add:

```ts
      get_tenant_homepage: { Args: { p_slug: string }; Returns: HomepageResult[] };
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add lib/types.ts
git commit -m "feat(types): TenantPage + get_tenant_homepage typing"
```

---

## Task 3: Block model (pure, zod) + Node test

**Files:**
- Create: `lib/cms/blocks.ts`
- Create: `lib/cms/blocks.check.mts`
- Modify: `tsconfig.json`

- [ ] **Step 0: Exclude the test script from `tsc`**

In `tsconfig.json`, change the `"exclude"` array to also list the new `.mts` (it imports `./blocks.ts` with an explicit extension, which `tsc` rejects):

```json
  "exclude": ["node_modules", "lib/branding/theme.check.mts", "lib/cms/blocks.check.mts"]
```

- [ ] **Step 1: Write the failing test**

Create `lib/cms/blocks.check.mts`:

```ts
import { HomeContentSchema, safeHref, newBlock } from "./blocks.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// A valid document parses.
assert(HomeContentSchema.safeParse({ blocks: [newBlock("hero"), newBlock("banner")] }).success, "valid doc parses");

// Over the 50-block cap is rejected.
assert(!HomeContentSchema.safeParse({ blocks: Array.from({ length: 51 }, () => newBlock("text")) }).success, "51 blocks reject");

// safeHref allows internal paths + http(s), rejects everything else.
assert(safeHref("/t/x/dashboard") === "/t/x/dashboard", "internal path allowed");
assert(safeHref("https://example.com") === "https://example.com", "https allowed");
assert(safeHref("javascript:alert(1)") === null, "javascript: rejected");
assert(safeHref("//evil.com") === null, "protocol-relative rejected");
assert(safeHref("") === null, "empty rejected");

// A bad href inside a block is coerced to null by the schema (not a parse error).
const parsed = HomeContentSchema.safeParse({
  blocks: [{ id: "x", type: "cta", props: { heading: "h", label: "go", href: "javascript:bad" } }],
});
assert(parsed.success && parsed.data.blocks[0].props.href === null, "bad href in block → null");

console.log("OK: blocks validator checks pass");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node lib/cms/blocks.check.mts`
Expected: FAIL — `Cannot find module './blocks.ts'`.

- [ ] **Step 3: Implement `lib/cms/blocks.ts`**

```ts
import { z } from "zod";

export const BLOCK_TYPES = ["hero", "text", "banner", "cta", "members"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Hero",
  text: "Text",
  banner: "Announcement",
  cta: "Call to action",
  members: "Member count",
};

/** Allow https/http URLs and internal absolute paths; reject everything else. */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const v = href.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}

const short = z.string().trim().max(200);
const long = z.string().trim().max(4000);
const href = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .nullable()
  .transform((v) => safeHref(v ?? null));

const heroProps = z.object({
  heading: short,
  subheading: short.optional().default(""),
  ctaLabel: short.optional().default(""),
  ctaHref: href,
});
const textProps = z.object({ heading: short.optional().default(""), body: long });
const bannerProps = z.object({
  tone: z.enum(["info", "gold", "warn"]).default("info"),
  message: short,
  linkLabel: short.optional().default(""),
  linkHref: href,
});
const ctaProps = z.object({ heading: short, label: short, href });
const membersProps = z.object({ heading: short.optional().default("") });

const blockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("hero"), props: heroProps }),
  z.object({ id: z.string(), type: z.literal("text"), props: textProps }),
  z.object({ id: z.string(), type: z.literal("banner"), props: bannerProps }),
  z.object({ id: z.string(), type: z.literal("cta"), props: ctaProps }),
  z.object({ id: z.string(), type: z.literal("members"), props: membersProps }),
]);

export type Block = z.infer<typeof blockSchema>;
export const HomeContentSchema = z.object({ blocks: z.array(blockSchema).max(50) });
export type HomeContent = z.infer<typeof HomeContentSchema>;

export const DEFAULT_HOME: HomeContent = {
  blocks: [
    {
      id: "default-hero",
      type: "hero",
      props: { heading: "", subheading: "", ctaLabel: "Sign in", ctaHref: null },
    },
  ],
};

export function newBlock(type: BlockType): Block {
  const id = `b-${Math.random().toString(36).slice(2, 10)}`;
  switch (type) {
    case "hero":
      return { id, type, props: { heading: "Heading", subheading: "", ctaLabel: "", ctaHref: null } };
    case "text":
      return { id, type, props: { heading: "", body: "" } };
    case "banner":
      return { id, type, props: { tone: "info", message: "Announcement", linkLabel: "", linkHref: null } };
    case "cta":
      return { id, type, props: { heading: "Ready to join?", label: "Get started", href: null } };
    case "members":
      return { id, type, props: { heading: "Our members" } };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node lib/cms/blocks.check.mts`
Expected: `OK: blocks validator checks pass`

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean — the `.mts` is excluded).

```bash
git add lib/cms/blocks.ts lib/cms/blocks.check.mts tsconfig.json
git commit -m "feat(cms): zod-validated homepage block model (+ node test)"
```

---

## Task 4: Block renderers + registry

**Files:**
- Create: `components/cms/home-blocks.tsx`

- [ ] **Step 1: Create `components/cms/home-blocks.tsx`**

```tsx
import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Block } from "@/lib/cms/blocks";
import { cn } from "@/lib/utils";

export type BlockContext = { slug: string; memberCount: number };

function paragraphs(body: string) {
  return body.split(/\n{2,}/).map((p, i) => (
    <p key={i} className="text-muted-foreground [&:not(:first-child)]:mt-3">
      {p}
    </p>
  ));
}

/** Renders one block. All text is escaped React children — no HTML/markdown. */
export function BlockRenderer({ block, ctx }: { block: Block; ctx: BlockContext }) {
  switch (block.type) {
    case "hero": {
      const href = block.props.ctaHref ?? `/login?tenant=${ctx.slug}`;
      return (
        <section className="py-12 text-center">
          <h1 className="tgp-display tgp-gild text-3xl font-black tracking-tight sm:text-5xl">
            {block.props.heading}
          </h1>
          {block.props.subheading && (
            <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
              {block.props.subheading}
            </p>
          )}
          {block.props.ctaLabel && (
            <Button asChild size="lg" className="mt-6">
              <Link href={href}>{block.props.ctaLabel}</Link>
            </Button>
          )}
        </section>
      );
    }
    case "text":
      return (
        <section className="py-6">
          {block.props.heading && (
            <h2 className="tgp-display text-xl font-semibold tracking-wide">{block.props.heading}</h2>
          )}
          <div className="mt-2">{paragraphs(block.props.body)}</div>
        </section>
      );
    case "banner":
      return (
        <aside
          className={cn(
            "my-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
            block.props.tone === "gold" && "border-gold/40 bg-gold/10 text-gold-bright",
            block.props.tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-300",
            block.props.tone === "info" && "border-border bg-card text-foreground",
          )}
        >
          <Megaphone className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">{block.props.message}</span>
          {block.props.linkLabel && block.props.linkHref && (
            <Link href={block.props.linkHref} className="text-sm font-medium underline-offset-4 hover:underline">
              {block.props.linkLabel}
            </Link>
          )}
        </aside>
      );
    case "cta":
      return (
        <section className="my-6 rounded-xl border border-gold/30 bg-card p-8 text-center tgp-frame">
          <h2 className="tgp-display text-2xl font-bold">{block.props.heading}</h2>
          <Button asChild size="lg" className="mt-4">
            <Link href={block.props.href ?? `/login?tenant=${ctx.slug}`}>{block.props.label}</Link>
          </Button>
        </section>
      );
    case "members":
      return (
        <section className="py-8 text-center">
          {block.props.heading && (
            <p className="tgp-eyebrow text-[11px] text-gold/80">{block.props.heading}</p>
          )}
          <div className="tgp-display tgp-gild mt-2 text-5xl font-black">{ctx.memberCount}</div>
          <p className="text-xs tracking-widest text-muted-foreground uppercase">Active members</p>
        </section>
      );
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expect clean).

```bash
git add components/cms/home-blocks.tsx
git commit -m "feat(cms): homepage block renderers"
```

---

## Task 5: Public homepage renderer

**Files:**
- Create: `app/t/[tenant]/home/page.tsx`
- Create: `app/t/[tenant]/home/loading.tsx`

- [ ] **Step 1: Create `app/t/[tenant]/home/page.tsx`**

```tsx
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { Brandmark } from "@/components/brand/brandmark";
import { BlockRenderer } from "@/components/cms/home-blocks";
import { Button } from "@/components/ui/button";
import { tenantThemeStyle } from "@/lib/branding/brand";
import { DEFAULT_HOME, HomeContentSchema } from "@/lib/cms/blocks";
import { createClient } from "@/lib/supabase/server";
import type { HomepageResult } from "@/lib/types";

const getHomepage = cache(async (slug: string): Promise<HomepageResult | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_tenant_homepage", { p_slug: slug });
  if (error) throw new Error(`Homepage lookup failed: ${error.message}`);
  return (data?.[0] as HomepageResult | undefined) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string }>;
}): Promise<Metadata> {
  const { tenant } = await params;
  const home = await getHomepage(tenant);
  const name = home?.tenant_name ?? "Organization";
  return { title: name, description: `${name} — official organization homepage.` };
}

export default async function HomepagePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const home = await getHomepage(tenant);
  if (!home) notFound();

  // Validate stored content; fall back to the default homepage if empty/invalid.
  const parsed = HomeContentSchema.safeParse(home.content_json);
  const content = parsed.success && parsed.data.blocks.length > 0 ? parsed.data : DEFAULT_HOME;
  const ctx = { slug: home.tenant_slug, memberCount: Number(home.member_count) };
  const themeStyle = tenantThemeStyle(home.tenant_primary_color, home.tenant_secondary_color);

  return (
    <main style={themeStyle} className="min-h-svh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Brandmark name={home.tenant_name} logoUrl={home.tenant_logo_url} className="size-9" />
            <span className="tgp-display text-sm font-bold tracking-wide">{home.tenant_name}</span>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/login?tenant=${home.tenant_slug}`}>Sign in</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 pb-16">
        {content.blocks.map((block) => (
          <BlockRenderer key={block.id} block={block} ctx={ctx} />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create `app/t/[tenant]/home/loading.tsx`**

```tsx
export default function HomepageLoading() {
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl animate-pulse px-4 py-12">
        <div className="mx-auto h-10 w-2/3 rounded bg-secondary" />
        <div className="mx-auto mt-4 h-4 w-1/2 rounded bg-secondary" />
        <div className="mx-auto mt-8 h-10 w-32 rounded bg-secondary" />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add "app/t/[tenant]/home/page.tsx" "app/t/[tenant]/home/loading.tsx"
git commit -m "feat(cms): public themed homepage renderer at /t/[tenant]/home"
```

---

## Task 6: Middleware — public `/t/[slug]/home` passthrough

**Files:**
- Modify: `lib/supabase/proxy.ts`

- [ ] **Step 1: Add `home` to the public passthrough**

In `lib/supabase/proxy.ts`, the existing block strips spoofed headers and returns a public passthrough when `segs[2] === "id"`. Extend that condition to also match `home`. Change:

```ts
    if (segs[2] === "id") {
```

to:

```ts
    if (segs[2] === "id" || segs[2] === "home") {
```

(Update the adjacent comment to mention the homepage too, e.g. "Public per-tenant verification + homepage (/t/[slug]/id|home/...) are anonymous …".)

- [ ] **Step 2: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add lib/supabase/proxy.ts
git commit -m "feat(proxy): pass /t/[slug]/home through publicly (no auth gate)"
```

---

## Task 7: Editor — action + client editor + page + nav

**Files:**
- Create: `lib/actions/homepage.ts`
- Create: `components/admin/homepage-editor.tsx`
- Create: `app/(app)/admin/homepage/page.tsx`
- Modify: `components/admin/admin-nav.tsx`

- [ ] **Step 1: Create `lib/actions/homepage.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { HomeContentSchema } from "@/lib/cms/blocks";
import { getActiveTenant } from "@/lib/tenant/context";

export type HomepageState = { error?: string; notice?: string };

/** Re-verify tenant admin, validate the submitted blocks, upsert the home page. */
async function requireAdminTenant() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const tenant = await getActiveTenant();
  if (!tenant) throw new Error("No active tenant");
  const { data } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .single();
  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    throw new Error("Forbidden");
  }
  return { supabase, tenant };
}

export async function saveHomepage(
  _prev: HomepageState,
  formData: FormData,
): Promise<HomepageState> {
  const { supabase, tenant } = await requireAdminTenant();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("content") ?? ""));
  } catch {
    return { error: "Invalid content payload." };
  }
  const parsed = HomeContentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Some blocks are invalid (too long, too many, or a bad link)." };
  }

  const { error } = await supabase
    .from("tenant_pages")
    .upsert(
      { tenant_id: tenant.id, page_type: "home", content_json: parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,page_type" },
    );
  if (error) return { error: error.message };

  revalidatePath(`/t/${tenant.slug}/home`);
  revalidatePath("/admin/homepage");
  return { notice: "Homepage saved." };
}
```

- [ ] **Step 2: Create `components/admin/homepage-editor.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { saveHomepage, type HomepageState } from "@/lib/actions/homepage";
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  newBlock,
  type Block,
  type BlockType,
} from "@/lib/cms/blocks";

const initialState: HomepageState = {};

export function HomepageEditor({
  initialBlocks,
  homeUrl,
}: {
  initialBlocks: Block[];
  homeUrl: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [addType, setAddType] = useState<BlockType>("hero");
  const [state, formAction] = useActionState(saveHomepage, initialState);

  function patch(i: number, props: Record<string, unknown>) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? ({ ...b, props: { ...b.props, ...props } } as Block) : b)));
  }
  function move(i: number, dir: -1 | 1) {
    setBlocks((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function remove(i: number) {
    setBlocks((bs) => bs.filter((_, j) => j !== i));
  }

  return (
    <form action={formAction} className="space-y-4">
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

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <Label htmlFor="addType">Add block</Label>
          <Select id="addType" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" onClick={() => setBlocks((bs) => [...bs, newBlock(addType)])}>
          <Plus />
          Add
        </Button>
        <Button asChild variant="ghost" className="ml-auto">
          <Link href={homeUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            View homepage
          </Link>
        </Button>
      </div>

      {blocks.map((block, i) => (
        <Card key={block.id} className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="tgp-eyebrow text-[11px] text-gold/80">{BLOCK_LABELS[block.type]}</span>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up">
                <ArrowUp />
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down">
                <ArrowDown />
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Delete">
                <Trash2 />
              </Button>
            </div>
          </div>
          <BlockFields block={block} onChange={(props) => patch(i, props)} />
        </Card>
      ))}

      <input type="hidden" name="content" value={JSON.stringify({ blocks })} />
      <SubmitButton pendingText="Saving…">Save homepage</SubmitButton>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (props: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "hero":
      return (
        <>
          <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
          <Field label="Subheading"><Input value={block.props.subheading} onChange={(e) => onChange({ subheading: e.target.value })} /></Field>
          <Field label="Button label"><Input value={block.props.ctaLabel} onChange={(e) => onChange({ ctaLabel: e.target.value })} /></Field>
          <Field label="Button link (blank = sign in)"><Input value={block.props.ctaHref ?? ""} onChange={(e) => onChange({ ctaHref: e.target.value })} placeholder="/t/slug/dashboard or https://…" /></Field>
        </>
      );
    case "text":
      return (
        <>
          <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
          <Field label="Body"><Textarea rows={5} value={block.props.body} onChange={(e) => onChange({ body: e.target.value })} /></Field>
        </>
      );
    case "banner":
      return (
        <>
          <Field label="Tone">
            <Select value={block.props.tone} onChange={(e) => onChange({ tone: e.target.value })}>
              <option value="info">Info</option>
              <option value="gold">Gold</option>
              <option value="warn">Warning</option>
            </Select>
          </Field>
          <Field label="Message"><Input value={block.props.message} onChange={(e) => onChange({ message: e.target.value })} /></Field>
          <Field label="Link label"><Input value={block.props.linkLabel} onChange={(e) => onChange({ linkLabel: e.target.value })} /></Field>
          <Field label="Link URL"><Input value={block.props.linkHref ?? ""} onChange={(e) => onChange({ linkHref: e.target.value })} /></Field>
        </>
      );
    case "cta":
      return (
        <>
          <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
          <Field label="Button label"><Input value={block.props.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
          <Field label="Button link"><Input value={block.props.href ?? ""} onChange={(e) => onChange({ href: e.target.value })} /></Field>
        </>
      );
    case "members":
      return <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>;
  }
}
```

- [ ] **Step 3: Create `app/(app)/admin/homepage/page.tsx`**

```tsx
import type { Metadata } from "next";

import { HomepageEditor } from "@/components/admin/homepage-editor";
import { requireTenantAdmin } from "@/lib/auth";
import { DEFAULT_HOME, HomeContentSchema, type Block } from "@/lib/cms/blocks";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Homepage" };

export default async function AdminHomepagePage() {
  const { tenant } = await requireTenantAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tenant_pages")
    .select("content_json")
    .eq("tenant_id", tenant.id)
    .eq("page_type", "home")
    .maybeSingle();
  if (error) throw error;

  const parsed = HomeContentSchema.safeParse(data?.content_json);
  const blocks: Block[] = parsed.success ? parsed.data.blocks : DEFAULT_HOME.blocks;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="tgp-display text-xl font-bold tracking-tight">Homepage</h2>
        <p className="text-sm text-muted-foreground">
          Edit your organization&apos;s public homepage. Saved changes go live immediately.
        </p>
      </div>
      <HomepageEditor initialBlocks={blocks} homeUrl={`/t/${tenant.slug}/home`} />
    </div>
  );
}
```

- [ ] **Step 4: Add the Homepage link to `components/admin/admin-nav.tsx`**

Add an entry to the `LINKS` array (it already maps to `tenantHref(basePath, …)`). Insert after the Chapters/Audit entries:

```tsx
  { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate },
```

and add `LayoutTemplate` to the `lucide-react` import at the top of the file.

- [ ] **Step 5: Typecheck + build + commit**

Run: `npx tsc --noEmit` then `npm run build` (expect both succeed).

```bash
git add lib/actions/homepage.ts components/admin/homepage-editor.tsx "app/(app)/admin/homepage/page.tsx" components/admin/admin-nav.tsx
git commit -m "feat(cms): tenant-admin homepage editor + save action + nav link"
```

---

## Task 8: Verification + manual runbook

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Static gates**

Run: `node lib/cms/blocks.check.mts` (expect `OK`), `npx tsc --noEmit` (clean), `npm run build` (success; confirm `/t/[tenant]/home` and `/admin/homepage` routes appear).

- [ ] **Step 2: Apply migration `0012` (human, Supabase SQL Editor)**

Paste `supabase/migrations/0012_tenant_pages.sql` → Run. Then `supabase/tests/0012_homepage_checks.sql` → expect only `OK` notices, no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 3: Manual dev runbook (human)**

`npm run dev`:
1. As an **Org-B admin**, open `/t/org-b/admin/homepage` → add a hero, a banner, and a members block; reorder; Save → "Homepage saved."
2. Open `/t/org-b/home` **logged-out** → the blocks render in Org-B's theme; the members block shows the live count; "Sign in" links to `/login?tenant=org-b`.
3. **Unedited tenant:** open a tenant whose homepage was never saved → the default hero shows.
4. **Safety:** in the editor, set a button link to `javascript:alert(1)` and Save → it's stored as null/empty (no link), and the page never executes it.
5. **Auth:** a non-admin opening `/t/org-b/admin/homepage` → `forbidden()`; `/t/org-b/home` works for everyone (no login redirect).

Record results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 4: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "chore: homepage CMS verified (validator test, build, probe, runbook)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 DB → Task 1; §2 block model → Task 3; §3 renderer → Tasks 4–5; §4 editor → Task 7; §5 action → Task 7; §6 middleware → Task 6; §7 types → Task 2; §10 verification → Tasks 1, 3, 8.
- **Block model is genuinely tested** (Task 3, Node + zod): valid parse, 50-cap, `safeHref` rejects `javascript:`/`//`, and a bad href in a block is coerced to null.
- **Type consistency:** `Block`/`HomeContent`/`HomeContentSchema`/`DEFAULT_HOME`/`newBlock`/`safeHref`/`BLOCK_TYPES`/`BLOCK_LABELS` (Task 3) are consumed by the renderer (Task 4: `Block`, `BlockContext`), the page (Task 5: `HomeContentSchema`, `DEFAULT_HOME`), the editor (Task 7), and the action (Task 7: `HomeContentSchema`). `HomepageResult` (Task 2) is consumed by Task 5. The `content` hidden field name (Task 7 editor) matches what `saveHomepage` reads (Task 7 action). `get_tenant_homepage` arg `p_slug` matches Task 1.
- **Safety is structural:** no HTML/markdown anywhere; the only "active" content is links, gated by `safeHref` at both validate-time (zod transform) and render-time (the schema already nulled them). Block count + field lengths capped.
- **Out of scope confirmed absent:** no draft/publish, no drag-drop/WYSIWYG, no markdown, no custom blocks. Tenant root + workspace routing unchanged (only the `home` passthrough added).
