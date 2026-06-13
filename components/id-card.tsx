import { TgpSeal } from "@/components/brand/seal";
import { StatusBadge } from "@/components/brand/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { SITE } from "@/lib/constants";
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
        "relative isolate overflow-hidden rounded-xl border border-gold/40 bg-card tgp-guilloche tgp-glow",
        className,
      )}
    >
      {/* Header band */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-b border-gold/30 bg-gradient-to-r from-gold/15 via-gold/5 to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <TgpSeal className="size-7" />
          <div className="leading-none">
            <div className="tgp-display text-[11px] font-bold tracking-[0.16em] text-foreground">
              TAU GAMMA PHI
            </div>
            <div className="mt-0.5 text-[8px] tracking-[0.28em] text-gold/70 uppercase">
              Member Identification
            </div>
          </div>
        </div>
        <StatusBadge status={data.status} className="scale-90" />
      </div>

      {/* Body */}
      <div className="relative z-10 flex gap-4 p-4">
        <Avatar
          src={data.photoUrl}
          name={data.fullName}
          size={104}
          rounded="lg"
          priority={photoPriority}
          className="ring-1 ring-gold/40"
        />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[8px] font-medium tracking-[0.22em] text-gold/60 uppercase">
              Registered Name
            </div>
            <div className="tgp-display truncate text-base font-semibold tracking-tight text-foreground">
              {data.fullName || "—"}
            </div>
            {data.alexisName && (
              <div className="truncate text-xs text-gold/80 italic">
                “{data.alexisName}”
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Detail label="Member ID" mono value={data.memberId ?? "PENDING"} />
            <Detail label="Batch" value={data.batchName ?? "—"} />
            <Detail label="Chapter" value={data.chapter ?? "Unassigned"} />
            <Detail label="District" value={data.district ?? "—"} />
            <Detail label="Council" value={data.council ?? "—"} />
          </div>
        </div>
      </div>

      {/* Footer band */}
      <div className="relative z-10 flex items-center justify-between gap-2 border-t border-gold/30 px-4 py-2">
        <span className="tgp-mono text-[9px] tracking-wider text-gold/60">
          {data.memberId ?? "TGP-————"}
        </span>
        <span className="tgp-eyebrow text-[7px] text-gold/60">
          {SITE.motto}
        </span>
      </div>

      {/* Watermark seal */}
      <TgpSeal
        title=""
        className="pointer-events-none absolute -right-10 -bottom-12 -z-0 size-48 opacity-[0.06]"
      />
    </div>
  );
}
