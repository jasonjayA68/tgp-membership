import { MapPin } from "lucide-react";

import { ActionSelect } from "@/components/admin/action-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setDistrictOfficer } from "@/lib/actions/admin";

/**
 * Maps each distinct district to a verifying officer. Used as the fallback when
 * a member's chapter has no officer of its own. Server Component — the per-row
 * <ActionSelect> submits the server action on change.
 */
export function DistrictOfficers({
  districts,
  admins,
  current,
}: {
  districts: string[];
  admins: { id: string; full_name: string }[];
  current: Record<string, string>;
}) {
  if (districts.length === 0) return null;

  const officerOptions = [
    { value: "", label: "— No officer —" },
    ...admins.map((a) => ({
      value: a.id,
      label: a.full_name?.trim() || "(unnamed admin)",
    })),
  ];

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>District officers</CardTitle>
        <CardDescription>
          Fallback verifier when a chapter has no officer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {districts.map((district) => (
          <div key={district} className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 text-gold/70" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {district}
            </span>
            <ActionSelect
              action={setDistrictOfficer}
              name="officerId"
              defaultValue={current[district] ?? ""}
              hidden={{ district }}
              ariaLabel={`Verifying officer for ${district}`}
              className="shrink-0"
              options={officerOptions}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
