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

export const env = {
  SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  SUPABASE_KEY: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  /** Canonical production host (e.g. "tgp.example.com"); when set it is treated
   *  as path-mode, never a tenant custom domain. Optional — defaults to null. */
  APP_HOST: process.env.NEXT_PUBLIC_APP_HOST ?? null,
};
