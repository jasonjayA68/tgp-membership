import { BadgeCheck, Ban, Clock, MinusCircle, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { STATUS_META } from "@/lib/constants";
import type { MemberStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE_VARIANT = {
  gold: "gold",
  amber: "amber",
  muted: "muted",
  danger: "danger",
} as const;

const STATUS_ICON: Record<MemberStatus, typeof BadgeCheck> = {
  active: BadgeCheck,
  pending: Clock,
  inactive: MinusCircle,
  suspended: Ban,
  rejected: XCircle,
};

export function StatusBadge({
  status,
  className,
}: {
  status: MemberStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={TONE_VARIANT[meta.tone]} className={cn("uppercase tracking-wide", className)}>
      <Icon />
      {meta.label}
    </Badge>
  );
}
