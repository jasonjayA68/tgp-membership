import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Camera, IdCard, ShieldCheck, Sparkles, Sun, UserCog } from "lucide-react";

import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { ProfileForm } from "@/components/profile/profile-form";
import { StatusBadge } from "@/components/brand/status-badge";
import { Brandmark } from "@/components/brand/brandmark";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";
import { STATUS_META, TENANT_ROLE_META } from "@/lib/constants";

export const metadata: Metadata = { title: "Edit Profile" };

export default async function ProfilePage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  const { profile, user, role } = auth;
  const name = profile?.full_name || user.email || "Member";
  const status = profile?.status ?? "pending";
  const meta = STATUS_META[status];
  const currentPhotoUrl = profile?.photo_url ?? null;

  const defaults = {
    fullName: profile?.full_name ?? "",
    contactNumber: profile?.contact_number ?? "",
    batchYear: profile?.batch_year ?? null,
    alexisName: profile?.alexis_name ?? "",
    batchName: profile?.batch_name ?? "",
    dateSurvived: profile?.date_survived ?? "",
    gtName: profile?.gt_name ?? "",
    gtNumber: profile?.gt_number ?? "",
    mwwName: profile?.mww_name ?? "",
    mwwNumber: profile?.mww_number ?? "",
  };

  const registry: { label: string; value: string }[] = [
    { label: "Member ID", value: profile?.member_id ?? "—" },
    { label: "Chapter", value: profile?.chapter?.name ?? "—" },
    { label: "District", value: profile?.chapter?.district ?? "—" },
    { label: "Council", value: profile?.chapter?.region ?? "—" },
    { label: "Role", value: TENANT_ROLE_META[role ?? "member"].label },
    { label: "Email", value: user.email ?? "—" },
  ];

  return (
    <div className="relative isolate -mt-2 space-y-12 pb-4 sm:-mt-4 sm:space-y-16">
      {/* LIGHT OVER DARKNESS — a dawn rising out of the black depths. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[640px] bg-[radial-gradient(ellipse_78%_55%_at_50%_0%,color-mix(in_oklab,var(--gold)_20%,transparent),color-mix(in_oklab,var(--gold)_7%,transparent)_38%,transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[520px] bg-gradient-to-b from-transparent via-transparent to-background [mask-image:linear-gradient(to_bottom,transparent,black_85%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -z-10 size-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-gold/20 opacity-80 blur-[100px]"
      />

      {/* HERO */}
      <header className="relative flex flex-col items-center gap-5 px-2 pt-6 text-center sm:pt-10">
        <p className="tgp-eyebrow text-[10px] text-gold/70 sm:text-[11px]">
          Tau Gamma Phi · Member Profile
        </p>

        <h1 className="tgp-display text-3xl font-bold tracking-tight sm:text-5xl">
          <span className="tgp-gild [text-shadow:0_0_28px_color-mix(in_oklab,var(--gold)_32%,transparent)]">
            Edit Profile
          </span>
        </h1>

        <div className="flex items-center gap-3 text-gold/60">
          <span className="h-px w-10 tgp-rule sm:w-16" />
          <Sun className="size-4 shrink-0 text-gold-bright/80" />
          <span className="h-px w-10 tgp-rule sm:w-16" />
        </div>

        <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          Manage your photograph and personal details. Your standing and registry
          record are kept under the seal of the fraternity administration.
        </p>
      </header>

      {/* STANDING NOTICE */}
      {!meta.verified && (
        <Alert variant="gold" className="mx-auto max-w-6xl">
          <ShieldCheck />
          <div className="space-y-0.5">
            <p className="tgp-display font-semibold text-foreground">
              {meta.label}
            </p>
            <p>{meta.description}</p>
          </div>
        </Alert>
      )}

      {/* TWO-COLUMN CHARTER */}
      <div className="mx-auto grid max-w-6xl gap-10 px-2 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start lg:gap-12">
        {/* LEFT RAIL */}
        <aside className="space-y-12 sm:space-y-16">
          {/* PHOTOGRAPH */}
          <section className="space-y-5">
            <div className="flex items-center gap-3">
              <Camera className="size-4 shrink-0 text-gold/70" />
              <h2 className="tgp-eyebrow text-xs text-gold/80">Photograph</h2>
              <span className="h-px flex-1 tgp-rule" />
            </div>

            <Card className="relative overflow-hidden border-gold/30 tgp-glow">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-28 bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_14%,transparent),transparent_75%)]"
              />
              <CardContent className="p-6">
                <div className="relative mx-auto w-fit">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-4 -z-10 rounded-2xl bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--gold)_24%,transparent),transparent)] blur-xl"
                  />
                  <AvatarUploader currentUrl={currentPhotoUrl} name={name} />
                </div>
              </CardContent>
            </Card>
          </section>

          {/* REGISTRY RECORD */}
          <section className="space-y-5">
            <div className="flex items-center gap-3">
              <IdCard className="size-4 shrink-0 text-gold/70" />
              <h2 className="tgp-eyebrow text-xs text-gold/80">Registry Record</h2>
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
                  <StatusBadge status={status} />
                </div>

                <dl>
                  {registry.map((row, i) => {
                    const empty = !row.value || row.value === "—";
                    const isMemberId = row.label === "Member ID";
                    const isEmail = row.label === "Email";
                    return (
                      <div
                        key={`${row.label}-${i}`}
                        className="flex flex-col gap-1 px-5 py-4 not-last:border-b not-last:border-border/60 sm:px-6"
                      >
                        <dt className="tgp-eyebrow flex items-center gap-1.5 text-[10px] text-gold/65">
                          {isMemberId && (
                            <IdCard className="size-3 shrink-0 text-gold/55" />
                          )}
                          {row.label}
                        </dt>
                        <dd
                          className={
                            empty
                              ? "tgp-display text-sm text-muted-foreground/45"
                              : isMemberId
                                ? "tgp-mono text-base font-medium text-foreground"
                                : isEmail
                                  ? "tgp-display text-sm font-medium break-all text-foreground"
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
                  <Brandmark name={auth.tenant.name} logoUrl={auth.tenant.logo_url} className="size-7 shrink-0 rounded-full" />
                  <p className="text-pretty">
                    Maintained by the Tau Gamma Phi administration. To correct
                    these fields, contact your chapter.
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>
        </aside>

        {/* RIGHT COLUMN — editable Personal Details */}
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <UserCog className="size-4 shrink-0 text-gold/70" />
            <h2 className="tgp-eyebrow text-xs text-gold/80">Personal Details</h2>
            <span className="h-px flex-1 tgp-rule" />
          </div>

          <Card className="relative overflow-hidden tgp-frame tgp-glow">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-32 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_10%,transparent),transparent_80%)]"
            />
            <CardContent className="space-y-6 p-6">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-gold/60" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  These fields are yours to manage. They appear on your digital ID
                  and public verification page.
                </p>
              </div>

              <ProfileForm defaults={defaults} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
