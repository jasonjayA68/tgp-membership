"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Building2, ScrollText, LayoutTemplate, Settings } from "lucide-react";

import { isFeatureEnabled, type FeatureKey } from "@/lib/features";
import { tenantHref } from "@/lib/tenant/links";
import { cn } from "@/lib/utils";

const LINKS: {
  href: string;
  label: string;
  icon: typeof Users;
  exact?: boolean;
  feature?: FeatureKey;
}[] = [
  { href: "/admin", label: "Members", icon: Users, exact: true },
  { href: "/admin/chapters", label: "Chapters", icon: Building2, feature: "chapters" },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText, feature: "audit" },
  { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate, feature: "homepage" },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminNav({
  basePath,
  features,
}: {
  basePath: string;
  features: Record<string, boolean>;
}) {
  const pathname = usePathname();
  const membersHref = tenantHref(basePath, "/admin/members");
  const links = LINKS.filter((l) => !l.feature || isFeatureEnabled(features, l.feature));

  return (
    <nav className="flex flex-wrap gap-1.5">
      {links.map((link) => {
        const href = tenantHref(basePath, link.href);
        const active = link.exact
          ? pathname === href || pathname.startsWith(membersHref)
          : pathname === href || pathname.startsWith(href + "/");
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-gold/40 bg-gold/15 text-gold-bright"
                : "border-border text-muted-foreground hover:border-gold/30 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
