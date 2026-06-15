"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { createTenant, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function CreateTenantForm() {
  const [state, formAction] = useActionState(createTenant, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{state.notice}</span>
        </Alert>
      )}

      <Field>
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" placeholder="e.g. Acme Alumni Association" required />
      </Field>
      <Field>
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" name="slug" placeholder="acme" required />
      </Field>
      <Field>
        <Label htmlFor="prefix">Member ID prefix</Label>
        <Input id="prefix" name="prefix" placeholder="ACME" required />
      </Field>

      <SubmitButton size="sm" pendingText="Creating…">
        <Plus />
        Create organization
      </SubmitButton>
    </form>
  );
}
