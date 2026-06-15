import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";
import { isTenantAdminRole } from "@/lib/constants";
import { toProfileView } from "@/lib/profile";
import type {
  Profile,
  ProfileWithChapter,
  ResolvedTenant,
  TenantRole,
} from "@/lib/types";

export interface AuthContext {
  user: { id: string; email: string | null };
  tenant: ResolvedTenant;
  role: TenantRole | null; // null = logged-in non-member of this tenant
  profile: ProfileWithChapter | null;
}

export interface Membership {
  role: TenantRole;
  tenant: ResolvedTenant;
}

/** The verified session user, or null. */
export async function getSessionUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}

/**
 * All tenants the current user belongs to (for the root workspace switcher).
 * Two-step (no PostgREST embed) — the hand-authored `Database` type gives
 * `tenant_users` an empty `Relationships`, so an embed wouldn't type-check.
 * RLS lets a member read their own tenant rows.
 */
export async function listMemberships(): Promise<Membership[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows, error } = await supabase
    .from("tenant_users")
    .select("role, tenant_id")
    .eq("user_id", user.id);
  if (error) throw error;
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.tenant_id);
  const { data: tenants, error: tErr } = await supabase
    .from("tenants")
    .select("id, name, slug, status, logo_url, primary_color, secondary_color")
    .in("id", ids);
  if (tErr) throw tErr;

  const byId = new Map(
    (tenants ?? []).map((t) => [t.id, t as ResolvedTenant]),
  );
  return rows
    .map((r) => {
      const tenant = byId.get(r.tenant_id);
      return tenant ? { role: r.role as TenantRole, tenant } : null;
    })
    .filter((m): m is Membership => m !== null);
}

/**
 * Verified user + active tenant (from the request header) + the user's
 * membership role + flattened profile for THAT tenant. Returns null when there
 * is no session or no active tenant (a global route). A non-member of the active
 * tenant gets `role: null` / `profile: null`. Memoised per request.
 */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const tenant = await getActiveTenant();
  if (!tenant) return null;

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

/** Require an authenticated user in the active tenant context. */
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
