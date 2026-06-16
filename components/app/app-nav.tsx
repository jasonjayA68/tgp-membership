"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogOut, ShieldCheck, UserCog } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/actions/auth";
import { tenantHref } from "@/lib/tenant/links";

const BASE_LINKS = [
  { href: "/dashboard", label: "Portal", icon: LayoutDashboard },
  { href: "/profile", label: "Profile", icon: UserCog },
];

export function AppNav({
  basePath,
  isAdmin,
  brand,
}: {
  basePath: string;
  isAdmin: boolean;
  brand: { name: string; logoUrl: string | null };
}) {
  const pathname = usePathname();
  const links = isAdmin
    ? [...BASE_LINKS, { href: "/admin", label: "Admin", icon: ShieldCheck }]
    : BASE_LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href={tenantHref(basePath, "/dashboard")} aria-label={`${brand.name} home`}>
          <Wordmark name={brand.name} logoUrl={brand.logoUrl} showRegistry={false} sealClassName="size-9" />
        </Link>

        <nav className="flex items-center gap-1">
          {links.map((link) => {
            const href = tenantHref(basePath, link.href);
            const active = pathname === href || pathname.startsWith(href + "/");
            const Icon = link.icon;
            return (
              <Button
                key={link.href}
                asChild
                size="sm"
                variant={active ? "secondary" : "ghost"}
              >
                <Link href={href}>
                  <Icon />
                  <span className="hidden sm:inline">{link.label}</span>
                </Link>
              </Button>
            );
          })}

          <form action={signOut}>
            <input type="hidden" name="redirectTo" value={tenantHref(basePath, "/home")} />
            <Button type="submit" size="sm" variant="ghost">
              <LogOut />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
