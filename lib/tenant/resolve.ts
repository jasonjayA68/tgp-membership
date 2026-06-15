import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database, ResolvedTenant } from "@/lib/types";

/**
 * Middleware-side tenant resolution. Uses a plain anon client (no cookies — the
 * RPCs are SECURITY DEFINER and public) plus a short in-memory TTL cache so we
 * don't hit the DB on every request. Runs on the Node runtime (see proxy.ts).
 *
 * The cache is namespaced ("slug:" vs "host:") so a slug and a host can never
 * collide on the same key.
 */
const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY, {
  auth: { persistSession: false },
});

const TTL_MS = 60_000;
const NEG_TTL_MS = 5_000;
const cache = new Map<string, { tenant: ResolvedTenant | null; expires: number }>();

async function resolveCached(
  key: string,
  fetcher: () => Promise<ResolvedTenant | null>,
): Promise<ResolvedTenant | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.tenant;

  const tenant = await fetcher();
  cache.set(key, { tenant, expires: now + (tenant ? TTL_MS : NEG_TTL_MS) });
  return tenant;
}

/** Resolve a tenant by its `/t/[slug]` slug (returns suspended tenants too). */
export async function resolveTenantForMiddleware(
  slug: string,
): Promise<ResolvedTenant | null> {
  return resolveCached(`slug:${slug}`, async () => {
    const { data, error } = await client.rpc("resolve_tenant_by_slug", {
      p_slug: slug,
    });
    return error || !data?.[0] ? null : (data[0] as ResolvedTenant);
  });
}

/** Resolve a tenant by verified, active custom domain (host). */
export async function resolveTenantByHost(
  host: string,
): Promise<ResolvedTenant | null> {
  return resolveCached(`host:${host}`, async () => {
    const { data, error } = await client.rpc("resolve_tenant_by_host", {
      p_host: host,
    });
    return error || !data?.[0] ? null : (data[0] as ResolvedTenant);
  });
}
