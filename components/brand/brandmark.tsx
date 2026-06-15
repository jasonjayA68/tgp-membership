import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((w) => w[0]).join("").toUpperCase() || "•";
}

/** Tenant logo image if set, else an accent-tinted initials monogram. */
export function Brandmark({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoUrl}
        alt=""
        className={cn("rounded-full object-cover ring-1 ring-gold/40", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "tgp-display inline-flex items-center justify-center rounded-full bg-ink font-bold text-gold ring-1 ring-gold/40",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
