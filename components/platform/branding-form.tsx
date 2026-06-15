"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Paintbrush } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateTenantBranding, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function BrandingForm({
  tenantId,
  logoUrl,
  primaryColor,
  secondaryColor,
}: {
  tenantId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  const [state, formAction] = useActionState(updateTenantBranding, initialState);

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
        <Label htmlFor="logo_url">Logo URL</Label>
        <Input id="logo_url" name="logo_url" defaultValue={logoUrl ?? ""} placeholder="https://…/logo.png" />
      </Field>
      <Field>
        <Label htmlFor="primary_color">Primary color</Label>
        <Input id="primary_color" name="primary_color" defaultValue={primaryColor ?? ""} placeholder="#C8A24B" />
      </Field>
      <Field>
        <Label htmlFor="secondary_color">Secondary color</Label>
        <Input id="secondary_color" name="secondary_color" defaultValue={secondaryColor ?? ""} placeholder="#0B0B0C" />
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        <Paintbrush />
        Save branding
      </SubmitButton>
    </form>
  );
}
