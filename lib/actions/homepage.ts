"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { HomeContentSchema } from "@/lib/cms/blocks";
import { getActiveTenant } from "@/lib/tenant/context";

export type HomepageState = { error?: string; notice?: string };

/** Re-verify tenant admin, validate the submitted blocks, upsert the home page. */
async function requireAdminTenant() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const tenant = await getActiveTenant();
  if (!tenant) throw new Error("No active tenant");
  const { data } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .single();
  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    throw new Error("Forbidden");
  }
  return { supabase, tenant };
}

export async function saveHomepage(
  _prev: HomepageState,
  formData: FormData,
): Promise<HomepageState> {
  const { supabase, tenant } = await requireAdminTenant();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("content") ?? ""));
  } catch {
    return { error: "Invalid content payload." };
  }
  const parsed = HomeContentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Some blocks are invalid (too long, too many, or a bad link)." };
  }

  const { error } = await supabase
    .from("tenant_pages")
    .upsert(
      { tenant_id: tenant.id, page_type: "home", content_json: parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,page_type" },
    );
  if (error) return { error: error.message };

  revalidatePath(`/t/${tenant.slug}/home`);
  revalidatePath("/admin/homepage");
  return { notice: "Homepage saved." };
}
