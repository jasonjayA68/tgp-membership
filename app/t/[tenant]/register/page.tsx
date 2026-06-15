import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Register" };

export default async function TenantRegisterPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  if (await getSessionUser()) redirect(`/t/${tenant}/dashboard`);

  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      <AuthScreen
        mode="register"
        tenant={tenant}
        loginHref={`/t/${tenant}/login`}
        registerHref={`/t/${tenant}/register`}
      />
    </main>
  );
}
