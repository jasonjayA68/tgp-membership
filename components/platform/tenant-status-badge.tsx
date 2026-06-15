import { Badge } from "@/components/ui/badge";
import type { TenantStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const META: Record<TenantStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "border-gold/40 bg-gold/15 text-gold-bright" },
  suspended: { label: "Suspended", className: "border-destructive/40 bg-destructive/15 text-destructive" },
  onboarding: { label: "Onboarding", className: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
};

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const meta = META[status];
  return <Badge className={cn("border", meta.className)}>{meta.label}</Badge>;
}
