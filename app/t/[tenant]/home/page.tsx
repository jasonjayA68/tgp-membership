import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { Brandmark } from "@/components/brand/brandmark";
import { BlockRenderer } from "@/components/cms/home-blocks";
import { Button } from "@/components/ui/button";
import { tenantThemeStyle } from "@/lib/branding/brand";
import { DEFAULT_HOME, HomeContentSchema } from "@/lib/cms/blocks";
import { HOMEPAGE } from "@/lib/constants";
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
  if (!home.homepage_enabled) notFound();

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
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/t/${home.tenant_slug}/login`}>Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/t/${home.tenant_slug}/register`}>Apply for membership</Link>
            </Button>
          </div>
        </div>
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
  );
}
