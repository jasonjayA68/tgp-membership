import * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs font-medium tracking-wide text-foreground/90 uppercase select-none",
        "has-disabled:opacity-50 peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
