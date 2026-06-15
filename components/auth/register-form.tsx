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
import { signUp, type AuthState } from "@/lib/actions/auth";

const initialState: AuthState = {};

function SectionHeading({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <h3 className="tgp-eyebrow text-[10px] text-gold/80">
        {children}
        {hint && (
          <span className="ml-1.5 font-normal tracking-normal text-muted-foreground/60 normal-case">
            {hint}
          </span>
        )}
      </h3>
      <span className="h-px flex-1 tgp-rule" />
    </div>
  );
}

export function RegisterForm({ tenant }: { tenant?: string }) {
  const [state, formAction] = useActionState(signUp, initialState);
  const errors = state.fieldErrors;

  if (state.notice) {
    return (
      <Alert variant="success">
        <MailCheck />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Check your inbox</p>
          <p>{state.notice}</p>
          <Link
            href="/login"
            className="inline-block text-gold underline-offset-4 hover:underline"
          >
            Return to sign in
          </Link>
        </div>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}

      {tenant && <input type="hidden" name="tenantSlug" value={tenant} />}

      <SectionHeading>Account</SectionHeading>

      <Field>
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          placeholder="Juan Dela Cruz"
          aria-invalid={!!errors?.fullName}
          required
        />
        <FieldError messages={errors?.fullName} />
      </Field>

      <Field>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={!!errors?.email}
          required
        />
        <FieldError messages={errors?.email} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            aria-invalid={!!errors?.password}
            required
          />
          <FieldError messages={errors?.password} />
        </Field>
        <Field>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Re-enter password"
            aria-invalid={!!errors?.confirmPassword}
            required
          />
          <FieldError messages={errors?.confirmPassword} />
        </Field>
      </div>

      <SectionHeading hint="· optional, can be added later">
        Fraternal Information
      </SectionHeading>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="alexisName">Alexis name</Label>
          <Input id="alexisName" name="alexisName" placeholder="Fraternal alias" />
          <FieldError messages={errors?.alexisName} />
        </Field>
        <Field>
          <Label htmlFor="batchName">Batch name</Label>
          <Input
            id="batchName"
            name="batchName"
            placeholder="e.g. Batch Maharlika"
          />
          <FieldError messages={errors?.batchName} />
        </Field>
        <Field>
          <Label htmlFor="dateSurvived">Date survived</Label>
          <Input
            id="dateSurvived"
            name="dateSurvived"
            type="date"
            aria-invalid={!!errors?.dateSurvived}
          />
          <FieldError messages={errors?.dateSurvived} />
        </Field>
        <Field>
          <Label htmlFor="contactNumber">Contact number</Label>
          <Input
            id="contactNumber"
            name="contactNumber"
            type="tel"
            inputMode="tel"
            placeholder="+63 9XX XXX XXXX"
          />
          <FieldError messages={errors?.contactNumber} />
        </Field>
        <Field>
          <Label htmlFor="gtName">GT (when survived)</Label>
          <Input id="gtName" name="gtName" placeholder="Grand Triskelion" />
          <FieldError messages={errors?.gtName} />
        </Field>
        <Field>
          <Label htmlFor="gtNumber">GT&apos;s contact</Label>
          <Input id="gtNumber" name="gtNumber" type="tel" inputMode="tel" />
          <FieldError messages={errors?.gtNumber} />
        </Field>
        <Field>
          <Label htmlFor="mwwName">MWW (when survived)</Label>
          <Input id="mwwName" name="mwwName" />
          <FieldError messages={errors?.mwwName} />
        </Field>
        <Field>
          <Label htmlFor="mwwNumber">MWW&apos;s contact</Label>
          <Input id="mwwNumber" name="mwwNumber" type="tel" inputMode="tel" />
          <FieldError messages={errors?.mwwNumber} />
        </Field>
      </div>

      <SubmitButton size="lg" className="w-full" pendingText="Submitting…">
        Submit registration
      </SubmitButton>
    </form>
  );
}
