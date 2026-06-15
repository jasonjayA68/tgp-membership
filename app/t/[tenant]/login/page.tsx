import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function TenantLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { tenant } = await params;
  const { next, error } = await searchParams;
  const dest = typeof next === "string" ? next : `/t/${tenant}/dashboard`;

  // Already signed in → go straight to the destination.
  if (await getSessionUser()) redirect(dest);

  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      <AuthScreen
        mode="login"
        tenant={tenant}
        next={dest}
        error={typeof error === "string" ? error : undefined}
        loginHref={`/t/${tenant}/login`}
        registerHref={`/t/${tenant}/register`}
      />
    </main>
  );
}
