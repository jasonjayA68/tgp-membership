# NFC Tenant-Aware Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public NFC verification surface tenant-aware — a branded `/t/[tenant]/id/[slug]` URL, a generic schema-driven card that shows the card's tenant identity + its public custom fields, with the old `/id/[slug]` 307-redirecting to canonical.

**Architecture:** `get_member_card` becomes a pure read returning tenant identity + a `public_fields` JSONB array (schema-driven, type-aware); a new `record_card_scan` RPC carries the scan side-effect so the redirect chain counts once. A real `app/t/[tenant]/id/[slug]/page.tsx` renders the generic card; the old `app/id/[slug]/page.tsx` becomes a redirect; and the #2 middleware passes `/t/[slug]/id/…` through publicly (no auth gate).

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), Supabase (Postgres + RLS), `@supabase/ssr`, TypeScript.

---

## Environment & tooling notes (read first)

- **No test runner / no Supabase CLI.** Migration `0009` is applied **manually in the Supabase SQL Editor** (it's additive over `0007`+`0008`, already applied to the live DB). Verification = a runnable SQL probe, `npx tsc --noEmit`, `npm run build`, and a manual dev runbook (Task 8).
- Run all commands from repo root: `/Users/jasonjayababao/tgp-membership`. The executor (subagent-driven skill) creates a feature branch first.
- Prior art to mirror: the existing `app/id/[slug]/page.tsx` (card markup + `getCard` memoization), `0007`/`0008` RPC patterns, `lib/supabase/proxy.ts` (#2 middleware), `lib/site.ts` `verificationUrl`.
- **Do NOT change** `components/id-card.tsx` (that's the member's *private* dashboard preview, not the public card) or the workspace auth flow.

## File structure

- **New:** `supabase/migrations/0009_member_card_generic.sql`, `supabase/tests/0009_member_card_checks.sql`, `components/verify/not-recognized.tsx`, `app/t/[tenant]/id/[slug]/page.tsx`, `app/t/[tenant]/id/[slug]/loading.tsx`.
- **Modify:** `lib/types.ts` (MemberCard + PublicField + record_card_scan), `lib/site.ts` (`verificationUrl` signature), `lib/supabase/proxy.ts` (`/t/[slug]/id` passthrough), `app/id/[slug]/page.tsx` (→ redirect-only), `app/(app)/dashboard/page.tsx` + `app/(app)/admin/members/[id]/page.tsx` (QR URL).
- **Delete:** `app/id/[slug]/loading.tsx` is superseded by the new route's loading; leave it (harmless) — the redirect route resolves fast.

---

## Task 1: Migration `0009` — generic `get_member_card` + `record_card_scan` (+ probe)

**Files:**
- Create: `supabase/tests/0009_member_card_checks.sql`
- Create: `supabase/migrations/0009_member_card_generic.sql`

- [ ] **Step 1: Write the probe (fails before migration)**

Create `supabase/tests/0009_member_card_checks.sql`:

```sql
-- Run in the Supabase SQL Editor AFTER applying 0009. Transactional; rolls back.
begin;

-- Seed a throwaway TGP card with public custom fields (postgres bypasses RLS).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444',
        'authenticated','authenticated','probe-card@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{"full_name":"Probe Card"}'::jsonb, false);

update public.profiles
   set custom_fields = '{"gt_name":"Juan","gt_number":"0917-000-0001","alexis_name":"Andromeda"}'::jsonb
 where user_id = '44444444-4444-4444-4444-444444444444';

insert into public.nfc_cards (tenant_id, profile_id, slug)
select tenant_id, id, 'probe-card-0009'
from public.profiles where user_id = '44444444-4444-4444-4444-444444444444';

do $$
declare r record; before_n int; after_n int;
begin
  select * into r from public.get_member_card('probe-card-0009');
  if r.tenant_slug <> 'tgp' then raise exception 'FAIL: tenant_slug = %', r.tenant_slug; end if;
  if r.tenant_name is null then raise exception 'FAIL: tenant_name null'; end if;
  if jsonb_array_length(r.public_fields) < 1 then raise exception 'FAIL: no public_fields'; end if;
  raise notice 'OK: get_member_card -> tenant %, % public field(s)', r.tenant_slug, jsonb_array_length(r.public_fields);

  -- get_member_card is a pure read (no scan increment).
  select scan_count into before_n from public.nfc_cards where slug = 'probe-card-0009';
  perform * from public.get_member_card('probe-card-0009');
  select scan_count into after_n from public.nfc_cards where slug = 'probe-card-0009';
  if after_n <> before_n then raise exception 'FAIL: get_member_card mutated scan_count'; end if;
  raise notice 'OK: get_member_card is a pure read';

  -- record_card_scan increments an active card exactly once.
  perform public.record_card_scan('probe-card-0009');
  select scan_count into after_n from public.nfc_cards where slug = 'probe-card-0009';
  if after_n <> before_n + 1 then raise exception 'FAIL: record_card_scan (% -> %)', before_n, after_n; end if;
  raise notice 'OK: record_card_scan increments active card';
end $$;

rollback;
```

- [ ] **Step 2: Confirm it fails today**

Paste into the SQL Editor, Run. Expected: **FAIL** — `column "tenant_slug" does not exist` / `function public.record_card_scan(...) does not exist` (the current `get_member_card` has neither). Record that it errored.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0009_member_card_generic.sql`:

```sql
-- =============================================================================
-- SaaS OS — Migration 0009: Generic, tenant-aware member card
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007/0008. Rewrites get_member_card as a PURE READ that returns
-- tenant identity + a schema-driven public_fields jsonb array, and splits the
-- scan side-effect into record_card_scan (so the redirect chain counts once).
-- =============================================================================

drop function if exists public.get_member_card(text)  cascade;
drop function if exists public.record_card_scan(text) cascade;

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

create or replace function public.record_card_scan(card_slug text)
returns void
language sql volatile security definer set search_path = public as $$
  update public.nfc_cards
     set scan_count = scan_count + 1,
         last_verified_at = now()
   where slug = card_slug and active = true;
$$;

revoke all on function public.record_card_scan(text) from public;
grant execute on function public.record_card_scan(text) to anon, authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0009_member_card_checks.sql supabase/migrations/0009_member_card_generic.sql
git commit -m "feat(db): 0009 — generic tenant-aware get_member_card + record_card_scan"
```

---

## Task 2: Types — `MemberCard`, `PublicField`, `record_card_scan`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Replace the `MemberCard` type + add `PublicField`**

In `lib/types.ts`, replace the entire `MemberCard` type definition with:

```ts
/** One public, schema-defined member field returned by `get_member_card`. */
export type PublicField = {
  key: string;
  label: string;
  type: string; // 'text' | 'date' | 'phone' | 'number' (drives rendering)
  value: string;
};

/** Whitelisted shape returned by the public `get_member_card` RPC (tenant-aware). */
export type MemberCard = {
  full_name: string;
  member_id: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  chapter: string | null;
  district: string | null;
  region: string | null;
  card_active: boolean;
  verify_contact_name: string | null;
  verify_contact_number: string | null;
  tenant_name: string;
  tenant_slug: string;
  tenant_logo_url: string | null;
  public_fields: PublicField[];
};
```

- [ ] **Step 2: Register `record_card_scan` in `Database.Functions`**

In `lib/types.ts`, inside `Database.public.Functions`, add (alongside `get_member_card`):

```ts
      record_card_scan: { Args: { card_slug: string }; Returns: undefined };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `app/id/[slug]/page.tsx` (it reads the now-removed fraternal fields) — fixed in Task 6. `lib/types.ts` itself clean.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): tenant-aware MemberCard + PublicField + record_card_scan"
```

---

## Task 3: `verificationUrl` is tenant-aware — `lib/site.ts`

**Files:**
- Modify: `lib/site.ts`

- [ ] **Step 1: Change the `verificationUrl` signature**

Replace the `verificationUrl` function in `lib/site.ts` with:

```ts
export function verificationUrl(
  baseUrl: string,
  tenantSlug: string,
  cardSlug: string,
): string {
  return `${baseUrl.replace(/\/$/, "")}/t/${tenantSlug}/id/${cardSlug}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors at the two call sites (dashboard, member-detail) passing the old 2-arg form — fixed in Task 7. `lib/site.ts` clean.

- [ ] **Step 3: Commit**

```bash
git add lib/site.ts
git commit -m "feat(site): tenant-aware verificationUrl (/t/[tenant]/id/[slug])"
```

---

## Task 4: Middleware passthrough for public `/t/[slug]/id/…`

**Files:**
- Modify: `lib/supabase/proxy.ts`

- [ ] **Step 1: Add the public-verify passthrough**

In `lib/supabase/proxy.ts`, inside the tenant-route block (`if (path === "/t" || path.startsWith("/t/")) { … }`), immediately after the line `const rest = "/" + segs.slice(2).join("/");`, add:

```ts
    // Public per-tenant verification (/t/[slug]/id/...) is anonymous — let it
    // route straight to the verify page (no tenant resolution, no auth gate).
    if (segs[2] === "id") {
      return response;
    }
```

(`response` here is the `NextResponse.next({ request })` that already carries any refreshed Supabase cookies. The verify page reads everything from the card slug, so no tenant header is needed.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/proxy.ts
git commit -m "feat(proxy): pass /t/[slug]/id public verification through (no auth gate)"
```

---

## Task 5: The generic verify page

**Files:**
- Create: `components/verify/not-recognized.tsx`
- Create: `app/t/[tenant]/id/[slug]/page.tsx`
- Create: `app/t/[tenant]/id/[slug]/loading.tsx`

- [ ] **Step 1: Create `components/verify/not-recognized.tsx`**

```tsx
import { ShieldX } from "lucide-react";

export function NotRecognizedCard({ slug }: { slug: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-card p-8 text-center">
      <ShieldX className="mx-auto size-10 text-destructive" />
      <h1 className="tgp-display mt-4 text-xl font-bold">Card Not Recognized</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This verification code does not match any record.
      </p>
      <p className="tgp-mono mt-4 text-xs break-all text-muted-foreground/70">{slug}</p>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/t/[tenant]/id/[slug]/page.tsx`**

```tsx
import { cache } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  Hash,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { StatusBadge } from "@/components/brand/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { NotRecognizedCard } from "@/components/verify/not-recognized";
import { createClient } from "@/lib/supabase/server";
import type { MemberCard, PublicField } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Memoised per request so generateMetadata + the page share one read. */
const getCard = cache(async (slug: string): Promise<MemberCard | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_member_card", { card_slug: slug });
  if (error) throw new Error(`Verification lookup failed: ${error.message}`);
  return (data?.[0] as MemberCard | undefined) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCard(slug);
  const org = card?.tenant_name ?? "Membership";
  return {
    title: card ? `${card.full_name} — ${org} Verification` : "Membership Verification",
    description: `Official ${org} membership verification.`,
    robots: { index: false, follow: false },
  };
}

type Banner = {
  tone: "verified" | "warn" | "danger";
  icon: typeof ShieldCheck;
  title: string;
  subtitle: string;
};

function bannerFor(card: MemberCard): Banner {
  if (!card.card_active) {
    return {
      tone: "danger",
      icon: ShieldX,
      title: "Card Deactivated",
      subtitle: "This NFC card is no longer valid for verification.",
    };
  }
  if (card.status === "active") {
    return {
      tone: "verified",
      icon: ShieldCheck,
      title: "Verified Member",
      subtitle: `This member is in good standing with ${card.tenant_name}.`,
    };
  }
  if (card.status === "pending") {
    return {
      tone: "warn",
      icon: ShieldAlert,
      title: "Pending Verification",
      subtitle: "This membership has not yet been activated.",
    };
  }
  return {
    tone: "danger",
    icon: ShieldX,
    title: "Not In Good Standing",
    subtitle: "This membership is not currently active.",
  };
}

function FieldValue({ field }: { field: PublicField }) {
  if (field.type === "phone") {
    return (
      <a
        href={`tel:${field.value}`}
        className="tgp-mono inline-flex items-center gap-1 text-gold hover:text-gold-bright"
      >
        <Phone className="size-3" aria-hidden="true" />
        {field.value}
      </a>
    );
  }
  if (field.type === "date") {
    const d = new Date(field.value);
    return (
      <span className="tgp-mono">
        {Number.isNaN(d.getTime())
          ? field.value
          : new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(d)}
      </span>
    );
  }
  return <span className="tgp-display">{field.value}</span>;
}

function DetailRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof MapPin;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5 text-gold/50" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
        Official digital membership verification record.
      </p>
    </main>
  );
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}) {
  const { tenant, slug } = await params;
  const card = await getCard(slug);

  if (!card) {
    return (
      <PageShell>
        <NotRecognizedCard slug={slug} />
      </PageShell>
    );
  }

  // The card slug is authoritative — correct the URL to the card's real tenant.
  if (tenant !== card.tenant_slug) {
    redirect(`/t/${card.tenant_slug}/id/${slug}`);
  }

  // Record the scan exactly once, on the canonical render (active cards only).
  const supabase = await createClient();
  await supabase.rpc("record_card_scan", { card_slug: slug });

  const banner = bannerFor(card);
  const BannerIcon = banner.icon;
  const verifiedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  const hasChapter = card.chapter || card.district || card.region;

  return (
    <PageShell>
      <article className="group relative isolate overflow-hidden rounded-2xl bg-card tgp-frame tgp-glow">
        <div
          className="pointer-events-none absolute inset-0 tgp-guilloche opacity-60"
          aria-hidden="true"
        />

        {/* Document header — tenant identity */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-gold/30 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent px-5 py-3">
          <div className="flex items-center gap-2.5">
            {card.tenant_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.tenant_logo_url}
                alt=""
                className="size-9 rounded-full object-cover ring-1 ring-gold/40"
              />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-ink ring-1 ring-gold/40">
                <ShieldCheck className="size-5 text-gold" aria-hidden="true" />
              </span>
            )}
            <div className="leading-tight">
              <p className="tgp-display text-[12px] font-bold tracking-[0.14em] text-foreground">
                {card.tenant_name}
              </p>
              <p className="mt-0.5 text-[7.5px] tracking-[0.3em] text-gold/70 uppercase">
                Official Registry
              </p>
            </div>
          </div>
          <div className="text-right leading-none">
            <p className="tgp-eyebrow text-[7px] text-gold/60">Type</p>
            <p className="tgp-mono mt-1 text-[11px] font-semibold tracking-[0.18em] text-gold">
              ID
            </p>
          </div>
        </div>

        {/* Verification banner */}
        <div
          className={cn(
            "relative z-10 flex items-center justify-center gap-2.5 border-b px-4 py-3 text-center",
            banner.tone === "verified" && "border-gold/40 bg-gold/15 text-gold-bright",
            banner.tone === "warn" && "border-amber-500/40 bg-amber-500/15 text-amber-300",
            banner.tone === "danger" && "border-destructive/40 bg-destructive/15 text-destructive",
          )}
        >
          <BannerIcon className="size-5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <div className="leading-tight">
            <div className="tgp-eyebrow text-sm">{banner.title}</div>
            <div className="text-[0.65rem] opacity-90">{banner.subtitle}</div>
          </div>
        </div>

        {/* Identity hero */}
        <div className="relative z-10 flex items-start gap-4 px-5 pt-5 pb-4">
          <Avatar
            src={card.photo_url}
            name={card.full_name}
            size={104}
            rounded="lg"
            priority
            className="ring-1 ring-gold/40"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="tgp-display tgp-gild text-xl leading-tight font-semibold break-words">
              {card.full_name || "Member"}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {card.member_id && (
                <span className="tgp-mono inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-ink px-2 py-1 text-xs text-gold">
                  <Hash className="size-3.5" aria-hidden="true" />
                  {card.member_id}
                </span>
              )}
              <StatusBadge status={card.status} />
            </div>
          </div>
        </div>

        {/* Core + public fields */}
        {(hasChapter || card.batch_year || card.public_fields.length > 0) && (
          <div className="relative z-10 border-t border-gold/20 bg-ink/40 px-5 py-4">
            <dl className="divide-y divide-gold/15">
              {card.chapter && <DetailRow label="Chapter" value={card.chapter} />}
              {card.district && <DetailRow label="District" value={card.district} />}
              {card.region && <DetailRow label="Council" value={card.region} icon={MapPin} />}
              {card.batch_year && (
                <DetailRow label="Batch" value={card.batch_year} icon={CalendarDays} />
              )}
              {card.public_fields.map((field) => (
                <DetailRow
                  key={field.key}
                  label={field.label}
                  value={<FieldValue field={field} />}
                />
              ))}
            </dl>
          </div>
        )}

        {/* Verify via the responsible officer */}
        {card.verify_contact_number && (
          <div className="relative z-10 border-t border-gold/20 px-5 py-4">
            <a
              href={`tel:${card.verify_contact_number}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-gold px-4 py-3 text-primary-foreground transition-opacity hover:opacity-90"
            >
              <span className="flex items-center gap-2.5">
                <Phone className="size-5" strokeWidth={2.25} aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="tgp-eyebrow text-[0.6rem]">Call officer to verify</span>
                  {card.verify_contact_name && (
                    <span className="text-[0.7rem] font-medium opacity-90">
                      {card.verify_contact_name}
                    </span>
                  )}
                  <span className="tgp-mono text-sm font-semibold">
                    {card.verify_contact_number}
                  </span>
                </span>
              </span>
              <span className="text-[0.6rem] font-medium tracking-wide uppercase opacity-70">
                Tap
              </span>
            </a>
          </div>
        )}

        {/* Stamped footer */}
        <div className="relative z-10 flex flex-col items-center gap-1 border-t border-gold/40 bg-ink px-5 py-3 text-center">
          <span className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-gold/70" aria-hidden="true" />
            Verified {verifiedAt}
          </span>
        </div>
      </article>
    </PageShell>
  );
}
```

- [ ] **Step 3: Create `app/t/[tenant]/id/[slug]/loading.tsx`**

```tsx
export default function VerifyLoading() {
  return (
    <main className="flex min-h-svh flex-col items-center px-4 py-10">
      <div className="w-full max-w-sm animate-pulse overflow-hidden rounded-2xl border border-gold/20 bg-card">
        <div className="h-14 bg-gold/10" />
        <div className="h-12 border-t border-gold/10 bg-secondary/30" />
        <div className="flex items-start gap-4 px-5 py-5">
          <div className="size-[104px] rounded-lg bg-secondary" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-5 w-40 rounded bg-secondary" />
            <div className="h-6 w-24 rounded bg-secondary" />
          </div>
        </div>
        <div className="space-y-3 border-t border-gold/10 px-5 py-4">
          <div className="h-4 w-full rounded bg-secondary" />
          <div className="h-4 w-2/3 rounded bg-secondary" />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed (the new route compiles; the old `/id` route is fixed in Task 6).

- [ ] **Step 5: Commit**

```bash
git add components/verify/not-recognized.tsx "app/t/[tenant]/id/[slug]/page.tsx" "app/t/[tenant]/id/[slug]/loading.tsx"
git commit -m "feat(verify): generic tenant-aware /t/[tenant]/id/[slug] card"
```

---

## Task 6: Old `/id/[slug]` becomes a redirect

**Files:**
- Modify: `app/id/[slug]/page.tsx` (full replace)

- [ ] **Step 1: Replace `app/id/[slug]/page.tsx`**

```tsx
import { redirect } from "next/navigation";

import { PageShellRedirect } from "@/components/verify/not-recognized";
import { createClient } from "@/lib/supabase/server";
import type { MemberCard } from "@/lib/types";

/**
 * Legacy flat verification URL. Resolves the card's tenant (pure read, no scan)
 * and 307-redirects to the canonical /t/[tenant]/id/[slug]. Unknown slug → the
 * shared "not recognized" view. Already-printed NFC cards keep working.
 */
export default async function LegacyVerifyRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_member_card", { card_slug: slug });
  if (error) throw new Error(`Verification lookup failed: ${error.message}`);
  const card = (data?.[0] as MemberCard | undefined) ?? null;

  if (!card) return <PageShellRedirect slug={slug} />;

  redirect(`/t/${card.tenant_slug}/id/${slug}`);
}
```

- [ ] **Step 2: Add the `PageShellRedirect` export to the shared component**

In `components/verify/not-recognized.tsx`, add a small shell wrapper so the legacy route can render the not-found view standalone. Append:

```tsx
export function PageShellRedirect({ slug }: { slug: string }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <NotRecognizedCard slug={slug} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add "app/id/[slug]/page.tsx" components/verify/not-recognized.tsx
git commit -m "feat(verify): legacy /id/[slug] 307-redirects to canonical /t/[tenant]/id"
```

---

## Task 7: QR / verify URLs at the call sites

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/admin/members/[id]/page.tsx`

- [ ] **Step 1: `app/(app)/dashboard/page.tsx` — pass the tenant slug + fix the Open link**

The dashboard already has `const auth = await getAuth();` → `const { profile, user } = auth;`. Change that destructure to also pull the tenant:

```tsx
  const { profile, user, tenant } = auth;
```

Change the `verifyUrl` line (currently `verificationUrl(baseUrl, card.slug)`):

```tsx
  const verifyUrl = card?.active
    ? verificationUrl(baseUrl, tenant.slug, card.slug)
    : null;
```

Change the "Open" `<Link>` (currently `href={`/id/${card.slug}`}`) to use the canonical URL:

```tsx
                    <Link
                      href={verifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
```

(That `<Link>` is inside the `{verifyUrl && card ? (…)}` block, so `verifyUrl` is non-null there.)

- [ ] **Step 2: `app/(app)/admin/members/[id]/page.tsx` — pass the tenant slug**

The page has `const auth = await requireTenantAdmin();`. Change the `verifyUrl` line (currently `verificationUrl(baseUrl, card.slug)`):

```tsx
  const verifyUrl = card ? verificationUrl(baseUrl, auth.tenant.slug, card.slug) : null;
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed. Then confirm no stale flat verify links remain:

```bash
grep -rns -E 'href=\{`/id/|"/id/' "app/(app)"
```
Expected: NO matches.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/dashboard/page.tsx" "app/(app)/admin/members/[id]/page.tsx"
git commit -m "feat(app): QR/verify links use canonical /t/[tenant]/id URL"
```

---

## Task 8: Verification + manual runbook

**Files:** none (operational) — unless fixes are needed.

- [ ] **Step 1: Static gates**

Run: `npx tsc --noEmit` (expect clean) then `npm run build` (expect success).

- [ ] **Step 2: Stale-link sweep**

```bash
grep -rns -E 'href=\{`/id/|"/id/|verificationUrl\([^,]+,[^,]+\)' "app/(app)" components
```
Expected: NO matches (every verify link is canonical; every `verificationUrl` call passes 3 args). Fix any and re-run Step 1.

- [ ] **Step 3: Apply migration `0009` (human, Supabase SQL Editor)**

Paste `supabase/migrations/0009_member_card_generic.sql` → Run. Then paste
`supabase/tests/0009_member_card_checks.sql` → expect only `OK` notices, no `FAIL`, ends in `ROLLBACK`.

- [ ] **Step 4: Manual dev runbook (human)**

`npm run dev`, then:
1. **TGP card:** open a TGP member's verify URL. From the dashboard, copy the QR/verify link — it should be `…/t/tgp/id/<slug>`. Open it (incognito/logged-out) → renders "Tau Gamma Phi" header, the member's public fields as an ordered list (GT/MWW numbers tappable), and works without a login redirect.
2. **Legacy redirect:** open `…/id/<slug>` → 307-redirects to `…/t/tgp/id/<slug>`.
3. **Canonical correction:** open `…/t/org-b/id/<TGP-slug>` → redirects to `…/t/tgp/id/<slug>`.
4. **Unknown:** open `…/t/tgp/id/does-not-exist` and `…/id/does-not-exist` → "Card Not Recognized".
5. **Scan count:** note the dashboard's "Verified N times"; open the canonical URL once; refresh the dashboard → count increased by exactly 1.
6. **Org-b card (optional):** activate an org-b member (set a public `employee_no` via SQL or the profile form) and confirm its card shows "Org B" + `employee_no`.

Record results. Any failure → debug with `superpowers:systematic-debugging` before claiming done.

- [ ] **Step 5: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "chore: NFC tenant-aware verification verified (typecheck, build, probe, runbook)"
```

---

## Self-review notes (completed by plan author)

- **Spec coverage:** §1 routing → Tasks 4 (middleware passthrough), 5 (canonical page), 6 (legacy redirect); §2 DB → Task 1; §3 page → Task 5; §4 URL → Tasks 3, 7; §5 types → Task 2; §8 verification → Tasks 1, 8.
- **Scan-once guarantee:** `get_member_card` is a pure read (Task 1); `record_card_scan` is called only on the canonical render after the mismatch-redirect check (Task 5). Legacy redirect (Task 6) reads but never records.
- **Type consistency:** `MemberCard`/`PublicField` (Task 2) consumed by the page + legacy route (Tasks 5, 6); `verificationUrl(baseUrl, tenantSlug, cardSlug)` (Task 3) matches both call sites (Task 7); `record_card_scan` arg name `card_slug` matches Task 1 and the page call.
- **Known TGP visual change (accepted):** TGP's card loses its bespoke Fraternal/Lineage section headers (now one ordered list) and shows a neutral mark + "Tau Gamma Phi" (no `logo_url` set) — per spec §3, full theming is #5.
- **Out of scope confirmed absent:** no brand colors/seal theming, no custom-domain verify URLs, no schema-editing UI. `components/id-card.tsx` (private dashboard preview) untouched.
