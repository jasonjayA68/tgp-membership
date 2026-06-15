import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";

import { isFeatureEnabled, type FeatureKey } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";

/** The active tenant's feature-flag overrides (key → enabled). Memoised per request. */
export const getActiveTenantFeatures = cache(async (): Promise<Record<string, boolean>> => {
  const tenant = await getActiveTenant();
  if (!tenant) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("feature_key, enabled")
    .eq("tenant_id", tenant.id);
  const map: Record<string, boolean> = {};
  for (const row of data ?? []) map[row.feature_key] = row.enabled;
  return map;
});

/** Functional gate for a route: 404 if the active tenant has the feature disabled. */
export async function requireFeature(key: FeatureKey): Promise<void> {
  const flags = await getActiveTenantFeatures();
  if (!isFeatureEnabled(flags, key)) notFound();
}
