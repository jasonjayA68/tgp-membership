import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { AuditLog } from "@/lib/types";

export const metadata: Metadata = { title: "Audit Log" };

const ACTION_LABEL: Record<string, string> = {
  status_change: "Standing changed",
  role_change: "Role changed",
  chapter_change: "Chapter reassigned",
};

function detailOf(log: AuditLog): string {
  const from = log.metadata.from as string | undefined;
  const to = log.metadata.to as string | undefined;
  if (from && to) return `${from} → ${to}`;
  if (to) return `→ ${to}`;
  return "—";
}

export default async function AuditPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const logs = (data ?? []) as AuditLog[];

  // Resolve actor / subject ids to readable names.
  const ids = Array.from(
    new Set(
      logs.flatMap((l) =>
        [l.performed_by, l.target_user].filter(Boolean) as string[],
      ),
    ),
  );

  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: people, error: peopleError } = await supabase
      .from("profiles")
      .select("user_id, full_name, member_id")
      .in("user_id", ids);
    if (peopleError) throw peopleError;
    for (const p of people ?? []) {
      nameById.set(
        p.user_id,
        p.full_name || p.member_id || p.user_id.slice(0, 8),
      );
    }
  }

  const nameOf = (id: string | null) =>
    id ? (nameById.get(id) ?? "System") : "System";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {logs.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No audit entries recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] tracking-widest text-muted-foreground uppercase">
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Detail</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 text-foreground">
                      {ACTION_LABEL[log.action] ?? log.action.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {nameOf(log.target_user)}
                    </td>
                    <td className="tgp-mono px-4 py-2.5 text-xs text-muted-foreground">
                      {detailOf(log)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {nameOf(log.performed_by)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(log.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
