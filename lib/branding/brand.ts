import "server-only";

import type { CSSProperties } from "react";

import { buildTenantTheme } from "@/lib/branding/theme";
import { SITE } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";
import type { ResolvedTenant } from "@/lib/types";

export type Brand = { name: string; logoUrl: string | null };

/** The active tenant's brand on tenant surfaces; the platform default elsewhere. */
export async function getBrand(): Promise<Brand> {
  const tenant = await getActiveTenant();
  if (tenant) return { name: tenant.name, logoUrl: tenant.logo_url };
  return { name: SITE.name, logoUrl: null };
}

/** Inline `style` of CSS-variable overrides for a tenant's colors ({} = default). */
// NOTE: the theme cascades via the wrapper's inline CSS vars, so any future
// component that portals to document.body (Radix Dialog/Popover/Toast) renders
// outside the themed subtree and must re-apply this style or portal into it.
export function tenantThemeStyle(
  primary: string | null,
  secondary: string | null,
): CSSProperties {
  return buildTenantTheme(primary, secondary) as CSSProperties;
}

/** Resolve a tenant's public brand by slug (for ?tenant auth pages). Null → platform default. */
export async function brandForSlug(
  slug: string | undefined,
): Promise<{ brand: Brand; primary: string | null; secondary: string | null }> {
  if (slug) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_tenant_by_slug", { p_slug: slug });
    const t = data?.[0] as ResolvedTenant | undefined;
    if (t) {
      return {
        brand: { name: t.name, logoUrl: t.logo_url },
        primary: t.primary_color,
        secondary: t.secondary_color,
      };
    }
  }
  return { brand: { name: SITE.name, logoUrl: null }, primary: null, secondary: null };
}
