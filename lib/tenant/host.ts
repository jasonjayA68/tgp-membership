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

/** Hosts that are OUR app (path mode) and must never be treated as a tenant custom domain. */
export function isCanonicalHost(host: string, appHost: string | null): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".vercel.app")) return true; // preview + prod *.vercel.app
  if (appHost && host === appHost) return true;  // configured canonical production host
  return false;
}
