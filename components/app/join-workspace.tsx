import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestToJoin } from "@/lib/actions/auth";
import type { ResolvedTenant } from "@/lib/types";

export function JoinWorkspace({ tenant }: { tenant: ResolvedTenant }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <Building2 className="size-12 text-gold" />
      <h1 className="tgp-display mt-4 text-2xl font-bold">
        Join {tenant.name}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        You&apos;re signed in but not yet a member of this workspace. Request to
        join — an administrator will review your membership.
      </p>
      <form action={requestToJoin} className="mt-6">
        <input type="hidden" name="tenantSlug" value={tenant.slug} />
        <SubmitButton pendingText="Requesting…">Request to join</SubmitButton>
      </form>
    </main>
  );
}
