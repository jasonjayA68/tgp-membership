import Link from "next/link";
import { redirect } from "next/navigation";
import { Nfc, ScanLine, ShieldCheck, Building2, ArrowRight } from "lucide-react";

import { TgpSeal } from "@/components/brand/seal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SITE } from "@/lib/constants";
import { getSessionUser, listMemberships } from "@/lib/auth";

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

export default async function HomePage() {
  const user = await getSessionUser();

  if (user) {
    const memberships = await listMemberships();
    if (memberships.length === 1) {
      redirect(`/t/${memberships[0].tenant.slug}/dashboard`);
    }
    return (
      <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <TgpSeal className="mx-auto size-16 rounded-full" />
            <h1 className="tgp-display mt-4 text-2xl font-bold">
              {memberships.length === 0 ? "No workspaces yet" : "Your workspaces"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {memberships.length === 0
                ? "You're signed in but not a member of any organization yet."
                : "Choose a workspace to continue."}
            </p>
          </div>

          {memberships.length > 0 && (
            <div className="space-y-2">
              {memberships.map(({ tenant, role }) => (
                <Card key={tenant.id} className="p-0">
                  <Link
                    href={`/t/${tenant.slug}/dashboard`}
                    className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
                  >
                    <Building2 className="size-5 text-gold" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {tenant.name}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {role}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </Card>
              ))}
            </div>
          )}

          <form action="/login" className="mt-6 text-center">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Switch account</Link>
            </Button>
          </form>
        </div>
      </main>
    );
  }

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
        <p className="tgp-eyebrow mt-3 text-xs text-foreground/70">{SITE.motto}</p>
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
            <Link href="/register?tenant=tgp">Apply for Membership</Link>
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
