"use client";

import { useActionState, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ImagePlus, Upload } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { uploadAvatar, type ProfileState } from "@/lib/actions/profile";

const initialState: ProfileState = {};
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

export function AvatarUploader({
  currentUrl,
  name,
}: {
  currentUrl: string | null;
  name: string;
}) {
  const [state, formAction] = useActionState(uploadAvatar, initialState);
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setPreview(null);
      setHasFile(false);
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      setClientError("Use a JPG, PNG, or WebP image.");
      e.target.value = "";
      setPreview(null);
      setHasFile(false);
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please choose one under 5 MB.`,
      );
      e.target.value = "";
      setPreview(null);
      setHasFile(false);
      return;
    }
    setClientError(null);
    setPreview(URL.createObjectURL(file));
    setHasFile(true);
  }

  return (
    <form action={formAction} className="space-y-3">
      <Avatar
        src={preview ?? currentUrl}
        name={name}
        size={180}
        rounded="lg"
        className="mx-auto w-full max-w-[180px] tgp-glow"
      />

      <input
        ref={inputRef}
        type="file"
        name="photo"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onFileChange}
      />

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus />
          Choose photo
        </Button>
        <SubmitButton
          variant="secondary"
          size="sm"
          pendingText="Uploading…"
          disabled={!hasFile}
        >
          <Upload />
          Upload
        </SubmitButton>
      </div>

      {clientError && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{clientError}</span>
        </Alert>
      )}
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

      <p className="text-center text-[11px] text-muted-foreground">
        JPG, PNG, or WebP · up to 5 MB
      </p>
    </form>
  );
}
