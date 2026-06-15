import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Button } from "@/components/ui/button";
import { getBrand } from "@/lib/branding/brand";

export default async function Unauthorized() {
  const brand = await getBrand();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brandmark name={brand.name} logoUrl={brand.logoUrl} className="size-20 text-2xl" />
      <LockKeyhole className="size-9 text-gold" />
      <div className="space-y-2">
        <p className="tgp-eyebrow text-xs text-gold/70">401 — Unauthorized</p>
        <h1 className="tgp-display text-2xl font-bold">Sign In Required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You must be signed in to access this area.
        </p>
      </div>
      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
