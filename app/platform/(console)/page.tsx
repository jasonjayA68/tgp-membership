import Link from "next/link";
import type { Metadata } from "next";
import { Building2, Settings2, Users, ArchiveRestore } from "lucide-react";

import { CreateTenantForm } from "@/components/platform/create-tenant-form";
import { TenantStatusBadge } from "@/components/platform/tenant-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { restoreTenant } from "@/lib/actions/platform";
import { listTenantsWithStats } from "@/lib/platform";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Platform Console" };

function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "gold" }) {
  return (
    <Card className="p-4">
      <div className={cn("tgp-display text-2xl font-bold", tone === "gold" ? "text-gold" : "text-foreground")}>
        {value}
      </div>
      <div className="text-[11px] tracking-widest text-muted-foreground uppercase">{label}</div>
    </Card>
  );
}

export default async function PlatformPage() {
  const tenants = await listTenantsWithStats();
  const active = tenants.filter((t) => t.status !== "archived");
  const archived = tenants.filter((t) => t.status === "archived");
  const totalMembers = active.reduce((n, t) => n + t.member_count, 0);
  const totalActive = active.reduce((n, t) => n + t.active_count, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Organizations" value={active.length} tone="gold" />
          <Stat label="Total Members" value={totalMembers} />
          <Stat label="Active Members" value={totalActive} />
        </div>

        <Card className="divide-y divide-border">
          {active.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No organizations yet. Create the first one.
            </p>
          ) : (
            active.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 p-3">
                <Building2 className="size-5 text-gold" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/platform/tenants/${t.id}`}
                    className="block truncate font-medium text-foreground hover:text-gold"
                  >
                    {t.name}
                  </Link>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="tgp-mono">/{t.slug}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3" />
                      {t.active_count}/{t.member_count}
                    </span>
                  </div>
                </div>
                <TenantStatusBadge status={t.status} />
                <Button asChild size="sm" variant="outline">
                  <Link href={`/platform/tenants/${t.id}`}>
                    <Settings2 />
                    Manage
                  </Link>
                </Button>
              </div>
            ))
          )}
        </Card>

        {archived.length > 0 && (
          <Card className="divide-y divide-border">
            <p className="px-3 pt-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Archived
            </p>
            {archived.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 p-3 opacity-70">
                <Building2 className="size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/platform/tenants/${t.id}`}
                    className="block truncate font-medium text-foreground hover:text-gold"
                  >
                    {t.name}
                  </Link>
                  <span className="tgp-mono text-xs text-muted-foreground">/{t.slug}</span>
                </div>
                <form action={restoreTenant}>
                  <input type="hidden" name="tenantId" value={t.id} />
                  <SubmitButton size="sm" variant="outline" pendingText="…">
                    <ArchiveRestore />
                    Restore
                  </SubmitButton>
                </form>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Card className="h-fit p-5">
        <h2 className="tgp-display mb-3 text-sm font-semibold tracking-wide">New organization</h2>
        <CreateTenantForm />
      </Card>
    </div>
  );
}
