import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";
import { isTenantAdminRole } from "@/lib/constants";
import { toProfileView } from "@/lib/profile";
import type { Profile, ProfileWithChapter, Tenant, TenantRole } from "@/lib/types";

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: Tenant;
  role: TenantRole | null;
  profile: ProfileWithChapter | null;
}

/**
 * Loads the verified user, the active tenant, the user's membership role in
 * that tenant, and their (flattened) profile. Memoised per request. Uses
 * `getUser()` (server-verified) for authorization-grade identity.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenant = await getActiveTenant();

  const [membershipResult, profileResult] = await Promise.all([
    supabase
      .from("tenant_users")
      .select("role")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("*, chapter:chapters!profiles_chapter_id_fkey(*)")
      .eq("tenant_id", tenant.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;

  const row = profileResult.data as
    | (Profile & { chapter: ProfileWithChapter["chapter"] })
    | null;

  return {
    user: { id: user.id, email: user.email ?? null },
    tenant,
    role: (membershipResult.data?.role as TenantRole | null) ?? null,
    profile: row ? toProfileView(row) : null,
  };
});

/** Require an authenticated user; redirect to /login otherwise. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** Require a tenant admin or owner; redirect to /login or forbid otherwise. */
export async function requireTenantAdmin(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!isTenantAdminRole(auth.role)) forbidden();
  return auth;
}
