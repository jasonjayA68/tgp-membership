"use client";

import { useState, useTransition } from "react";
import {
  Building2,
  Check,
  CircleAlert,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionSelect } from "@/components/admin/action-select";
import { deleteChapter, setChapterOfficer, updateChapter } from "@/lib/actions/admin";
import type { Chapter } from "@/lib/types";

export function ChapterRow({
  chapter,
  memberCount,
  admins,
}: {
  chapter: Chapter;
  memberCount: number;
  admins: { id: string; full_name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateChapter({}, formData);
      if (result.error) {
        setError(result.error);
      } else {
        // Success → collapse back to the read-only row.
        setEditing(false);
      }
    });
  }

  function openEditor() {
    setError(null);
    setEditing(true);
  }

  if (editing) {
    return (
      <div className="space-y-2 px-6 py-3">
        <form onSubmit={handleSave} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="chapterId" value={chapter.id} />
          <Input
            name="name"
            defaultValue={chapter.name}
            placeholder="Chapter"
            className="min-w-40 flex-1"
            required
          />
          <Input
            name="district"
            defaultValue={chapter.district ?? ""}
            placeholder="District"
            className="w-32"
          />
          <Input
            name="region"
            defaultValue={chapter.region ?? ""}
            placeholder="Council"
            className="w-32"
          />
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setError(null);
              setEditing(false);
            }}
          >
            <X />
            Cancel
          </Button>
        </form>
        {error && (
          <Alert variant="danger">
            <CircleAlert />
            <span>{error}</span>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-6 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Building2 className="size-4 shrink-0 text-gold/70" />
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">
            {chapter.name}
          </div>
          {(chapter.district || chapter.region) && (
            <div className="text-xs text-muted-foreground">
              {[chapter.district, chapter.region].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ActionSelect
          action={setChapterOfficer}
          name="officerId"
          defaultValue={chapter.verify_officer_id ?? ""}
          hidden={{ chapterId: chapter.id }}
          ariaLabel={`Verifying officer for ${chapter.name}`}
          className="hidden md:block"
          options={[
            { value: "", label: "— No officer —" },
            ...admins.map((a) => ({
              value: a.id,
              label: a.full_name?.trim() || "(unnamed admin)",
            })),
          ]}
        />
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={openEditor}
          aria-label={`Edit ${chapter.name}`}
        >
          <Pencil />
        </Button>
        <form
          action={deleteChapter}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete “${chapter.name}”?` +
                  (memberCount > 0
                    ? ` ${memberCount} member(s) will become Unassigned.`
                    : ""),
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="chapterId" value={chapter.id} />
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete ${chapter.name}`}
          >
            <Trash2 />
          </Button>
        </form>
      </div>
    </div>
  );
}
