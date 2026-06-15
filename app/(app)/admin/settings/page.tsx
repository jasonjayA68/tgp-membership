import type { Metadata } from "next";

import { FeatureSettings } from "@/components/admin/feature-settings";
import { requireTenantAdmin } from "@/lib/auth";
import { getActiveTenantFeatures } from "@/lib/tenant/features";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireTenantAdmin();
  const flags = await getActiveTenantFeatures();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="tgp-display text-xl font-bold tracking-tight">Modules</h2>
        <p className="text-sm text-muted-foreground">
          Enable or disable features for your organization. Changes apply immediately and never
          delete data.
        </p>
      </div>
      <FeatureSettings flags={flags} />
    </div>
  );
}
