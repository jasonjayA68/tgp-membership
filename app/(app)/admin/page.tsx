import Link from "next/link";
import type { Metadata } from "next";
import { Check, Search, Settings2, X } from "lucide-react";

import { StatusBadge } from "@/components/brand/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { setMemberStatus } from "@/lib/actions/admin";
import { MEMBER_STATUSES, STATUS_META } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { MemberStatus, ProfileWithChapter } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Members" };

function Stat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "gold" | "amber" | "danger";
}) {
  return (
    <Card className="p-4">
      <div
        className={cn(
          "tgp-display text-2xl font-bold",
          tone === "gold" && "text-gold",
          tone === "amber" && "text-amber-400",
          tone === "danger" && "text-destructive",
          tone === "muted" && "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="text-[11px] tracking-widest text-muted-foreground uppercase">
        {label}
      </div>
    </Card>
  );
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const supabase = await createClient();

  const statusFilter = MEMBER_STATUSES.find((s) => s === status);
  // Strip PostgREST filter metacharacters to prevent filter injection.
  const safeQuery = (q ?? "").replace(/[,()*%\\]/g, "").trim();

  const [counts, membersResult] = await Promise.all([
    Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("status", "suspended"),
    ]),
    (async () => {
      let query = supabase
        .from("profiles")
        .select("*, chapter:chapters(*)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (safeQuery) {
        query = query.or(
          `full_name.ilike.%${safeQuery}%,member_id.ilike.%${safeQuery}%`,
        );
      }
      return query;
    })(),
  ]);

  const countError = counts.find((c) => c.error)?.error;
  if (countError) throw countError;
  if (membersResult.error) throw membersResult.error;

  const [total, pending, active, suspended] = counts.map((c) => c.count ?? 0);
  const members = (membersResult.data ?? []) as ProfileWithChapter[];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Members" value={total} />
        <Stat label="Pending" value={pending} tone="amber" />
        <Stat label="Active" value={active} tone="gold" />
        <Stat label="Suspended" value={suspended} tone="danger" />
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name or member ID"
            className="pl-9"
          />
        </div>
        <div className="w-44">
          <Select name="status" defaultValue={statusFilter ?? ""}>
            <option value="">All statuses</option>
            {MEMBER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(safeQuery || statusFilter) && (
          <Button asChild variant="ghost">
            <Link href="/admin">Clear</Link>
          </Button>
        )}
      </form>

      <Card className="divide-y divide-border">
        {members.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No members match your filters.
          </p>
        ) : (
          members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))
        )}
      </Card>
    </div>
  );
}

function MemberRow({ member }: { member: ProfileWithChapter }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <Avatar
        src={member.photo_url}
        name={member.full_name || "?"}
        size={44}
        rounded="full"
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`/admin/members/${member.id}`}
          className="block truncate font-medium text-foreground hover:text-gold"
        >
          {member.full_name || "Unnamed member"}
        </Link>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span className="tgp-mono">{member.member_id ?? "—"}</span>
          <span>{member.chapter?.name ?? "Unassigned"}</span>
          {member.batch_year && <span>Batch {member.batch_year}</span>}
        </div>
      </div>

      <StatusBadge status={member.status} />

      <div className="flex flex-wrap gap-1.5">
        {member.status === "pending" && (
          <>
            <QuickStatus profileId={member.id} status="active">
              <Check />
              Approve
            </QuickStatus>
            <QuickStatus
              profileId={member.id}
              status="rejected"
              variant="destructive"
            >
              <X />
              Reject
            </QuickStatus>
          </>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/members/${member.id}`}>
            <Settings2 />
            Manage
          </Link>
        </Button>
      </div>
    </div>
  );
}

function QuickStatus({
  profileId,
  status,
  variant = "default",
  children,
}: {
  profileId: string;
  status: MemberStatus;
  variant?: React.ComponentProps<typeof Button>["variant"];
  children: React.ReactNode;
}) {
  return (
    <form action={setMemberStatus}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton size="sm" variant={variant} pendingText="…">
        {children}
      </SubmitButton>
    </form>
  );
}
