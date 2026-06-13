import Image from "next/image";

import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Member photo with graceful initials fallback. Square by default; pass
 * `rounded="full"` for a circular avatar.
 */
export function Avatar({
  src,
  name,
  size = 96,
  rounded = "lg",
  className,
  priority = false,
}: {
  src?: string | null;
  name: string;
  size?: number;
  rounded?: "lg" | "full";
  className?: string;
  priority?: boolean;
}) {
  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        "relative shrink-0 overflow-hidden border border-gold/30 bg-secondary tgp-guilloche",
        rounded === "full" ? "rounded-full" : "rounded-lg",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={name}
          width={size}
          height={size}
          preload={priority}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="tgp-display flex h-full w-full items-center justify-center text-gold/70">
          <span style={{ fontSize: size * 0.34 }} className="font-bold tracking-tight">
            {initialsOf(name)}
          </span>
        </div>
      )}
    </div>
  );
}
