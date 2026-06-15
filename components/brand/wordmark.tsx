import { Brandmark } from "@/components/brand/brandmark";
import { cn } from "@/lib/utils";

export function Wordmark({
  name,
  logoUrl,
  className,
  sealClassName,
  showRegistry = true,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
  sealClassName?: string;
  showRegistry?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Brandmark name={name} logoUrl={logoUrl} className={cn("size-10", sealClassName)} />
      <div className="leading-tight">
        <div className="tgp-display text-sm font-bold tracking-[0.18em] text-foreground">
          {name}
        </div>
        {showRegistry && (
          <div className="text-[10px] tracking-[0.3em] text-gold/80 uppercase">
            Membership Registry
          </div>
        )}
      </div>
    </div>
  );
}
