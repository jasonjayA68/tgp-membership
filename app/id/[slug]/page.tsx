import { cache } from "react";
import type { Metadata } from "next";
import {
  CalendarDays,
  Hash,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Users,
} from "lucide-react";

import { TgpSeal } from "@/components/brand/seal";
import { StatusBadge } from "@/components/brand/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { SITE } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { MemberCard } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Loads a public membership card via the SECURITY DEFINER RPC. Memoised per
 * request so `generateMetadata` and the page share a single call (and a single
 * scan increment). Only whitelisted fields are ever returned — no table access.
 */
const getCard = cache(async (slug: string): Promise<MemberCard | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_member_card", {
    card_slug: slug,
  });
  if (error) throw new Error(`Verification lookup failed: ${error.message}`);
  return data?.[0] ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCard(slug);
  const title = card
    ? `${card.full_name} — Membership Verification`
    : "Membership Verification";
  return {
    title,
    description: `Official ${SITE.name} membership verification.`,
    robots: { index: false, follow: false },
  };
}

type Banner = {
  tone: "verified" | "warn" | "danger";
  icon: typeof ShieldCheck;
  title: string;
  subtitle: string;
};

function bannerFor(card: MemberCard): Banner {
  if (!card.card_active) {
    return {
      tone: "danger",
      icon: ShieldX,
      title: "Card Deactivated",
      subtitle: "This NFC card is no longer valid for verification.",
    };
  }
  if (card.status === "active") {
    return {
      tone: "verified",
      icon: ShieldCheck,
      title: "Verified Member",
      subtitle: "This member is in good standing with Tau Gamma Phi.",
    };
  }
  if (card.status === "pending") {
    return {
      tone: "warn",
      icon: ShieldAlert,
      title: "Pending Verification",
      subtitle: "This membership has not yet been activated.",
    };
  }
  return {
    tone: "danger",
    icon: ShieldX,
    title: "Not In Good Standing",
    subtitle: "This membership is not currently active.",
  };
}

function DetailRow({
  label,
  value,
  icon: Icon,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof MapPin;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5 text-gold/50" aria-hidden="true" />}
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-right text-sm text-foreground",
          mono ? "tgp-mono" : "tgp-display",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function OfficerRow({
  label,
  name,
  contact,
}: {
  label: string;
  name: string | null;
  contact: string | null;
}) {
  if (!name && !contact) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        <div className="tgp-display text-sm text-foreground">{name ?? "—"}</div>
        {contact && (
          <a
            href={`tel:${contact}`}
            className="tgp-mono mt-0.5 inline-flex items-center gap-1 text-xs text-gold hover:text-gold-bright"
          >
            <Phone className="size-3" aria-hidden="true" />
            {contact}
          </a>
        )}
      </dd>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
        This page is an official record of the {SITE.legalName} digital registry.
      </p>
    </main>
  );
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = await getCard(slug);

  if (!card) {
    return (
      <PageShell>
        <div className="rounded-xl border border-destructive/40 bg-card p-8 text-center">
          <TgpSeal className="mx-auto mb-4 size-14 rounded-full opacity-80" />
          <ShieldX className="mx-auto size-10 text-destructive" />
          <h1 className="tgp-display mt-4 text-xl font-bold">
            Card Not Recognized
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This verification code does not match any record in the Tau Gamma
            Phi registry.
          </p>
          <p className="tgp-mono mt-4 text-xs break-all text-muted-foreground/70">
            {slug}
          </p>
        </div>
      </PageShell>
    );
  }

  const banner = bannerFor(card);
  const BannerIcon = banner.icon;
  const verifiedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  const survived = card.date_survived
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
        new Date(card.date_survived),
      )
    : null;

  return (
    <PageShell>
      <article className="group relative isolate overflow-hidden rounded-2xl bg-card tgp-frame tgp-glow">
        {/* Security-pattern wash behind the credential */}
        <div
          className="pointer-events-none absolute inset-0 tgp-guilloche opacity-60"
          aria-hidden="true"
        />
        {/* Watermark seal */}
        <TgpSeal
          title=""
          className="pointer-events-none absolute -right-12 -bottom-14 -z-0 size-52 opacity-[0.05]"
        />

        {/* Document header */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-gold/30 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent px-5 py-3">
          <div className="flex items-center gap-2.5">
            <TgpSeal className="size-9" />
            <div className="leading-tight">
              <p className="tgp-display text-[12px] font-bold tracking-[0.14em] text-foreground">
                TAU GAMMA PHI
              </p>
              <p className="mt-0.5 text-[7.5px] tracking-[0.3em] text-gold/70 uppercase">
                Official Fraternity Registry
              </p>
            </div>
          </div>
          <div className="text-right leading-none">
            <p className="tgp-eyebrow text-[7px] text-gold/60">Type</p>
            <p className="tgp-mono mt-1 text-[11px] font-semibold tracking-[0.18em] text-gold">
              TGP·ID
            </p>
          </div>
        </div>

        {/* Verification banner (adapts to standing) */}
        {banner.tone === "verified" ? (
          <div className="relative z-10 flex items-center justify-center gap-2 border-b border-gold/40 bg-gold/15 px-4 py-3">
            <ShieldCheck
              className="size-5 text-gold-bright"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <span className="tgp-eyebrow text-sm text-gold-bright">
              Verified Member
            </span>
            <ShieldCheck
              className="size-5 text-gold-bright"
              strokeWidth={2.25}
              aria-hidden="true"
            />
          </div>
        ) : (
          <div
            className={cn(
              "relative z-10 flex items-center justify-center gap-2.5 border-b px-4 py-3 text-center",
              banner.tone === "warn" &&
                "border-amber-500/40 bg-amber-500/15 text-amber-300",
              banner.tone === "danger" &&
                "border-destructive/40 bg-destructive/15 text-destructive",
            )}
          >
            <BannerIcon className="size-5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <div className="leading-tight">
              <div className="tgp-eyebrow text-sm">{banner.title}</div>
              <div className="text-[0.65rem] opacity-90">{banner.subtitle}</div>
            </div>
          </div>
        )}

        {/* Identity hero */}
        <div className="relative z-10 flex items-start gap-4 px-5 pt-5 pb-4">
          <Avatar
            src={card.photo_url}
            name={card.full_name}
            size={104}
            rounded="lg"
            priority
            className="ring-1 ring-gold/40"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="tgp-display tgp-gild text-xl leading-tight font-semibold break-words">
              {card.full_name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {card.member_id && (
                <span className="tgp-mono inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-ink px-2 py-1 text-xs text-gold">
                  <Hash className="size-3.5" aria-hidden="true" />
                  {card.member_id}
                </span>
              )}
              <StatusBadge status={card.status} />
            </div>
          </div>
        </div>

        {/* Structured detail panel */}
        <div className="relative z-10 border-t border-gold/20 bg-ink/40 px-5 py-4">
          {/* Fraternal Information */}
          {(card.alexis_name ||
            card.batch_name ||
            card.chapter ||
            card.district ||
            card.region ||
            survived) && (
            <section>
              <div className="mb-2.5 flex items-center gap-2">
                <Hash className="size-3.5 text-gold/60" aria-hidden="true" />
                <h2 className="tgp-eyebrow text-[0.6rem] text-gold/80">
                  Fraternal Information
                </h2>
              </div>
              <dl className="divide-y divide-gold/15">
                {card.alexis_name && (
                  <DetailRow label="Alexis Name" value={card.alexis_name} />
                )}
                {card.batch_name && (
                  <DetailRow label="Batch Name" value={card.batch_name} />
                )}
                {card.chapter && (
                  <DetailRow label="Chapter" value={card.chapter} />
                )}
                {card.district && (
                  <DetailRow label="District" value={card.district} />
                )}
                {card.region && (
                  <DetailRow label="Council" value={card.region} icon={MapPin} />
                )}
                {survived && (
                  <DetailRow
                    label="Date Survived"
                    value={survived}
                    icon={CalendarDays}
                    mono
                  />
                )}
              </dl>
            </section>
          )}

          {/* Lineage — GT & MWW when survived, with contact numbers */}
          {(card.gt_name ||
            card.gt_number ||
            card.mww_name ||
            card.mww_number) && (
            <section className="mt-4 border-t border-gold/15 pt-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Users className="size-3.5 text-gold/60" aria-hidden="true" />
                <h2 className="tgp-eyebrow text-[0.6rem] text-gold/80">
                  Lineage · When Survived
                </h2>
              </div>
              <dl className="divide-y divide-gold/15">
                <OfficerRow
                  label="Grand Triskelion (GT)"
                  name={card.gt_name}
                  contact={card.gt_number}
                />
                <OfficerRow label="MWW" name={card.mww_name} contact={card.mww_number} />
              </dl>
            </section>
          )}
        </div>

        {/* Verify via the responsible officer (chapter → district). Hidden when none. */}
        {card.verify_contact_number && (
          <div className="relative z-10 border-t border-gold/20 px-5 py-4">
            <a
              href={`tel:${card.verify_contact_number}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-gold px-4 py-3 text-primary-foreground transition-opacity hover:opacity-90"
            >
              <span className="flex items-center gap-2.5">
                <Phone className="size-5" strokeWidth={2.25} aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="tgp-eyebrow text-[0.6rem]">
                    Call officer to verify
                  </span>
                  {card.verify_contact_name && (
                    <span className="text-[0.7rem] font-medium opacity-90">
                      {card.verify_contact_name}
                    </span>
                  )}
                  <span className="tgp-mono text-sm font-semibold">
                    {card.verify_contact_number}
                  </span>
                </span>
              </span>
              <span className="text-[0.6rem] font-medium tracking-wide uppercase opacity-70">
                Tap
              </span>
            </a>
            <p className="mt-2 text-center text-[0.65rem] text-muted-foreground">
              Speak with a fraternity officer to confirm this member
            </p>
          </div>
        )}

        {/* Stamped footer */}
        <div className="relative z-10 flex flex-col items-center gap-1 border-t border-gold/40 bg-ink px-5 py-3 text-center">
          <span className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-gold/70" aria-hidden="true" />
            Verified {verifiedAt}
          </span>
          <span className="tgp-eyebrow text-[0.55rem] text-gold/50">
            {SITE.motto}
          </span>
        </div>
      </article>
    </PageShell>
  );
}
