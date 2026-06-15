import Link from "next/link";
import { CircleAlert } from "lucide-react";

import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { AuthForm } from "@/components/auth/auth-form";
import { RegisterForm } from "@/components/auth/register-form";
import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { brandForSlug, tenantThemeStyle } from "@/lib/branding/brand";

/**
 * The shared auth screen (brand header + themed card + form + cross-link) used by
 * the global `(auth)` pages AND the tenant-scoped `/t/[slug]` routes. Server
 * component — resolves the tenant brand by slug (undefined slug = neutral
 * platform default).
 */
export async function AuthScreen({
  mode,
  tenant,
  next,
  error,
  loginHref,
  registerHref,
}: {
  mode: "login" | "register";
  tenant?: string;
  next?: string;
  error?: string;
  loginHref: string;
  registerHref: string;
}) {
  const { brand, primary, secondary } = await brandForSlug(tenant);
  const themeStyle = tenantThemeStyle(primary, secondary);
  const isLogin = mode === "login";

  return (
    <div style={themeStyle} className="relative isolate flex w-full flex-col items-center">
      <AuthBrandHeader name={brand.name} logoUrl={brand.logoUrl} />
      <Card
        className={`mx-auto w-full ${isLogin ? "max-w-md" : "max-w-2xl"} border-gold/30 tgp-frame tgp-glow`}
      >
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isLogin ? "Member Sign In" : "Apply for Membership"}
          </CardTitle>
          <CardDescription className={isLogin ? undefined : "mx-auto max-w-md"}>
            {isLogin
              ? tenant
                ? `Sign in to continue to ${brand.name}.`
                : "Access your membership portal and digital ID."
              : "Submit your registration. An administrator will review and approve your membership before your digital ID is issued."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLogin && error === "confirm" && (
            <Alert variant="danger">
              <CircleAlert />
              <span>
                That confirmation link is invalid or expired. Sign in or request a new one.
              </span>
            </Alert>
          )}
          {isLogin ? (
            <AuthForm mode="login" next={next} tenant={tenant} />
          ) : (
            <RegisterForm tenant={tenant} />
          )}
        </CardContent>
        <CardFooter className="justify-center border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            {isLogin ? "No account yet? " : "Already a member? "}
            <Link
              href={isLogin ? registerHref : loginHref}
              className="font-medium text-gold underline-offset-4 hover:underline"
            >
              {isLogin ? "Register" : "Sign in"}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
