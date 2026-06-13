"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Building2, ScrollText } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Members", icon: Users, exact: true },
  { href: "/admin/chapters", label: "Chapters", icon: Building2 },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1.5">
      {LINKS.map((link) => {
        const active = link.exact
          ? pathname === link.href ||
            pathname.startsWith("/admin/members")
          : pathname === link.href || pathname.startsWith(link.href + "/");
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
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
