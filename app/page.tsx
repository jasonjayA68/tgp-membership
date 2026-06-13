import Link from "next/link";
import { Nfc, ScanLine, ShieldCheck } from "lucide-react";

import { TgpSeal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/constants";

const FEATURES = [
  {
    icon: Nfc,
    title: "NFC Verification",
    body: "Every member carries an NFC card that resolves to a live, official verification page on tap.",
  },
  {
    icon: ShieldCheck,
    title: "Digital Identity",
    body: "A tamper-resistant digital ID, issued and governed by the fraternity administration.",
  },
  {
    icon: ScanLine,
    title: "Authoritative Registry",
    body: "A single source of truth for membership standing, secured end to end with row-level access control.",
  },
];

export default function HomePage() {
  return (
    <main className="relative flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <TgpSeal className="size-32 rounded-full tgp-glow sm:size-40" />

        <p className="tgp-eyebrow mt-8 text-[11px] text-gold/80">
          Est. {SITE.founded} · Official Digital Registry
        </p>

        <h1 className="tgp-display tgp-gild mt-3 text-4xl font-black tracking-[0.08em] sm:text-6xl">
          TAU GAMMA PHI
        </h1>

        <p className="tgp-eyebrow mt-3 text-xs text-foreground/70">
          {SITE.motto}
        </p>

        <p className="mt-6 max-w-xl text-balance text-muted-foreground">
          The official digital membership registry of Tau Gamma Phi. Issue
          digital IDs, manage chapters, and verify any member&apos;s standing
          instantly through NFC.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login">Member Sign In</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/register">Apply for Membership</Link>
          </Button>
        </div>

        <div className="mt-16 grid w-full gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-card/60 p-5 text-left"
              >
                <Icon className="size-5 text-gold" />
                <h2 className="tgp-display mt-3 text-sm font-semibold tracking-wide">
                  {feature.title}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {SITE.legalName}
      </footer>
    </main>
  );
}
