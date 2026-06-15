import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database, ResolvedTenant } from "@/lib/types";

/**
 * Middleware-side tenant resolution. Uses a plain anon client (no cookies — the
 * RPC is SECURITY DEFINER and public) plus a short in-memory TTL cache so we
 * don't hit the DB on every request. Runs on the Node runtime (see proxy.ts).
 */
const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: { persistSession: false },
});

const TTL_MS = 60_000;
const cache = new Map<string, { tenant: ResolvedTenant | null; expires: number }>();

export async function resolveTenantForMiddleware(
  slug: string,
): Promise<ResolvedTenant | null> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && hit.expires > now) return hit.tenant;

  const { data, error } = await client.rpc("resolve_tenant_by_slug", {
    p_slug: slug,
  });
  const tenant = error || !data?.[0] ? null : (data[0] as ResolvedTenant);
  cache.set(slug, { tenant, expires: now + TTL_MS });
  return tenant;
}
