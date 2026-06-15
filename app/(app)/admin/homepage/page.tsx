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
