"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { createChapter, type ChapterState } from "@/lib/actions/admin";

const initialState: ChapterState = {};

export function ChapterForm() {
  const [state, formAction] = useActionState(createChapter, initialState);

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
        <Label htmlFor="name">Chapter</Label>
        <Input id="name" name="name" placeholder="e.g. Naawan Chapter" required />
      </Field>
      <Field>
        <Label htmlFor="district">District</Label>
        <Input id="district" name="district" placeholder="e.g. District 1" />
      </Field>
      <Field>
        <Label htmlFor="region">Council</Label>
        <Input id="region" name="region" placeholder="e.g. Metro Iligan Council" />
      </Field>

      <SubmitButton size="sm" pendingText="Adding…">
        <Plus />
        Add chapter
      </SubmitButton>
    </form>
  );
}
