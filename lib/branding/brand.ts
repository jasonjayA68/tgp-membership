import "server-only";

import type { CSSProperties } from "react";

import { buildTenantTheme } from "@/lib/branding/theme";
import { SITE } from "@/lib/constants";
import { getActiveTenant } from "@/lib/tenant/context";

export type Brand = { name: string; logoUrl: string | null };

/** The active tenant's brand on tenant surfaces; the platform default elsewhere. */
export async function getBrand(): Promise<Brand> {
  const tenant = await getActiveTenant();
  if (tenant) return { name: tenant.name, logoUrl: tenant.logo_url };
  return { name: SITE.name, logoUrl: null };
}

/** Inline `style` of CSS-variable overrides for a tenant's colors ({} = default). */
export function tenantThemeStyle(
  primary: string | null,
  secondary: string | null,
): CSSProperties {
  return buildTenantTheme(primary, secondary) as CSSProperties;
}
