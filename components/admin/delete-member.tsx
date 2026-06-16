"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteMember } from "@/lib/actions/admin";

function DeleteButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={!enabled || pending}>
      {pending ? "Deleting…" : "Delete member"}
    </Button>
  );
}

export function DeleteMember({
  profileId,
  fullName,
}: {
  profileId: string;
  fullName: string;
}) {
  const [confirm, setConfirm] = useState("");
  const matches = confirm.trim() === fullName.trim();

  return (
    <form action={deleteMember} className="space-y-3">
      <input type="hidden" name="profileId" value={profileId} />
      <p className="text-sm text-muted-foreground">
        This permanently removes the member, their digital ID card, and their
        membership in this organization. Their login account is not deleted and
        they may re-apply. This cannot be undone.
      </p>
      <Field>
        <Label htmlFor="confirmName">
          Type <span className="font-semibold text-foreground">{fullName}</span>{" "}
          to confirm
        </Label>
        <Input
          id="confirmName"
          name="confirmName"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={fullName}
        />
      </Field>
      <DeleteButton enabled={matches} />
    </form>
  );
}
