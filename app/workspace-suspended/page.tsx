import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Workspace suspended" };

export default function WorkspaceSuspended() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <ShieldAlert className="size-12 text-destructive" />
      <h1 className="tgp-display mt-4 text-2xl font-bold">Workspace suspended</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        This organization workspace is currently suspended. Contact your
        administrator for details.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
