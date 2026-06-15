"use server";

import { revalidatePath } from "next/cache";

import { FEATURES } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenant } from "@/lib/tenant/context";

/** Toggle a feature flag for the active tenant (tenant admin only). */
export async function setTenantFeature(formData: FormData): Promise<void> {
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

  const key = String(formData.get("key") ?? "");
  if (!FEATURES.some((f) => f.key === key)) throw new Error("Unknown feature");
  const enabled = formData.get("enabled") === "true";

  const { error } = await supabase
    .from("feature_flags")
    .upsert(
      { tenant_id: tenant.id, feature_key: key, enabled, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,feature_key" },
    );
  if (error) throw new Error(error.message);

  revalidatePath("/admin/settings");
  revalidatePath("/admin");
}
