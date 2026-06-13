import type { Metadata } from "next";

import { ChapterForm } from "@/components/admin/chapter-form";
import { ChapterRow } from "@/components/admin/chapter-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Chapter } from "@/lib/types";

export const metadata: Metadata = { title: "Chapters" };

export default async function ChaptersPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chapters")
    .select("*")
    .order("name");
  if (error) throw error;
  const chapters = (data ?? []) as Chapter[];

  const counts = await Promise.all(
    chapters.map((c) =>
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("chapter_id", c.id)
        .then((r) => {
          if (r.error) throw r.error;
          return r.count ?? 0;
        }),
    ),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Chapters &amp; Councils</CardTitle>
          <CardDescription>{chapters.length} registered</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {chapters.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No chapters yet. Create the first one.
            </p>
          ) : (
            chapters.map((chapter, i) => (
              <ChapterRow
                key={chapter.id}
                chapter={chapter}
                memberCount={counts[i]}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>New chapter</CardTitle>
          <CardDescription>Add a chapter or council.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChapterForm />
        </CardContent>
      </Card>
    </div>
  );
}
