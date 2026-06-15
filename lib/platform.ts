import "server-only";

import { forbidden, redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Tenant, TenantRole } from "@/lib/types";

/**
 * Bootstrap allowlist (server-only env). Any email listed in PLATFORM_ADMIN_EMAILS
 * (comma-separated) is treated as a platform admin WITHOUT a platform_admins row.
 * This is the standard way to seed the first super admin(s) — it removes the
 * chicken-and-egg of having to manually insert the very first DB grant, and is
 * immune to email-string / RLS / session-state pitfalls. DB rows handle the rest.
 */
function bootstrapAdminEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True if this user is a platform admin via the env allowlist OR a DB row. */
async function checkPlatformAdmin(
  user: { id: string; email: string | null } | null,
): Promise<boolean> {
  if (!user) return false;
  if (user.email && bootstrapAdminEmails().has(user.email.toLowerCase())) {
    return true;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Page/layout guard: require a platform admin. Tenant-independent — it does NOT
 * use getAuth() (which needs an active tenant). No session → /platform/login; an
 * authenticated non-platform-admin → forbidden().
 */
export async function requirePlatformAdmin(): Promise<{
  id: string;
  email: string | null;
}> {
  const user = await getSessionUser();
  if (!user) redirect("/platform/login");
  if (!(await checkPlatformAdmin(user))) forbidden();
  return user;
}

/** Boolean platform-admin check (no redirect) — for conditional UI. */
export async function isPlatformAdmin(): Promise<boolean> {
  return checkPlatformAdmin(await getSessionUser());
}

export type TenantWithStats = Tenant & {
  member_count: number;
  active_count: number;
};

/** All tenants + per-tenant counts (platform admin reads all via RLS). */
export async function listTenantsWithStats(): Promise<TenantWithStats[]> {
  const supabase = await createClient();
  const [tenantsResult, statsResult] = await Promise.all([
    supabase.from("tenants").select("*").order("created_at", { ascending: true }),
    supabase.rpc("platform_tenant_stats"),
  ]);
  if (tenantsResult.error) throw tenantsResult.error;
  if (statsResult.error) throw statsResult.error;

  const statsById = new Map((statsResult.data ?? []).map((s) => [s.tenant_id, s]));
  return (tenantsResult.data ?? []).map((t) => {
    const s = statsById.get(t.id);
    return {
      ...(t as Tenant),
      member_count: Number(s?.member_count ?? 0),
      active_count: Number(s?.active_count ?? 0),
    };
  });
}

export type TenantAdmin = { user_id: string; role: TenantRole; name: string };

/** A tenant's owners/admins with display names (two-step; no FK / no email). */
export async function listTenantAdmins(tenantId: string): Promise<TenantAdmin[]> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "admin"]);
  if (error) throw error;
  if (!rows?.length) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .eq("tenant_id", tenantId)
    .in("user_id", ids);
  const nameByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role as TenantRole,
    name: nameByUser.get(r.user_id) || "—",
  }));
}
