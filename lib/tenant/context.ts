import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types";

/**
 * Default tenant for the foundation phase. Real per-request resolution
 * (custom domain / `/t/[slug]`) arrives in Sub-project 2 — this function is
 * the seam it will replace.
 */
export const DEFAULT_TENANT_SLUG = "tgp";

/** The active tenant for the current request. Memoised per request. */
export const getActiveTenant = cache(async (): Promise<Tenant> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("slug", DEFAULT_TENANT_SLUG)
    .single();
  if (error) {
    throw new Error(`Active tenant "${DEFAULT_TENANT_SLUG}" not found: ${error.message}`);
  }
  return data as Tenant;
});
