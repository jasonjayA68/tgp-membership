"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Save } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateTenant, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function EditOrgForm({
  tenantId,
  name,
  slug,
  prefix,
}: {
  tenantId: string;
  name: string;
  slug: string;
  prefix: string;
}) {
  const [state, formAction] = useActionState(updateTenant, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
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
        <Input id="name" name="name" defaultValue={name} required />
      </Field>
      <Field>
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" name="slug" defaultValue={slug} required />
        <p className="text-xs text-amber-500">
          Changing the slug breaks existing /t/{slug} links and QR codes. Custom domains are
          unaffected.
        </p>
      </Field>
      <Field>
        <Label htmlFor="prefix">Member ID prefix</Label>
        <Input id="prefix" name="prefix" defaultValue={prefix} required />
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        <Save />
        Save changes
      </SubmitButton>
    </form>
  );
}
