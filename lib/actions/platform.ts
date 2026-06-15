"use server";

import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";

import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isCanonicalHost, normalizeHost } from "@/lib/tenant/host";
import type { TenantStatus } from "@/lib/types";

export type PlatformState = { error?: string; notice?: string };

/** Re-verify platform-admin authority inside every action (the real boundary). */
async function getPlatformContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
  return { supabase, user };
}

/** Create a new tenant (name + slug + member-id prefix). */
export async function createTenant(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const prefix = String(formData.get("prefix") ?? "").trim().toUpperCase();

  if (name.length < 2) return { error: "Enter an organization name." };
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    return { error: "Slug must be 2–40 lowercase letters, numbers, or hyphens." };
  }
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
    return { error: "Prefix must be 2–8 uppercase letters or numbers." };
  }

  const { error } = await supabase
    .from("tenants")
    .insert({ name, slug, member_id_prefix: prefix });
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "That slug is already taken."
        : error.message,
    };
  }
  revalidatePath("/platform");
  return { notice: `Organization “${name}” created.` };
}

/** Suspend / reactivate a tenant. */
export async function setTenantStatus(formData: FormData): Promise<void> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  const status = String(formData.get("status") ?? "") as TenantStatus;
  if (!tenantId || (status !== "active" && status !== "suspended")) {
    throw new Error("Invalid request");
  }
  const { error } = await supabase
    .from("tenants")
    .update({ status })
    .eq("id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/platform");
  revalidatePath(`/platform/tenants/${tenantId}`);
}

/** Assign (or promote) a tenant owner by the email of an existing account. */
export async function assignTenantOwner(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  if (!tenantId) return { error: "Missing tenant." };
  if (!email) return { error: "Enter the owner’s email." };

  const { error } = await supabase.rpc("assign_tenant_owner", {
    p_tenant_id: tenantId,
    p_email: email,
  });
  if (error) {
    return {
      error: error.message.includes("no account")
        ? "No account found for that email — they must register first."
        : error.message,
    };
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: `Owner assigned to ${email}.` };
}

/** Set a tenant's raw branding columns (full theming UX is Sub-project #5). */
export async function updateTenantBranding(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const clean = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v.length ? v : null;
  };
  const { error } = await supabase
    .from("tenants")
    .update({
      logo_url: clean("logo_url"),
      primary_color: clean("primary_color"),
      secondary_color: clean("secondary_color"),
    })
    .eq("id", tenantId);
  if (error) return { error: error.message };
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Branding updated." };
}

/** Set (or replace) a tenant's custom domain; generates a fresh verify token. */
export async function setCustomDomain(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const domain = normalizeHost(String(formData.get("domain") ?? ""));
  if (!domain || !domain.includes(".")) {
    return { error: "Enter a valid domain, e.g. members.acme.org." };
  }
  if (isCanonicalHost(domain, env.APP_HOST)) {
    return { error: "That host is reserved by the platform." };
  }

  const token = randomBytes(16).toString("hex");
  const { error } = await supabase
    .from("tenants")
    .update({
      custom_domain: domain,
      domain_verify_token: token,
      domain_verified_at: null,
    })
    .eq("id", tenantId);
  if (error) {
    if (error.code === "23505") {
      return { error: "That domain is already in use by another tenant." };
    }
    return { error: error.message };
  }
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Domain saved. Add the TXT record, then verify." };
}

/** Verify domain ownership via a DNS TXT record (_tgp-verify.<domain>). */
export async function verifyCustomDomain(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const { data: tenant, error: readErr } = await supabase
    .from("tenants")
    .select("custom_domain, domain_verify_token")
    .eq("id", tenantId)
    .maybeSingle<{ custom_domain: string | null; domain_verify_token: string | null }>();
  if (readErr) return { error: readErr.message };
  if (!tenant?.custom_domain || !tenant.domain_verify_token) {
    return { error: "Save a domain first." };
  }

  let records: string[][] = [];
  try {
    records = await dns.resolveTxt(`_tgp-verify.${tenant.custom_domain}`);
  } catch {
    return {
      error: "TXT record not found yet — DNS can take a few minutes to propagate.",
    };
  }
  // A TXT value may be split into multiple chunks; join each record before comparing.
  const matched = records.some(
    (chunks) => chunks.join("").trim() === tenant.domain_verify_token,
  );
  if (!matched) {
    return { error: "Found a TXT record but the token doesn't match yet." };
  }

  const { error } = await supabase
    .from("tenants")
    .update({ domain_verified_at: new Date().toISOString() })
    .eq("id", tenantId);
  if (error) return { error: error.message };
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Domain verified — it's now live." };
}

/** Remove a tenant's custom domain and clear verification state. */
export async function removeCustomDomain(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const { error } = await supabase
    .from("tenants")
    .update({
      custom_domain: null,
      domain_verify_token: null,
      domain_verified_at: null,
    })
    .eq("id", tenantId);
  if (error) return { error: error.message };
  revalidatePath(`/platform/tenants/${tenantId}`);
  return { notice: "Custom domain removed." };
}

/** Edit an org's core fields (name / slug / member-ID prefix). */
export async function updateTenant(
  _prev: PlatformState,
  formData: FormData,
): Promise<PlatformState> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return { error: "Missing tenant." };

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const prefix = String(formData.get("prefix") ?? "").trim().toUpperCase();
  if (name.length < 2) return { error: "Enter an organization name." };
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    return { error: "Slug must be 2–40 lowercase letters, numbers, or hyphens." };
  }
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
    return { error: "Prefix must be 2–8 uppercase letters or numbers." };
  }

  const { error } = await supabase
    .from("tenants")
    .update({ name, slug, member_id_prefix: prefix })
    .eq("id", tenantId);
  if (error) {
    return {
      error:
        error.code === "23505" || error.message.includes("duplicate")
          ? "That slug is already taken."
          : error.message,
    };
  }
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "tenant_updated",
    performed_by: user.id,
    metadata: { name, slug, prefix },
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform");
  return { notice: "Organization updated." };
}

/** Soft-delete: archive an org (data preserved, workspace blocked). */
export async function archiveTenant(formData: FormData): Promise<void> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;
  await supabase.from("tenants").update({ status: "archived" }).eq("id", tenantId);
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "tenant_archived",
    performed_by: user.id,
    metadata: {},
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform");
}

/** Restore an archived org to active. */
export async function restoreTenant(formData: FormData): Promise<void> {
  const { supabase, user } = await getPlatformContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;
  await supabase.from("tenants").update({ status: "active" }).eq("id", tenantId);
  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    action: "tenant_restored",
    performed_by: user.id,
    metadata: {},
  });
  revalidatePath(`/platform/tenants/${tenantId}`);
  revalidatePath("/platform");
}
