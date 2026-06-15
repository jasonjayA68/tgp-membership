import Link from "next/link";

import { Brandmark } from "@/components/brand/brandmark";
import { Button } from "@/components/ui/button";
import { getBrand } from "@/lib/branding/brand";

export default async function NotFound() {
  const brand = await getBrand();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brandmark name={brand.name} logoUrl={brand.logoUrl} className="size-20 text-2xl" />
      <div className="space-y-2">
        <p className="tgp-eyebrow text-xs text-gold/70">404 — Not Found</p>
        <h1 className="tgp-display text-2xl font-bold">Page Not Found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you are looking for could not be found.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Return home</Link>
      </Button>
    </main>
  );
}
