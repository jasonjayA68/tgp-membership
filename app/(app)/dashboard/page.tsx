import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ExternalLink,
  Nfc,
  Phone,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";

import { TgpSeal } from "@/components/brand/seal";
import { StatusBadge } from "@/components/brand/status-badge";
import { IdCard, type IdCardData } from "@/components/id-card";
import { QrCode } from "@/components/qr-code";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { getAuth } from "@/lib/auth";
import { STATUS_META } from "@/lib/constants";
import { getBaseUrl, verificationUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Member Portal" };

function joinNameNumber(
  name?: string | null,
  num?: string | null,
): string {
  if (name && num) return `${name} · ${num}`;
  return name || num || "—";
}

export default async function DashboardPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  const { profile, user, tenant } = auth;
  const status = profile?.status ?? "pending";
  const meta = STATUS_META[status];

  const supabase = await createClient();
  const cardResult = profile
    ? await supabase
        .from("nfc_cards")
        .select("slug, active, scan_count, last_verified_at")
        .eq("profile_id", profile.id)
        .maybeSingle()
    : { data: null, error: null };
  if (cardResult.error) throw cardResult.error;
  const card = cardResult.data;

  const baseUrl = await getBaseUrl();
  const verifyUrl = card?.active
    ? verificationUrl(baseUrl, tenant.slug, card.slug)
    : null;

  const cardData: IdCardData = {
    fullName: profile?.full_name || user.email || "Member",
    alexisName: profile?.alexis_name ?? null,
    memberId: profile?.member_id ?? null,
    chapter: profile?.chapter?.name ?? null,
    district: profile?.chapter?.district ?? null,
    council: profile?.chapter?.region ?? null,
    batchName: profile?.batch_name ?? null,
    status,
    photoUrl: profile?.photo_url ?? null,
  };

  const firstName = (
    (profile?.full_name || user.email || "Member").split(/\s+/)[0] || "Member"
  ).replace(/@.*/, "");

  const survived = profile?.date_survived
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
        new Date(profile.date_survived),
      )
    : "—";

  const record: { label: string; value: string }[] = [
    { label: "Alexis Name", value: profile?.alexis_name || "—" },
    { label: "Batch Name", value: profile?.batch_name || "—" },
    { label: "Chapter", value: profile?.chapter?.name || "—" },
    { label: "District", value: profile?.chapter?.district || "—" },
    { label: "Council", value: profile?.chapter?.region || "—" },
    { label: "Date Survived", value: survived },
    {
      label: "Grand Triskelion (GT)",
      value: joinNameNumber(profile?.gt_name, profile?.gt_number),
    },
    {
      label: "MWW",
      value: joinNameNumber(profile?.mww_name, profile?.mww_number),
    },
    { label: "Contact Number", value: profile?.contact_number || "—" },
  ];

  return (
    <div className="relative isolate -mt-2 space-y-12 pb-4 sm:-mt-4 sm:space-y-16">
      {/* LIGHT OVER DARKNESS — a dawn rising out of the black depths. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[680px] bg-[radial-gradient(ellipse_78%_55%_at_50%_0%,color-mix(in_oklab,var(--gold)_22%,transparent),color-mix(in_oklab,var(--gold)_8%,transparent)_38%,transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[560px] bg-gradient-to-b from-transparent via-transparent to-background [mask-image:linear-gradient(to_bottom,transparent,black_85%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -z-10 size-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-gold/20 opacity-80 blur-[100px]"
      />

      {/* HERO */}
      <header className="relative flex flex-col items-center gap-5 px-2 pt-6 text-center sm:pt-10">
        <div className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 scale-[2.1] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--gold)_38%,transparent),transparent_68%)] blur-xl"
          />
          <TgpSeal className="size-20 rounded-full tgp-frame tgp-glow sm:size-24" />
        </div>

        <p className="tgp-eyebrow text-[10px] text-gold/70 sm:text-[11px]">
          Tau Gamma Phi · Digital Membership Registry
        </p>

        <h1 className="tgp-display text-3xl font-bold tracking-tight sm:text-5xl">
          <span className="text-muted-foreground/70">Welcome, </span>
          <span className="tgp-gild [text-shadow:0_0_28px_color-mix(in_oklab,var(--gold)_32%,transparent)]">
            {firstName}
          </span>
        </h1>

        <div className="flex items-center gap-3 text-gold/60">
          <span className="h-px w-10 tgp-rule sm:w-16" />
          <Sun className="size-4 shrink-0 text-gold-bright/80" />
          <span className="h-px w-10 tgp-rule sm:w-16" />
        </div>

        <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          <span className="tgp-eyebrow block text-[10px] text-gold/70">
            Fortis Voluntas Fraternitas
          </span>
          <span className="mt-1.5 block">
            Light over darkness. Your standing in the Triskelion is recorded,
            sealed, and verifiable in real time.
          </span>
        </p>

        <StatusBadge status={status} />
      </header>

      {/* STANDING NOTICE */}
      {!meta.verified && (
        <Alert
          variant={status === "pending" ? "gold" : "danger"}
          className="mx-auto max-w-3xl"
        >
          <ShieldCheck />
          <div className="space-y-0.5">
            <p className="tgp-display font-semibold text-foreground">
              {meta.label}
            </p>
            <p>
              {meta.description}{" "}
              {status === "pending" &&
                "Your digital ID and NFC credential are sealed and issued the moment an administrator approves your membership."}
            </p>
          </div>
        </Alert>
      )}

      {/* CHARTER BODY */}
      <div className="mx-auto grid max-w-6xl gap-10 px-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-12">
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <Sparkles className="size-4 shrink-0 text-gold/70" />
            <h2 className="tgp-eyebrow text-xs text-gold/80">Sealed Credential</h2>
            <span className="h-px flex-1 tgp-rule" />
          </div>

          <div className="relative flex justify-center py-6 sm:py-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_70%_at_50%_42%,color-mix(in_oklab,var(--gold)_22%,transparent),transparent_70%)] blur-2xl [mask-image:radial-gradient(65%_65%_at_50%_45%,black,transparent)]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-6 left-1/2 -z-10 size-72 -translate-x-1/2 rounded-full bg-gold-bright/15 opacity-80 blur-[90px]"
            />
            <IdCard
              data={cardData}
              photoPriority
              className="w-full max-w-md tgp-frame"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-24 w-3/4 -translate-x-1/2 rounded-[100%] bg-gold/20 opacity-60 blur-2xl"
            />
          </div>

          <p className="mx-auto max-w-md text-center text-xs leading-relaxed text-pretty text-muted-foreground">
            This is your official Tau Gamma Phi digital membership ID. Present
            the public verification page — or tap your NFC card — to let anyone
            confirm your standing in real time.
          </p>
        </section>

        <aside className="space-y-5">
          <div className="flex items-center gap-3">
            <Nfc className="size-4 shrink-0 text-gold/70" />
            <h2 className="tgp-eyebrow text-xs text-gold/80">NFC Verification</h2>
            <span className="h-px flex-1 tgp-rule" />
          </div>

          {verifyUrl && card ? (
            <Card className="relative overflow-hidden border-gold/30 tgp-glow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 tgp-guilloche opacity-40"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_16%,transparent),transparent_75%)]"
              />
              <CardContent className="space-y-5 p-5">
                <div className="flex items-center gap-2 text-gold/80">
                  <Nfc className="size-4" />
                  <p className="tgp-eyebrow text-[10px]">NFC Verified Identity</p>
                </div>

                <div className="relative mx-auto w-fit">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-3 -z-10 rounded-2xl bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--gold)_28%,transparent),transparent)] blur-lg"
                  />
                  <div className="rounded-xl border border-gold/40 bg-gradient-to-b from-gold/10 to-transparent p-3 tgp-frame">
                    <QrCode value={verifyUrl} size={184} className="rounded-md" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="tgp-eyebrow text-[9px] text-gold/70">
                    Public Verification Link
                  </p>
                  <p className="tgp-mono rounded-md border border-gold/20 bg-ink/60 px-3 py-2 text-[11px] leading-relaxed break-all text-foreground/90">
                    {verifyUrl}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <CopyButton value={verifyUrl} className="flex-1" />
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <Link
                      href={verifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink />
                      Open
                    </Link>
                  </Button>
                </div>

                <div className="flex items-center justify-center gap-2 border-t border-gold/15 pt-3.5 text-xs text-muted-foreground">
                  <ScanLine className="size-3.5 text-gold/60" />
                  Verified{" "}
                  <span className="tgp-mono font-medium text-gold/90">
                    {card.scan_count}
                  </span>{" "}
                  {card.scan_count === 1 ? "time" : "times"}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="relative overflow-hidden border-dashed border-gold/25">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-28 bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_12%,transparent),transparent_75%)]"
              />
              <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                <div className="relative flex size-14 items-center justify-center rounded-full border border-gold/25 bg-gold/5">
                  <Sun className="size-6 text-gold/55" />
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-gold/15 blur-md"
                  />
                </div>
                <div className="space-y-1">
                  <p className="tgp-display font-semibold text-foreground">
                    Issued on Approval
                  </p>
                  <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
                    Your NFC card and public verification link are sealed and
                    will illuminate here the moment your membership is activated.
                  </p>
                </div>
                <span className="tgp-eyebrow text-[10px] text-gold/50">
                  Awaiting first light
                </span>
              </CardContent>
            </Card>
          )}

          <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-muted-foreground/80">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold/50" />
            This page is the single source of truth for your standing. Share it
            freely — it reveals only what the fraternity chooses to publish.
          </p>
        </aside>
      </div>

      {/* FRATERNAL RECORD */}
      <section className="mx-auto max-w-6xl space-y-5 px-2">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-4 shrink-0 text-gold/70" />
          <h2 className="tgp-eyebrow text-xs text-gold/80">Fraternal Record</h2>
          <span className="h-px flex-1 tgp-rule" />
        </div>

        <Card className="relative overflow-hidden tgp-frame">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 tgp-guilloche opacity-30"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_10%,transparent),transparent_80%)]"
          />
          <CardContent className="p-0">
            <div className="flex items-center justify-between gap-3 border-b border-gold/20 px-5 py-4 sm:px-6">
              <p className="tgp-eyebrow text-[10px] text-gold/70">
                Official Register
              </p>
              <span className="tgp-mono text-[10px] tracking-wider text-muted-foreground">
                {meta.label}
              </span>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2">
              {record.map((row, i) => {
                const empty = !row.value || row.value === "—";
                return (
                  <div
                    key={`${row.label}-${i}`}
                    className="flex flex-col gap-1 px-5 py-4 not-last:border-b not-last:border-border/60 sm:px-6 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:border-border/60 sm:[&:nth-last-child(2)]:border-b-0"
                  >
                    <dt className="tgp-eyebrow flex items-center gap-1.5 text-[10px] text-gold/65">
                      {row.label === "Contact Number" && (
                        <Phone className="size-3 shrink-0 text-gold/55" />
                      )}
                      {row.label}
                    </dt>
                    <dd
                      className={
                        empty
                          ? "tgp-display text-sm text-muted-foreground/45"
                          : "tgp-display text-base font-medium text-foreground"
                      }
                    >
                      {empty ? "—" : row.value}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <div className="flex items-center gap-2.5 border-t border-gold/20 px-5 py-4 text-[11px] text-muted-foreground sm:px-6">
              <TgpSeal className="size-7 shrink-0 rounded-full" />
              <p className="text-pretty">
                Recorded and certified by the Tau Gamma Phi digital registry
                under the seal of the fraternity.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
