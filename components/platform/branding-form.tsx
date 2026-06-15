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
        <Label htmlFor="primary_color">Primary color (accent)</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Primary color"
            defaultValue={primaryColor ?? "#e9b82e"}
            onChange={(e) => {
              const t = document.getElementById("primary_color") as HTMLInputElement | null;
              if (t) t.value = e.target.value;
            }}
            className="size-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          />
          <Input id="primary_color" name="primary_color" defaultValue={primaryColor ?? ""} placeholder="#e9b82e" />
        </div>
      </Field>
      <Field>
        <Label htmlFor="secondary_color">Secondary color (surface)</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Secondary color"
            defaultValue={secondaryColor ?? "#050505"}
            onChange={(e) => {
              const t = document.getElementById("secondary_color") as HTMLInputElement | null;
              if (t) t.value = e.target.value;
            }}
            className="size-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          />
          <Input id="secondary_color" name="secondary_color" defaultValue={secondaryColor ?? ""} placeholder="#050505" />
        </div>
      </Field>
      <SubmitButton size="sm" pendingText="Saving…">
        <Paintbrush />
        Save branding
      </SubmitButton>
    </form>
  );
}
