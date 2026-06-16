"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  CircleAlert,
  ImagePlus,
  Loader2,
  Paintbrush,
  Trash2,
} from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

/** Inline "Uploading…" indicator bound to the enclosing logo form. */
function UploadingNote() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gold">
      <Loader2 className="size-3.5 animate-spin" />
      Uploading…
    </span>
  );
}

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
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const form = input.form;
    const file = input.files?.[0];
    if (!file) {
      setPreview(null);
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      setClientError("Use a PNG, JPG, or WebP image.");
      input.value = "";
      setPreview(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please choose one under 2 MB.`,
      );
      input.value = "";
      setPreview(null);
      return;
    }
    setClientError(null);
    setPreview(URL.createObjectURL(file));
    // Upload immediately — no separate save button to miss.
    form?.requestSubmit();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <Brandmark name={name} logoUrl={preview ?? logoUrl} className="size-16 text-lg" />
          <form action={logoAction} className="flex flex-col gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input
              ref={inputRef}
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onFileChange}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                <ImagePlus />
                Choose logo
              </Button>
              <UploadingNote />
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, or WebP · up to 2 MB — uploads automatically.
            </p>
          </form>
        </div>

        {clientError && (
          <Alert variant="danger">
            <CircleAlert />
            <span>{clientError}</span>
          </Alert>
        )}
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
