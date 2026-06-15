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
  );
}
