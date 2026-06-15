import Link from "next/link";

import { Brandmark } from "@/components/brand/brandmark";

export function AuthBrandHeader({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[640px] bg-[radial-gradient(ellipse_82%_55%_at_50%_0%,color-mix(in_oklab,var(--gold)_18%,transparent),color-mix(in_oklab,var(--gold)_6%,transparent)_40%,transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[520px] bg-gradient-to-b from-transparent to-background [mask-image:linear-gradient(to_bottom,transparent,black_88%)]"
      />
      <Link
        href="/"
        className="mb-8 flex flex-col items-center gap-3 text-center transition-opacity hover:opacity-90"
      >
      <span className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 scale-[1.9] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--gold)_34%,transparent),transparent_68%)] blur-lg"
        />
        <Brandmark name={name} logoUrl={logoUrl} className="size-20 tgp-frame tgp-glow" />
      </span>
      <span className="block">
        <span className="tgp-eyebrow block text-[10px] text-gold/80">Official Registry</span>
        <span className="tgp-display block text-xl font-bold tracking-[0.16em]">{name}</span>
      </span>
      </Link>
    </>
  );
}
