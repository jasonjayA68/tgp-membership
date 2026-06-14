import type { Metadata } from "next";

import { ChapterForm } from "@/components/admin/chapter-form";
import { ChapterRow } from "@/components/admin/chapter-row";
import { DistrictOfficers } from "@/components/admin/district-officers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { Chapter, DistrictOfficer } from "@/lib/types";

export const metadata: Metadata = { title: "Chapters" };

export default async function ChaptersPage() {
  const supabase = await createClient();

  const [chaptersResult, adminsResult, districtOfficersResult] =
    await Promise.all([
      supabase.from("chapters").select("*").order("name"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["admin", "super_admin"])
        .order("full_name"),
      supabase.from("district_officers").select("district, officer_id"),
    ]);
  if (chaptersResult.error) throw chaptersResult.error;
  if (adminsResult.error) throw adminsResult.error;
  if (districtOfficersResult.error) throw districtOfficersResult.error;

  const chapters = (chaptersResult.data ?? []) as Chapter[];
  const admins = (adminsResult.data ?? []) as {
    id: string;
    full_name: string;
  }[];
  const districtOfficers = (districtOfficersResult.data ??
    []) as Pick<DistrictOfficer, "district" | "officer_id">[];

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

  const districts = Array.from(
    new Set(
      chapters
        .map((c) => c.district?.trim())
        .filter((d): d is string => Boolean(d)),
    ),
  ).sort();

  const currentDistrictOfficer: Record<string, string> = {};
  for (const row of districtOfficers) {
    if (row.officer_id) currentDistrictOfficer[row.district] = row.officer_id;
  }

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
                admins={admins}
              />
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New chapter</CardTitle>
            <CardDescription>Add a chapter or council.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChapterForm />
          </CardContent>
        </Card>

        <DistrictOfficers
          districts={districts}
          admins={admins}
          current={currentDistrictOfficer}
        />
      </div>
    </div>
  );
}
