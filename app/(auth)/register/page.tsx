import Link from "next/link";
import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant } = await searchParams;

  return (
    <Card className="mx-auto w-full max-w-2xl border-gold/30 tgp-frame tgp-glow">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Apply for Membership</CardTitle>
        <CardDescription className="mx-auto max-w-md">
          Submit your registration. An administrator will review and approve
          your membership before your digital ID is issued.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm tenant={typeof tenant === "string" ? tenant : undefined} />
      </CardContent>
      <CardFooter className="justify-center border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          Already a member?{" "}
          <Link
            href={tenant ? `/login?tenant=${encodeURIComponent(tenant)}` : "/login"}
            className="font-medium text-gold underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
