import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";
import type { Database } from "@/lib/types";

/**
 * Supabase client for use in Client Components (browser).
 * Cookie handling is automatic; never pass the service-role key here.
 */
export function createClient() {
  return createBrowserClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY);
}
