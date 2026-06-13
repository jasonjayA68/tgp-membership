import { TgpSeal } from "@/components/brand/seal";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Wordmark({
  className,
  sealClassName,
  showRegistry = true,
}: {
  className?: string;
  sealClassName?: string;
  showRegistry?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <TgpSeal className={cn("size-10", sealClassName)} />
      <div className="leading-tight">
        <div className="tgp-display text-sm font-bold tracking-[0.18em] text-foreground">
          TAU GAMMA PHI
        </div>
        {showRegistry && (
          <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">
            {SITE.registry}
          </div>
        )}
      </div>
    </div>
  );
}
