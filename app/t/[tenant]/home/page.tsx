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
