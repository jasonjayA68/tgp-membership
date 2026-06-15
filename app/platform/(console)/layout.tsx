import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/platform";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/platform" className="tgp-display text-lg font-bold tracking-wide">
            Platform Console
          </Link>
          <span className="tgp-eyebrow text-[10px] text-gold/70">Super Admin</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
