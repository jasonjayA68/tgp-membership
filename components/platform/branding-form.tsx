"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Paintbrush, Trash2, Upload } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  removeTenantLogo,
  updateTenantBranding,
  uploadTenantLogo,
  type PlatformState,
} from "@/lib/actions/platform";

const initial: PlatformState = {};

export function BrandingForm({
  tenantId,
  name,
  logoUrl,
  primaryColor,
  secondaryColor,
}: {
  tenantId: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}) {
  const [logoState, logoAction] = useActionState(uploadTenantLogo, initial);
  const [colorState, colorAction] = useActionState(updateTenantBranding, initial);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {logoState.error && (
          <Alert variant="danger">
            <CircleAlert />
            <span>{logoState.error}</span>
          </Alert>
        )}
        {logoState.notice && (
          <Alert variant="success">
            <CheckCircle2 />
            <span>{logoState.notice}</span>
          </Alert>
        )}
        <div className="flex items-start gap-3">
          <Brandmark name={name} logoUrl={logoUrl} className="size-12 text-base" />
          <div className="min-w-0 flex-1 space-y-1">
            <form action={logoAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tenantId" value={tenantId} />
              <Input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                required
                className="max-w-[220px]"
              />
              <SubmitButton size="sm" pendingText="Uploading…">
                <Upload />
                Upload logo
              </SubmitButton>
            </form>
            <p className="text-xs text-muted-foreground">PNG, JPG, or WebP · up to 2 MB.</p>
          </div>
        </div>
        {logoUrl && (
          <form action={removeTenantLogo}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <SubmitButton size="sm" variant="outline" pendingText="…">
              <Trash2 />
              Remove logo
            </SubmitButton>
          </form>
        )}
      </div>

      <form action={colorAction} className="space-y-3 border-t border-border pt-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        {colorState.error && (
          <Alert variant="danger">
            <CircleAlert />
            <span>{colorState.error}</span>
          </Alert>
        )}
        {colorState.notice && (
          <Alert variant="success">
            <CheckCircle2 />
            <span>{colorState.notice}</span>
          </Alert>
        )}
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
          Save colors
        </SubmitButton>
      </form>
    </div>
  );
}
