import Link from "next/link";
import { redirect } from "next/navigation";
import { Nfc, ScanLine, ShieldCheck, Building2, ArrowRight } from "lucide-react";

import { Brandmark } from "@/components/brand/brandmark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PLATFORM } from "@/lib/constants";
import { getSessionUser, listMemberships } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";

const FEATURES = [
  {
    icon: Nfc,
    title: "NFC Verification",
    body: "Every member carries an NFC card that resolves to a live, official verification page on tap.",
  },
  {
    icon: ShieldCheck,
    title: "Digital Identity",
    body: "A tamper-resistant digital ID, issued and governed by each organization's administration.",
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
    const [memberships, admin] = await Promise.all([
      listMemberships(),
      isPlatformAdmin(),
    ]);
    // Non-admins with exactly one workspace go straight in; admins stay to see
    // the console link.
    if (!admin && memberships.length === 1) {
      redirect(`/t/${memberships[0].tenant.slug}/dashboard`);
    }
    return (
      <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <Brandmark name={PLATFORM.name} logoUrl={null} className="mx-auto size-16 text-xl" />
            <h1 className="tgp-display mt-4 text-2xl font-bold">
              {memberships.length === 0 ? "No workspaces yet" : "Your workspaces"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {memberships.length === 0
                ? "You're signed in but not a member of any organization yet."
                : "Choose a workspace to continue."}
            </p>
          </div>

          {admin && (
            <Card className="mb-3 border-gold/40 p-0">
              <Link
                href="/platform"
                className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40"
              >
                <ShieldCheck className="size-5 text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">Platform console</span>
                  <span className="text-xs text-muted-foreground">Manage all organizations</span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            </Card>
          )}

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
                      <span className="block truncate font-medium">{tenant.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">{role}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </Card>
              ))}
            </div>
          )}

          <div className="mt-6 text-center">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Switch account</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <Brandmark name={PLATFORM.name} logoUrl={null} className="size-24 text-3xl tgp-glow" />
        <p className="tgp-eyebrow mt-8 text-[11px] text-gold/80">{PLATFORM.tagline}</p>
        <h1 className="tgp-display tgp-gild mt-3 text-4xl font-black tracking-[0.06em] sm:text-5xl">
          {PLATFORM.name}
        </h1>
        <p className="mt-6 max-w-xl text-balance text-muted-foreground">
          {PLATFORM.description}
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/platform/login">Administrator sign-in</Link>
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
                <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
              </div>
            );
          })}
        </div>
      </div>
      <footer className="border-t border-border py-6 text-center text-[11px] tracking-widest text-muted-foreground uppercase">
        {PLATFORM.name}
      </footer>
    </main>
  );
}
