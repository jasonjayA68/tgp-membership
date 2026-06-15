import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { ResolvedTenant } from "@/lib/types";

/**
 * The active tenant for the current request, resolved from the trusted
 * `x-tenant-slug` header that middleware injects (after stripping any
 * client-supplied value). Returns null on global routes (no tenant context).
 * Memoised per request.
 */
export const getActiveTenant = cache(async (): Promise<ResolvedTenant | null> => {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_tenant_by_slug", {
    p_slug: slug,
  });
  if (error || !data?.[0]) return null;
  return data[0] as ResolvedTenant;
});

/** The active tenant's link base path (e.g. "/t/tgp"; "" on a custom domain). */
export async function getActiveTenantBasePath(): Promise<string> {
  return (await headers()).get("x-tenant-basepath") ?? "";
}
