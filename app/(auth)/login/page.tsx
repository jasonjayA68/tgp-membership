import Link from "next/link";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { AuthForm } from "@/components/auth/auth-form";
import { brandForSlug, tenantThemeStyle } from "@/lib/branding/brand";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; tenant?: string }>;
}) {
  const { next, error, tenant } = await searchParams;
  const { brand, primary, secondary } = await brandForSlug(tenant);
  const themeStyle = tenantThemeStyle(primary, secondary);

  return (
    <div style={themeStyle} className="flex w-full flex-col items-center">
      <AuthBrandHeader name={brand.name} logoUrl={brand.logoUrl} />
      <Card className="mx-auto w-full max-w-md border-gold/30 tgp-frame tgp-glow">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Member Sign In</CardTitle>
        <CardDescription>
          {tenant
            ? `Sign in to continue to ${tenant}, or register to join.`
            : "Access your membership portal and digital ID."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error === "confirm" && (
          <Alert variant="danger">
            <CircleAlert />
            <span>
              That confirmation link is invalid or expired. Sign in or request a
              new one.
            </span>
          </Alert>
        )}
        <AuthForm
          mode="login"
          next={typeof next === "string" ? next : undefined}
          tenant={typeof tenant === "string" ? tenant : undefined}
        />
      </CardContent>
      <CardFooter className="justify-center border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          No account yet?{" "}
          <Link
            href={tenant ? `/register?tenant=${encodeURIComponent(tenant)}` : "/register"}
            className="font-medium text-gold underline-offset-4 hover:underline"
          >
            Register
          </Link>
        </p>
      </CardFooter>
      </Card>
    </div>
  );
}
