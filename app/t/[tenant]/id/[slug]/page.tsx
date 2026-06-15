import { cache } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  CalendarDays,
  Hash,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { StatusBadge } from "@/components/brand/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { NotRecognizedCard } from "@/components/verify/not-recognized";
import { createClient } from "@/lib/supabase/server";
import type { MemberCard, PublicField } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Memoised per request so generateMetadata + the page share one read. */
const getCard = cache(async (slug: string): Promise<MemberCard | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_member_card", { card_slug: slug });
  if (error) throw new Error(`Verification lookup failed: ${error.message}`);
  return (data?.[0] as MemberCard | undefined) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = await getCard(slug);
  const org = card?.tenant_name ?? "Membership";
  return {
    title: card ? `${card.full_name} — ${org} Verification` : "Membership Verification",
    description: `Official ${org} membership verification.`,
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
      subtitle: `This member is in good standing with ${card.tenant_name}.`,
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

function FieldValue({ field }: { field: PublicField }) {
  if (field.type === "phone") {
    return (
      <a
        href={`tel:${field.value}`}
        className="tgp-mono inline-flex items-center gap-1 text-gold hover:text-gold-bright"
      >
        <Phone className="size-3" aria-hidden="true" />
        {field.value}
      </a>
    );
  }
  if (field.type === "date") {
    const d = new Date(field.value);
    return (
      <span className="tgp-mono">
        {Number.isNaN(d.getTime())
          ? field.value
          : new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(d)}
      </span>
    );
  }
  return <span className="tgp-display">{field.value}</span>;
}

function DetailRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof MapPin;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5 text-gold/50" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
        Official digital membership verification record.
      </p>
    </main>
  );
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>;
}) {
  const { tenant, slug } = await params;
  const card = await getCard(slug);

  if (!card) {
    return (
      <PageShell>
        <NotRecognizedCard slug={slug} />
      </PageShell>
    );
  }

  // The card slug is authoritative — correct the URL to the card's real tenant.
  if (tenant !== card.tenant_slug) {
    redirect(`/t/${card.tenant_slug}/id/${slug}`);
  }

  // Record the scan, once, on the canonical render. The RPC itself no-ops for
  // inactive cards (its WHERE clause filters `active = true`).
  const supabase = await createClient();
  await supabase.rpc("record_card_scan", { card_slug: slug });

  const banner = bannerFor(card);
  const BannerIcon = banner.icon;
  const verifiedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  const hasChapter = card.chapter || card.district || card.region;

  return (
    <PageShell>
      <article className="group relative isolate overflow-hidden rounded-2xl bg-card tgp-frame tgp-glow">
        <div
          className="pointer-events-none absolute inset-0 tgp-guilloche opacity-60"
          aria-hidden="true"
        />

        {/* Document header — tenant identity */}
        <div className="relative z-10 flex items-center justify-between gap-3 border-b border-gold/30 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent px-5 py-3">
          <div className="flex items-center gap-2.5">
            {card.tenant_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.tenant_logo_url}
                alt=""
                className="size-9 rounded-full object-cover ring-1 ring-gold/40"
              />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-ink ring-1 ring-gold/40">
                <ShieldCheck className="size-5 text-gold" aria-hidden="true" />
              </span>
            )}
            <div className="leading-tight">
              <p className="tgp-display text-[12px] font-bold tracking-[0.14em] text-foreground">
                {card.tenant_name}
              </p>
              <p className="mt-0.5 text-[7.5px] tracking-[0.3em] text-gold/70 uppercase">
                Official Registry
              </p>
            </div>
          </div>
          <div className="text-right leading-none">
            <p className="tgp-eyebrow text-[7px] text-gold/60">Type</p>
            <p className="tgp-mono mt-1 text-[11px] font-semibold tracking-[0.18em] text-gold">
              ID
            </p>
          </div>
        </div>

        {/* Verification banner */}
        <div
          className={cn(
            "relative z-10 flex items-center justify-center gap-2.5 border-b px-4 py-3 text-center",
            banner.tone === "verified" && "border-gold/40 bg-gold/15 text-gold-bright",
            banner.tone === "warn" && "border-amber-500/40 bg-amber-500/15 text-amber-300",
            banner.tone === "danger" && "border-destructive/40 bg-destructive/15 text-destructive",
          )}
        >
          <BannerIcon className="size-5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <div className="leading-tight">
            <div className="tgp-eyebrow text-sm">{banner.title}</div>
            <div className="text-[0.65rem] opacity-90">{banner.subtitle}</div>
          </div>
        </div>

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
              {card.full_name || "Member"}
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

        {/* Core + public fields */}
        {(hasChapter || card.batch_year || card.public_fields.length > 0) && (
          <div className="relative z-10 border-t border-gold/20 bg-ink/40 px-5 py-4">
            <dl className="divide-y divide-gold/15">
              {card.chapter && <DetailRow label="Chapter" value={card.chapter} />}
              {card.district && <DetailRow label="District" value={card.district} />}
              {card.region && <DetailRow label="Council" value={card.region} icon={MapPin} />}
              {card.batch_year && (
                <DetailRow label="Batch" value={card.batch_year} icon={CalendarDays} />
              )}
              {card.public_fields.map((field) => (
                <DetailRow
                  key={field.key}
                  label={field.label}
                  value={<FieldValue field={field} />}
                />
              ))}
            </dl>
          </div>
        )}

        {/* Verify via the responsible officer */}
        {card.verify_contact_number && (
          <div className="relative z-10 border-t border-gold/20 px-5 py-4">
            <a
              href={`tel:${card.verify_contact_number}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-gold px-4 py-3 text-primary-foreground transition-opacity hover:opacity-90"
            >
              <span className="flex items-center gap-2.5">
                <Phone className="size-5" strokeWidth={2.25} aria-hidden="true" />
                <span className="flex flex-col leading-tight">
                  <span className="tgp-eyebrow text-[0.6rem]">Call officer to verify</span>
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
          </div>
        )}

        {/* Stamped footer */}
        <div className="relative z-10 flex flex-col items-center gap-1 border-t border-gold/40 bg-ink px-5 py-3 text-center">
          <span className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-gold/70" aria-hidden="true" />
            Verified {verifiedAt}
          </span>
        </div>
      </article>
    </PageShell>
  );
}
