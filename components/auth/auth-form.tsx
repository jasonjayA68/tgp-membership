"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CircleAlert, MailCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { signIn, signUp, type AuthState } from "@/lib/actions/auth";

const initialState: AuthState = {};

export function AuthForm({
  mode,
  next,
}: {
  mode: "login" | "register";
  next?: string;
}) {
  const isRegister = mode === "register";
  const action = isRegister ? signUp : signIn;
  const [state, formAction] = useActionState(action, initialState);

  if (state.notice) {
    return (
      <Alert variant="success">
        <MailCheck />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Check your inbox</p>
          <p>{state.notice}</p>
          <Link href="/login" className="inline-block text-gold underline-offset-4 hover:underline">
            Return to sign in
          </Link>
        </div>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}

      {isRegister && (
        <Field>
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            placeholder="Juan Dela Cruz"
            aria-invalid={!!state.fieldErrors?.fullName}
            required
          />
          <FieldError messages={state.fieldErrors?.fullName} />
        </Field>
      )}

      <Field>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={!!state.fieldErrors?.email}
          required
        />
        <FieldError messages={state.fieldErrors?.email} />
      </Field>

      <Field>
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          placeholder="••••••••"
          aria-invalid={!!state.fieldErrors?.password}
          required
        />
        <FieldError messages={state.fieldErrors?.password} />
      </Field>

      {!isRegister && <input type="hidden" name="next" value={next ?? "/dashboard"} />}

      <SubmitButton
        size="lg"
        className="w-full"
        pendingText={isRegister ? "Submitting…" : "Verifying…"}
      >
        {isRegister ? "Submit registration" : "Sign in"}
      </SubmitButton>
    </form>
  );
}
