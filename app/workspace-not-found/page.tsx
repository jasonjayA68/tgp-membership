import Link from "next/link";
import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Workspace not found" };

export default function WorkspaceNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <Building2 className="size-12 text-muted-foreground" />
      <h1 className="tgp-display mt-4 text-2xl font-bold">Workspace not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        This organization workspace doesn&apos;t exist or its address has changed.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
