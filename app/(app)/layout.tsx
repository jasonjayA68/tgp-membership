import { AppNav } from "@/components/app/app-nav";
import { JoinWorkspace } from "@/components/app/join-workspace";
import { requireUser } from "@/lib/auth";
import { isTenantAdminRole, SITE } from "@/lib/constants";
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

  return (
    <div className="flex min-h-svh flex-col">
      <AppNav basePath={basePath} isAdmin={isTenantAdminRole(role)} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {SITE.legalName} · {SITE.motto} · Est. {SITE.founded}
      </footer>
    </div>
  );
}
