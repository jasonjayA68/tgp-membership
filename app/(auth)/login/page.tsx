import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; tenant?: string }>;
}) {
  const { next, error, tenant } = await searchParams;
  const t = typeof tenant === "string" ? tenant : undefined;
  return (
    <AuthScreen
      mode="login"
      tenant={t}
      next={typeof next === "string" ? next : undefined}
      error={typeof error === "string" ? error : undefined}
      loginHref={t ? `/login?tenant=${encodeURIComponent(t)}` : "/login"}
      registerHref={t ? `/register?tenant=${encodeURIComponent(t)}` : "/register"}
    />
  );
}
