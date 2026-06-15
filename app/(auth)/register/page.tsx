import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant } = await searchParams;
  const t = typeof tenant === "string" ? tenant : undefined;
  return (
    <AuthScreen
      mode="register"
      tenant={t}
      loginHref={t ? `/login?tenant=${encodeURIComponent(t)}` : "/login"}
      registerHref={t ? `/register?tenant=${encodeURIComponent(t)}` : "/register"}
    />
  );
}
