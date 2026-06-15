import { AppNav } from "@/components/app/app-nav";
import { requireUser } from "@/lib/auth";
import { isTenantAdminRole, SITE } from "@/lib/constants";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role } = await requireUser();

  return (
    <div className="flex min-h-svh flex-col">
      <AppNav isAdmin={isTenantAdminRole(role)} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {SITE.legalName} · {SITE.motto} · Est. {SITE.founded}
      </footer>
    </div>
  );
}
