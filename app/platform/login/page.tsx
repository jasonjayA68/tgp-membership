import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { AuthForm } from "@/components/auth/auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORM } from "@/lib/constants";
import { isPlatformAdmin } from "@/lib/platform";

export const metadata: Metadata = { title: "Administrator Sign In" };

export default async function PlatformLoginPage() {
  // Already a platform admin → straight to the console.
  if (await isPlatformAdmin()) redirect("/platform");

  return (
    <main className="relative isolate flex min-h-svh w-full flex-col items-center justify-center px-4 py-16">
      <AuthBrandHeader name={PLATFORM.name} logoUrl={null} />
      <Card className="mx-auto w-full max-w-md border-gold/30 tgp-frame tgp-glow">
        <CardHeader className="text-center">
          <p className="tgp-eyebrow text-[10px] text-gold/70">Super Admin</p>
          <CardTitle className="text-2xl">Administrator Sign In</CardTitle>
          <CardDescription>
            Access the platform console to manage organizations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AuthForm mode="login" next="/platform" />
        </CardContent>
      </Card>
    </main>
  );
}
