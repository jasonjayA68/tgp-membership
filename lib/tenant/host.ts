/**
 * Pure host helpers for custom-domain resolution. No imports — Node-testable via
 * lib/tenant/host.check.mts (run with `node`, excluded from tsc).
 */

/** Normalize a raw Host header to a bare lowercase hostname (or null). */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let h = raw.trim().toLowerCase();
  h = h.split(",")[0].trim();        // first value if a header list slipped through
  const at = h.lastIndexOf("@");     // defensive: strip any userinfo
  if (at !== -1) h = h.slice(at + 1);
  h = h.replace(/:\d+$/, "");        // strip :port
  h = h.replace(/\.$/, "");          // strip trailing dot (FQDN form)
  return h || null;
}

/**
 * Hosts that are unconditionally OUR app (path mode), checked WITHOUT a DB lookup.
 * NOTE: `*.vercel.app` is intentionally NOT blanket-canonical anymore — a tenant
 * may use a free `*.vercel.app` subdomain as its custom domain. The app's OWN
 * Vercel host (production + the current preview) is excluded separately in the
 * middleware via VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL, and any other
 * unknown host falls through to path mode (it resolves to no tenant).
 */
export function isCanonicalHost(host: string, appHost: string | null): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (appHost && host === appHost) return true; // configured canonical production host
  return false;
}
