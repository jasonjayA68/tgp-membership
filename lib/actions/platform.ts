"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
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
