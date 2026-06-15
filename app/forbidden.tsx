import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Button } from "@/components/ui/button";
import { getBrand } from "@/lib/branding/brand";
import { getActiveTenantBasePath } from "@/lib/tenant/context";
import { tenantHref } from "@/lib/tenant/links";

export default async function Forbidden() {
  const basePath = await getActiveTenantBasePath();
  const portalHref = basePath ? tenantHref(basePath, "/dashboard") : "/";
  const brand = await getBrand();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brandmark name={brand.name} logoUrl={brand.logoUrl} className="size-20 text-2xl" />
      <ShieldX className="size-9 text-destructive" />
      <div className="space-y-2">
        <p className="tgp-eyebrow text-xs text-gold/70">403 — Forbidden</p>
        <h1 className="tgp-display text-2xl font-bold">Restricted Area</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You do not have the administrative privileges required to view this
          section.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={portalHref}>Return to portal</Link>
      </Button>
    </main>
  );
}
