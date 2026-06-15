import { Brandmark } from "@/components/brand/brandmark";
import { StatusBadge } from "@/components/brand/status-badge";
import { Avatar } from "@/components/ui/avatar";
import type { MemberStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface IdCardData {
  fullName: string;
  alexisName?: string | null;
  memberId: string | null;
  chapter: string | null;
  district?: string | null;
  council?: string | null;
  batchName?: string | null;
  status: MemberStatus;
  photoUrl: string | null;
  orgName: string;
  orgLogoUrl: string | null;
}

function Detail({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[8px] font-medium tracking-[0.22em] text-gold/60 uppercase">
        {label}
      </div>
      <div
        className={cn(
          "truncate text-sm text-foreground",
          mono && "tgp-mono tracking-tight",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The official digital membership ID — government-ID / certificate aesthetic.
 * Used in the member portal and in the admin member preview.
 */
export function IdCard({
  data,
  className,
  photoPriority = false,
}: {
  data: IdCardData;
  className?: string;
  photoPriority?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative isolate overflow-hidden rounded-2xl border border-gold/35 bg-card tgp-guilloche tgp-glow",
        "transition-transform duration-300 ease-out hover:-translate-y-0.5",
        className,
      )}
    >
      {/* Top sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-20 bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,color-mix(in_oklab,var(--gold)_18%,transparent),transparent_70%)] opacity-70 transition-opacity duration-300 group-hover:opacity-100"
      />

      {/* Header band */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-gold/25 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Brandmark name={data.orgName} logoUrl={data.orgLogoUrl} className="size-8" />
          <div className="leading-none">
            <div className="tgp-display text-[12px] font-bold tracking-[0.18em] text-foreground">
              {data.orgName}
            </div>
            <div className="mt-1 text-[8px] tracking-[0.3em] text-gold/70 uppercase">
              Member Identification
            </div>
          </div>
        </div>
        <StatusBadge status={data.status} className="scale-90" />
      </div>

      {/* Body */}
      <div className="relative z-10 flex gap-5 p-5">
        <div className="relative shrink-0">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1.5 -z-10 rounded-2xl bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--gold)_26%,transparent),transparent)] opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-100"
          />
          <Avatar
            src={data.photoUrl}
            name={data.fullName}
            size={112}
            rounded="lg"
            priority={photoPriority}
            className="ring-1 ring-gold/40"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[8px] font-medium tracking-[0.24em] text-gold/60 uppercase">
              Registered Name
            </div>
            <div className="tgp-display tgp-gild mt-0.5 truncate text-lg font-semibold tracking-tight">
              {data.fullName || "—"}
            </div>
            {data.alexisName && (
              <div className="truncate text-xs text-gold/80 italic">
                &ldquo;{data.alexisName}&rdquo;
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Member ID" mono value={data.memberId ?? "PENDING"} />
            <Detail label="Batch" value={data.batchName ?? "—"} />
            <Detail label="Chapter" value={data.chapter ?? "Unassigned"} />
            <Detail label="District" value={data.district ?? "—"} />
            <Detail label="Council" value={data.council ?? "—"} />
          </div>
        </div>
      </div>

      {/* Hairline rule */}
      <div aria-hidden="true" className="relative z-10 mx-5 h-px tgp-rule" />

      {/* Footer band */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-5 py-2.5">
        <span className="tgp-mono text-[9px] tracking-wider text-gold/60">
          {data.memberId ?? "TGP-————"}
        </span>
        <span className="tgp-eyebrow text-[7px] text-gold/60">{data.orgName}</span>
      </div>

      {/* Watermark seal */}
      <Brandmark
        name={data.orgName}
        logoUrl={data.orgLogoUrl}
        className="pointer-events-none absolute -right-10 -bottom-12 -z-0 size-48 opacity-[0.06]"
      />
    </div>
  );
}
