import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Nfc,
  Power,
  RefreshCw,
} from "lucide-react";

import { ActionSelect } from "@/components/admin/action-select";
import { IdCard, type IdCardData } from "@/components/id-card";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  assignChapter,
  regenerateSlug,
  setCardActive,
  setMemberRole,
  setMemberStatus,
} from "@/lib/actions/admin";
import { requireTenantAdmin } from "@/lib/auth";
import { getActiveTenantBasePath } from "@/lib/tenant/context";
import { tenantHref } from "@/lib/tenant/links";
import { MEMBER_STATUSES, STATUS_META, TENANT_ROLE_META } from "@/lib/constants";
import { toProfileView, type ProfileRow } from "@/lib/profile";
import { tdb } from "@/lib/supabase/db";
import type { TenantRole } from "@/lib/types";
import { getBaseUrl, verificationUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import type { Chapter, NfcCard } from "@/lib/types";

export const metadata: Metadata = { title: "Manage Member" };

const ROLE_OPTIONS = [
  { value: "member", label: TENANT_ROLE_META.member.label },
  { value: "admin", label: TENANT_ROLE_META.admin.label },
  { value: "owner", label: TENANT_ROLE_META.owner.label },
];

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const auth = await requireTenantAdmin();
  const basePath = await getActiveTenantBasePath();
  const isOwner = auth.role === "owner";
  const db = tdb(supabase, auth.tenant.id);

  const { data: profileRow, error: profileError } = await db
    .select("profiles", "*, chapter:chapters!profiles_chapter_id_fkey(*)")
    .eq("id", id)
    .maybeSingle<ProfileRow>();
  if (profileError) throw profileError;
  if (!profileRow) notFound();
  const profile = toProfileView(profileRow);

  // The target member's tenant role (for the role <select> default).
  const { data: targetMembership } = await db
    .select("tenant_users", "role")
    .eq("user_id", profile.user_id)
    .maybeSingle<{ role: TenantRole }>();
  const targetRole = targetMembership?.role ?? "member";

  const [chaptersResult, cardResult, logsResult] = await Promise.all([
    db.select("chapters").order("name"),
    db.select("nfc_cards").eq("profile_id", profile.id).maybeSingle<NfcCard>(),
    db
      .select("audit_logs")
      .eq("target_user", profile.user_id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  if (chaptersResult.error) throw chaptersResult.error;
  if (cardResult.error) throw cardResult.error;
  if (logsResult.error) throw logsResult.error;
  const chaptersData = chaptersResult.data;
  const card = cardResult.data;
  const logs = logsResult.data;

  const chapters = (chaptersData ?? []) as Pick<
    Chapter,
    "id" | "name" | "district" | "region"
  >[];
  const baseUrl = await getBaseUrl();
  const verifyUrl = card ? verificationUrl(baseUrl, card.slug) : null;

  const cardData: IdCardData = {
    fullName: profile.full_name,
    alexisName: profile.alexis_name,
    memberId: profile.member_id,
    chapter: profile.chapter?.name ?? null,
    district: profile.chapter?.district ?? null,
    council: profile.chapter?.region ?? null,
    batchName: profile.batch_name,
    status: profile.status,
    photoUrl: profile.photo_url,
  };

  const fraternalRecord: { label: string; value: string | null }[] = [
    { label: "Alexis name", value: profile.alexis_name },
    { label: "Batch name", value: profile.batch_name },
    {
      label: "Date survived",
      value: profile.date_survived
        ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
            new Date(profile.date_survived),
          )
        : null,
    },
    { label: "GT (when survived)", value: profile.gt_name },
    { label: "GT's number", value: profile.gt_number },
    { label: "MWW (when survived)", value: profile.mww_name },
    { label: "MWW's number", value: profile.mww_number },
    { label: "Contact number", value: profile.contact_number },
  ];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={tenantHref(basePath, "/admin")}>
          <ArrowLeft />
          All members
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* Left: identity + NFC */}
        <div className="space-y-6">
          <IdCard data={cardData} />

          <Card className="border-gold/25">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Nfc className="size-4 text-gold" />
                NFC Card
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {card ? (
                <>
                  <div className="flex justify-center rounded-lg border border-gold/30 bg-ink/40 p-3">
                    <QrCode value={verifyUrl!} size={160} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Verification link</Label>
                    <p className="tgp-mono rounded-md border border-border bg-ink/50 px-3 py-2 text-xs break-all">
                      {verifyUrl}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton value={verifyUrl!} className="flex-1" />
                    <Button asChild variant="secondary" size="sm">
                      <Link
                        href={`/id/${card.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink />
                        Open
                      </Link>
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <form action={regenerateSlug} className="flex-1">
                      <input type="hidden" name="profileId" value={profile.id} />
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        className="w-full"
                        pendingText="Regenerating…"
                      >
                        <RefreshCw />
                        Regenerate
                      </SubmitButton>
                    </form>
                    <form action={setCardActive} className="flex-1">
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="profileId" value={profile.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={(!card.active).toString()}
                      />
                      <SubmitButton
                        variant={card.active ? "destructive" : "default"}
                        size="sm"
                        className="w-full"
                        pendingText="…"
                      >
                        <Power />
                        {card.active ? "Deactivate" : "Activate"}
                      </SubmitButton>
                    </form>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    Scanned {card.scan_count}{" "}
                    {card.scan_count === 1 ? "time" : "times"} ·{" "}
                    {card.active ? "Active" : "Inactive"}
                  </p>
                </>
              ) : (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    No NFC card issued yet. Approving the member auto-issues one,
                    or generate it manually below.
                  </p>
                  <form action={regenerateSlug}>
                    <input type="hidden" name="profileId" value={profile.id} />
                    <SubmitButton
                      variant="secondary"
                      size="sm"
                      pendingText="Generating…"
                    >
                      <Nfc />
                      Generate NFC slug
                    </SubmitButton>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: management controls */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Membership controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <FieldRow
                label="Standing"
                hint="Setting a member to Active issues their member ID and NFC card."
              >
                <ActionSelect
                  action={setMemberStatus}
                  name="status"
                  defaultValue={profile.status}
                  hidden={{ profileId: profile.id }}
                  ariaLabel="Member status"
                  options={MEMBER_STATUSES.map((s) => ({
                    value: s,
                    label: STATUS_META[s].label,
                  }))}
                />
              </FieldRow>

              <FieldRow label="Chapter">
                <ActionSelect
                  action={assignChapter}
                  name="chapterId"
                  defaultValue={profile.chapter_id ?? ""}
                  hidden={{ profileId: profile.id }}
                  ariaLabel="Member chapter"
                  options={[
                    { value: "", label: "Unassigned" },
                    ...chapters.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </FieldRow>

              <FieldRow
                label="Role"
                hint={
                  isOwner
                    ? "Grant administrative privileges."
                    : "Only a Grand Administrator can change roles."
                }
              >
                {isOwner ? (
                  <ActionSelect
                    action={setMemberRole}
                    name="role"
                    defaultValue={targetRole}
                    hidden={{ profileId: profile.id }}
                    ariaLabel="Member role"
                    options={ROLE_OPTIONS}
                  />
                ) : (
                  <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                    {TENANT_ROLE_META[targetRole].label}
                  </div>
                )}
              </FieldRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fraternal information</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="divide-y divide-border">
                {fraternalRecord.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                      {row.label}
                    </dt>
                    <dd
                      className={`text-right text-sm ${row.value ? "text-foreground" : "text-muted-foreground/50"}`}
                    >
                      {row.value ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {logs && logs.length > 0 ? (
                <ul className="space-y-2.5">
                  {logs.map((log) => (
                    <li
                      key={log.id}
                      className="flex items-center justify-between gap-3 border-b border-border pb-2.5 text-sm last:border-0 last:pb-0"
                    >
                      <span className="text-foreground">
                        {formatAction(log.action, log.metadata)}
                      </span>
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("en-US", {
                          dateStyle: "medium",
                        }).format(new Date(log.created_at))}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No recorded activity yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatAction(
  action: string,
  metadata: Record<string, unknown>,
): string {
  const from = metadata.from as string | undefined;
  const to = metadata.to as string | undefined;
  switch (action) {
    case "status_change":
      return `Standing changed${from ? ` from ${from}` : ""} to ${to}`;
    case "role_change":
      return `Role changed to ${to}`;
    case "chapter_change":
      return "Chapter reassigned";
    default:
      return action.replace(/_/g, " ");
  }
}
