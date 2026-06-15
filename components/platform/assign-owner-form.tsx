"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, UserPlus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { assignTenantOwner, type PlatformState } from "@/lib/actions/platform";

const initialState: PlatformState = {};

export function AssignOwnerForm({ tenantId }: { tenantId: string }) {
  const [state, formAction] = useActionState(assignTenantOwner, initialState);

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
        <Label htmlFor="email">Owner email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="owner@example.com"
          required
        />
      </Field>
      <SubmitButton size="sm" pendingText="Assigning…">
        <UserPlus />
        Assign owner
      </SubmitButton>
    </form>
  );
}
