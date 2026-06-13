"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <CircleAlert className="size-5" />
        <h2 className="font-semibold">Action failed</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {error.message || "Something went wrong while updating the registry."}
      </p>
      <Button
        onClick={() => unstable_retry()}
        variant="outline"
        size="sm"
        className="mt-4"
      >
        Try again
      </Button>
    </div>
  );
}
