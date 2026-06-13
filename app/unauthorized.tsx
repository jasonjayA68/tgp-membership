import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { TgpSeal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";

export default function Unauthorized() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <TgpSeal className="size-20 rounded-full opacity-90" />
      <LockKeyhole className="size-9 text-gold" />
      <div className="space-y-2">
        <p className="tgp-eyebrow text-xs text-gold/70">401 — Unauthorized</p>
        <h1 className="tgp-display text-2xl font-bold">Sign In Required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          You must be signed in to access this part of the membership registry.
        </p>
      </div>
      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
