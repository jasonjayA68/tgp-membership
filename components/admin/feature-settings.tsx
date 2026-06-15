import { CheckCircle2, Circle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { setTenantFeature } from "@/lib/actions/settings";
import { FEATURES, isFeatureEnabled } from "@/lib/features";

export function FeatureSettings({ flags }: { flags: Record<string, boolean> }) {
  return (
    <Card className="divide-y divide-border">
      {FEATURES.map((f) => {
        const on = isFeatureEnabled(flags, f.key);
        return (
          <div key={f.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{f.label}</div>
              <div className="text-xs text-muted-foreground">{f.description}</div>
            </div>
            <form action={setTenantFeature}>
              <input type="hidden" name="key" value={f.key} />
              <input type="hidden" name="enabled" value={(!on).toString()} />
              <SubmitButton size="sm" variant={on ? "secondary" : "outline"} pendingText="…">
                {on ? <CheckCircle2 /> : <Circle />}
                {on ? "Enabled" : "Disabled"}
              </SubmitButton>
            </form>
          </div>
        );
      })}
    </Card>
  );
}
