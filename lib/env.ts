/**
 * Centralised, validated access to the public Supabase credentials.
 * Only the publishable (anon) key is ever referenced — the service-role key
 * must never be imported into the app bundle.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

/** Parse the bare hostname out of a URL (e.g. NEXT_PUBLIC_SITE_URL), or null. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export const env = {
  SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  SUPABASE_KEY: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  /** Canonical production host (e.g. "registry.taugammaphi.org"); always treated
   *  as path-mode, never a tenant custom domain. Defaults to the host of
   *  NEXT_PUBLIC_SITE_URL so the primary site is recognized without extra config;
   *  NEXT_PUBLIC_APP_HOST overrides when the two differ. */
  APP_HOST:
    process.env.NEXT_PUBLIC_APP_HOST ?? hostOf(process.env.NEXT_PUBLIC_SITE_URL),
};
