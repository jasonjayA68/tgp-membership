import Link from "next/link";

import { TgpSeal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <TgpSeal className="size-20 rounded-full opacity-90" />
      <div className="space-y-2">
        <p className="tgp-eyebrow text-xs text-gold/70">404 — Not Found</p>
        <h1 className="tgp-display text-2xl font-bold">Page Not Found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you are looking for is not part of the registry.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Return home</Link>
      </Button>
    </main>
  );
}
