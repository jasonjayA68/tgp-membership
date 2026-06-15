import { AppNav } from "@/components/app/app-nav";
import { JoinWorkspace } from "@/components/app/join-workspace";
import { tenantThemeStyle } from "@/lib/branding/brand";
import { requireUser } from "@/lib/auth";
import { isTenantAdminRole } from "@/lib/constants";
import { getActiveTenantBasePath } from "@/lib/tenant/context";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, tenant } = await requireUser();

  // Logged-in non-member of this workspace → offer to join.
  if (!role) {
    return <JoinWorkspace tenant={tenant} />;
  }

  const basePath = await getActiveTenantBasePath();
  const themeStyle = tenantThemeStyle(tenant.primary_color, tenant.secondary_color);

  return (
    <div style={themeStyle} className="flex min-h-svh flex-col bg-background">
      <AppNav
        basePath={basePath}
        isAdmin={isTenantAdminRole(role)}
        brand={{ name: tenant.name, logoUrl: tenant.logo_url }}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        © {tenant.name}
      </footer>
    </div>
  );
}
