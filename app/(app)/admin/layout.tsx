import { AdminNav } from "@/components/admin/admin-nav";
import { requireTenantAdmin } from "@/lib/auth";
import { TENANT_ROLE_META } from "@/lib/constants";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative role gate for the entire /admin area.
  const { role } = await requireTenantAdmin();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="tgp-eyebrow text-[10px] text-gold/70">
            Administration
          </p>
          <h1 className="tgp-display text-2xl font-bold tracking-tight sm:text-3xl">
            Registry Control
          </h1>
        </div>
        <span className="text-xs tracking-widest text-muted-foreground uppercase">
          {TENANT_ROLE_META[role ?? "admin"].label}
        </span>
      </header>

      <AdminNav />

      {children}
    </div>
  );
}
