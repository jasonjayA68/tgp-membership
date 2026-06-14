import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/constants";
import type { ProfileWithChapter } from "@/lib/types";

export interface AuthContext {
  user: { id: string; email: string | null };
  profile: ProfileWithChapter | null;
}

/**
 * Loads the verified user and their profile (with chapter) for the current
 * request. Memoised per-request with React `cache` so multiple callers in one
 * render share a single round-trip. Uses `getUser()` (server-verified), never
 * `getSession()`, for authorization-grade identity.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*, chapter:chapters!profiles_chapter_id_fkey(*)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: (profile as ProfileWithChapter | null) ?? null,
  };
});

/** Require an authenticated user; redirect to /login otherwise. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** Require an admin or super_admin; redirect/forbid otherwise. */
export async function requireAdmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!isAdminRole(auth.profile?.role)) forbidden();
  return auth;
}
