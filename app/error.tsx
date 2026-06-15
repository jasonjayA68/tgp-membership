"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { PLATFORM } from "@/lib/constants";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brandmark name={PLATFORM.name} logoUrl={null} className="size-20 text-2xl" />
      <TriangleAlert className="size-9 text-destructive" />
      <div className="space-y-2">
        <p className="tgp-eyebrow text-xs text-gold/70">System Error</p>
        <h1 className="tgp-display text-2xl font-bold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred in the application. Please try
          again.
        </p>
      </div>
      <Button onClick={() => unstable_retry()} variant="outline">
        Try again
      </Button>
    </main>
  );
}
