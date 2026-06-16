"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleAlert, Globe, ShieldCheck, ShieldQuestion, Trash2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  markCustomDomainVerified,
  removeCustomDomain,
  setCustomDomain,
  verifyCustomDomain,
  type PlatformState,
} from "@/lib/actions/platform";

const initial: PlatformState = {};

export function DomainCard({
  tenantId,
  domain,
  token,
  verifiedAt,
}: {
  tenantId: string;
  domain: string | null;
  token: string | null;
  verifiedAt: string | null;
}) {
  const [setState, setAction] = useActionState(setCustomDomain, initial);
  const [verifyState, verifyAction] = useActionState(verifyCustomDomain, initial);
  const [markState, markAction] = useActionState(markCustomDomainVerified, initial);
  const [removeState, removeAction] = useActionState(removeCustomDomain, initial);

  const error = setState.error || verifyState.error || markState.error || removeState.error;
  const notice = setState.notice || verifyState.notice || markState.notice || removeState.notice;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{error}</span>
        </Alert>
      )}
      {!error && notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{notice}</span>
        </Alert>
      )}

      {!domain ? (
        <form action={setAction} className="space-y-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field>
            <Label htmlFor="domain">Custom domain</Label>
            <Input id="domain" name="domain" placeholder="members.acme.org" />
          </Field>
          <SubmitButton size="sm" pendingText="Saving…">
            <Globe />
            Save domain
          </SubmitButton>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="tgp-mono text-sm break-all">{domain}</span>
            {verifiedAt ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-emerald-500">
                <ShieldCheck className="size-3.5" /> Verified
              </span>
            ) : (
              <span className="shrink-0 text-xs text-amber-500">Pending verification</span>
            )}
          </div>

          {!verifiedAt && (
            <div className="space-y-2 rounded border border-border bg-muted/30 p-3 text-xs">
              <p className="text-muted-foreground">1. Add this DNS TXT record at your domain provider:</p>
              <div className="tgp-mono space-y-0.5">
                <div>
                  <span className="text-muted-foreground">Name:</span> _tgp-verify.{domain}
                </div>
                <div className="break-all">
                  <span className="text-muted-foreground">Value:</span> {token}
                </div>
              </div>
              <p className="text-muted-foreground">
                2. Add <span className="tgp-mono">{domain}</span> to the Vercel project (Settings →
                Domains) and point the domain&apos;s DNS at Vercel. TLS is issued automatically.
              </p>
              <p className="border-t border-border/60 pt-2 text-muted-foreground">
                No DNS control (e.g. a <span className="tgp-mono">*.vercel.app</span> demo subdomain)?
                Use <span className="text-foreground">Mark verified</span> to skip the TXT check.
              </p>
            </div>
          )}

          {verifiedAt && (
            <a
              href={`https://${domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gold underline"
            >
              https://{domain}
            </a>
          )}

          <div className="flex gap-2">
            {!verifiedAt && (
              <form action={verifyAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <SubmitButton size="sm" pendingText="Checking…">
                  <ShieldCheck />
                  Verify
                </SubmitButton>
              </form>
            )}
            {!verifiedAt && (
              <form action={markAction}>
                <input type="hidden" name="tenantId" value={tenantId} />
                <SubmitButton size="sm" variant="outline" pendingText="…">
                  <ShieldQuestion />
                  Mark verified
                </SubmitButton>
              </form>
            )}
            <form action={removeAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <SubmitButton size="sm" variant="destructive" pendingText="…">
                <Trash2 />
                Remove
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
