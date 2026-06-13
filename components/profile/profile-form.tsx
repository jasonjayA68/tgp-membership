"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateProfile, type ProfileState } from "@/lib/actions/profile";

const initialState: ProfileState = {};

export interface ProfileDefaults {
  fullName: string;
  contactNumber: string;
  batchYear: number | null;
  alexisName: string;
  batchName: string;
  dateSurvived: string;
  gtName: string;
  gtNumber: string;
  mwwName: string;
  mwwNumber: string;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h3 className="tgp-eyebrow text-[10px] text-gold/80">{children}</h3>
      <span className="h-px flex-1 tgp-rule" />
    </div>
  );
}

export function ProfileForm({ defaults }: { defaults: ProfileDefaults }) {
  const [state, formAction] = useActionState(updateProfile, initialState);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5">
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
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          defaultValue={defaults.fullName}
          aria-invalid={!!errors?.fullName}
          required
        />
        <FieldError messages={errors?.fullName} />
      </Field>

      <Field>
        <Label htmlFor="contactNumber">Contact number</Label>
        <Input
          id="contactNumber"
          name="contactNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+63 9XX XXX XXXX"
          defaultValue={defaults.contactNumber}
          aria-invalid={!!errors?.contactNumber}
        />
        <p className="text-xs text-muted-foreground">
          Shown on your public verification page so others can call to confirm
          your membership.
        </p>
        <FieldError messages={errors?.contactNumber} />
      </Field>

      <SectionHeading>Fraternal Information</SectionHeading>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="alexisName">Alexis name</Label>
          <Input
            id="alexisName"
            name="alexisName"
            placeholder="Fraternal alias"
            defaultValue={defaults.alexisName}
            aria-invalid={!!errors?.alexisName}
          />
          <FieldError messages={errors?.alexisName} />
        </Field>
        <Field>
          <Label htmlFor="batchName">Batch name</Label>
          <Input
            id="batchName"
            name="batchName"
            placeholder="e.g. Batch Maharlika"
            defaultValue={defaults.batchName}
            aria-invalid={!!errors?.batchName}
          />
          <FieldError messages={errors?.batchName} />
        </Field>
        <Field>
          <Label htmlFor="batchYear">Batch year</Label>
          <Input
            id="batchYear"
            name="batchYear"
            type="number"
            inputMode="numeric"
            min={1968}
            max={2100}
            placeholder="e.g. 1998"
            defaultValue={defaults.batchYear ?? ""}
            aria-invalid={!!errors?.batchYear}
          />
          <FieldError messages={errors?.batchYear} />
        </Field>
        <Field>
          <Label htmlFor="dateSurvived">Date survived</Label>
          <Input
            id="dateSurvived"
            name="dateSurvived"
            type="date"
            defaultValue={defaults.dateSurvived}
            aria-invalid={!!errors?.dateSurvived}
          />
          <FieldError messages={errors?.dateSurvived} />
        </Field>
      </div>

      <SectionHeading>Lineage · Other Information</SectionHeading>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="gtName">GT (when survived)</Label>
          <Input
            id="gtName"
            name="gtName"
            placeholder="Grand Triskelion"
            defaultValue={defaults.gtName}
            aria-invalid={!!errors?.gtName}
          />
          <FieldError messages={errors?.gtName} />
        </Field>
        <Field>
          <Label htmlFor="gtNumber">GT&apos;s number</Label>
          <Input
            id="gtNumber"
            name="gtNumber"
            className="tgp-mono"
            defaultValue={defaults.gtNumber}
            aria-invalid={!!errors?.gtNumber}
          />
          <FieldError messages={errors?.gtNumber} />
        </Field>
        <Field>
          <Label htmlFor="mwwName">MWW (when survived)</Label>
          <Input
            id="mwwName"
            name="mwwName"
            defaultValue={defaults.mwwName}
            aria-invalid={!!errors?.mwwName}
          />
          <FieldError messages={errors?.mwwName} />
        </Field>
        <Field>
          <Label htmlFor="mwwNumber">MWW&apos;s number</Label>
          <Input
            id="mwwNumber"
            name="mwwNumber"
            className="tgp-mono"
            defaultValue={defaults.mwwNumber}
            aria-invalid={!!errors?.mwwNumber}
          />
          <FieldError messages={errors?.mwwNumber} />
        </Field>
      </div>

      <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
    </form>
  );
}
