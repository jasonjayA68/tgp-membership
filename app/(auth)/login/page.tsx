import Link from "next/link";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { AuthForm } from "@/components/auth/auth-form";
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
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <Card className="mx-auto w-full max-w-md border-gold/30 tgp-frame tgp-glow">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Member Sign In</CardTitle>
        <CardDescription>
          Access your membership portal and digital ID.
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
        <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />
      </CardContent>
      <CardFooter className="justify-center border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          No account yet?{" "}
          <Link
            href="/register"
            className="font-medium text-gold underline-offset-4 hover:underline"
          >
            Register
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
