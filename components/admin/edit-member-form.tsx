"use client";

import { useActionState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  updateMemberProfile,
  type AdminMemberState,
} from "@/lib/actions/admin";

const initialState: AdminMemberState = {};

export type EditMemberFormProps = {
  profileId: string;
  fullName: string;
  batchYear: number | null;
  alexisName: string | null;
  batchName: string | null;
  dateSurvived: string | null;
  gtName: string | null;
  gtNumber: string | null;
  mwwName: string | null;
  mwwNumber: string | null;
  contactNumber: string | null;
};

export function EditMemberForm(props: EditMemberFormProps) {
  const [state, formAction] = useActionState(updateMemberProfile, initialState);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CircleCheck />
          <span>{state.notice}</span>
        </Alert>
      )}

      <input type="hidden" name="profileId" value={props.profileId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={props.fullName}
            aria-invalid={!!errors?.fullName}
            required
          />
          <FieldError messages={errors?.fullName} />
        </Field>
        <Field>
          <Label htmlFor="batchYear">Batch year</Label>
          <Input
            id="batchYear"
            name="batchYear"
            type="number"
            inputMode="numeric"
            placeholder="e.g. 1995"
            defaultValue={props.batchYear ?? ""}
            aria-invalid={!!errors?.batchYear}
          />
          <FieldError messages={errors?.batchYear} />
        </Field>
        <Field>
          <Label htmlFor="alexisName">Alexis name</Label>
          <Input
            id="alexisName"
            name="alexisName"
            placeholder="Fraternal alias"
            defaultValue={props.alexisName ?? ""}
          />
          <FieldError messages={errors?.alexisName} />
        </Field>
        <Field>
          <Label htmlFor="batchName">Batch name</Label>
          <Input
            id="batchName"
            name="batchName"
            placeholder="e.g. Batch Maharlika"
            defaultValue={props.batchName ?? ""}
          />
          <FieldError messages={errors?.batchName} />
        </Field>
        <Field>
          <Label htmlFor="dateSurvived">Date survived</Label>
          <Input
            id="dateSurvived"
            name="dateSurvived"
            type="date"
            defaultValue={props.dateSurvived ?? ""}
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
            defaultValue={props.contactNumber ?? ""}
          />
          <FieldError messages={errors?.contactNumber} />
        </Field>
        <Field>
          <Label htmlFor="gtName">GT (when survived)</Label>
          <Input
            id="gtName"
            name="gtName"
            placeholder="Grand Triskelion"
            defaultValue={props.gtName ?? ""}
          />
          <FieldError messages={errors?.gtName} />
        </Field>
        <Field>
          <Label htmlFor="gtNumber">GT&apos;s contact</Label>
          <Input
            id="gtNumber"
            name="gtNumber"
            type="tel"
            inputMode="tel"
            defaultValue={props.gtNumber ?? ""}
          />
          <FieldError messages={errors?.gtNumber} />
        </Field>
        <Field>
          <Label htmlFor="mwwName">MWW (when survived)</Label>
          <Input
            id="mwwName"
            name="mwwName"
            defaultValue={props.mwwName ?? ""}
          />
          <FieldError messages={errors?.mwwName} />
        </Field>
        <Field>
          <Label htmlFor="mwwNumber">MWW&apos;s contact</Label>
          <Input
            id="mwwNumber"
            name="mwwNumber"
            type="tel"
            inputMode="tel"
            defaultValue={props.mwwNumber ?? ""}
          />
          <FieldError messages={errors?.mwwNumber} />
        </Field>
      </div>

      <SubmitButton pendingText="Saving…">Save details</SubmitButton>
    </form>
  );
}
