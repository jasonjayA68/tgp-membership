import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Power, ShieldCheck, Archive, ArchiveRestore } from "lucide-react";

import { AssignOwnerForm } from "@/components/platform/assign-owner-form";
import { BrandingForm } from "@/components/platform/branding-form";
import { DomainCard } from "@/components/platform/domain-card";
import { EditOrgForm } from "@/components/platform/edit-org-form";
import { TenantStatusBadge } from "@/components/platform/tenant-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { setTenantStatus, archiveTenant, restoreTenant } from "@/lib/actions/platform";
import { listTenantAdmins } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types";

export const metadata: Metadata = { title: "Manage Organization" };

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", id)
    .maybeSingle<Tenant>();
  if (error) throw error;
  if (!tenant) notFound();

  const [admins, memberCountResult] = await Promise.all([
    listTenantAdmins(tenant.id),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
  ]);
  if (memberCountResult.error) throw memberCountResult.error;
  const memberCount = memberCountResult.count ?? 0;
  const nextStatus = tenant.status === "suspended" ? "active" : "suspended";

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/platform">
          <ArrowLeft />
          All organizations
        </Link>
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="tgp-display text-2xl font-bold tracking-tight">{tenant.name}</h1>
          <p className="tgp-mono text-xs text-muted-foreground">
            /{tenant.slug} · {tenant.member_id_prefix} · {memberCount} member{memberCount === 1 ? "" : "s"}
          </p>
        </div>
        <TenantStatusBadge status={tenant.status} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Owners &amp; admins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {admins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No owner assigned yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {admins.map((a) => (
                  <li key={a.user_id} className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-gold/70" />
                      {a.name}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{a.role}</span>
                  </li>
                ))}
              </ul>
            )}
            <AssignOwnerForm tenantId={tenant.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {tenant.status === "suspended"
                ? "This organization is suspended — its workspace shows a suspended notice."
                : "This organization is active."}
            </p>
            <form action={setTenantStatus}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <input type="hidden" name="status" value={nextStatus} />
              <SubmitButton
                size="sm"
                variant={nextStatus === "suspended" ? "destructive" : "default"}
                pendingText="…"
              >
                <Power />
                {nextStatus === "suspended" ? "Suspend" : "Reactivate"}
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent>
          <BrandingForm
            tenantId={tenant.id}
            name={tenant.name}
            logoUrl={tenant.logo_url}
            primaryColor={tenant.primary_color}
            secondaryColor={tenant.secondary_color}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom domain</CardTitle>
        </CardHeader>
        <CardContent>
          <DomainCard
            tenantId={tenant.id}
            domain={tenant.custom_domain}
            token={tenant.domain_verify_token}
            verifiedAt={tenant.domain_verified_at}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit organization</CardTitle>
        </CardHeader>
        <CardContent>
          <EditOrgForm
            tenantId={tenant.id}
            name={tenant.name}
            slug={tenant.slug}
            prefix={tenant.member_id_prefix}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tenant.status === "archived" ? (
            <>
              <p className="text-sm text-muted-foreground">
                This organization is archived — its workspace is offline and it&apos;s hidden from the
                list. Restore it to bring it back.
              </p>
              <form action={restoreTenant}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <SubmitButton size="sm" pendingText="…">
                  <ArchiveRestore />
                  Restore organization
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Archiving takes the organization offline and hides it from the list. No data is
                deleted; you can restore it anytime.
              </p>
              <form action={archiveTenant}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <SubmitButton size="sm" variant="destructive" pendingText="…">
                  <Archive />
                  Archive organization
                </SubmitButton>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
