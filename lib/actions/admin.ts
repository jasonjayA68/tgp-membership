"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/lib/constants";
import { getActiveTenant } from "@/lib/tenant/context";
import type { MemberStatus, TenantRole } from "@/lib/types";

/**
 * Re-verifies tenant-admin authority inside every action against the ACTIVE
 * tenant's membership. Page guards do NOT protect Server Actions, so this is
 * the real enforcement boundary (backed by RLS, which independently rejects
 * non-admin writes).
 */
async function getAdminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const tenant = await getActiveTenant();

  const { data, error } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", user.id)
    .single();
  if (error) throw new Error("Unauthorized");

  const role = data?.role as TenantRole | undefined;
  if (!role || (role !== "admin" && role !== "owner")) {
    throw new Error("Forbidden");
  }
  return { supabase, user, tenant, role };
}

function revalidateMember(profileId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
  if (profileId) revalidatePath(`/admin/members/${profileId}`);
}

function makeSlug(memberId: string): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 4);
  return `${memberId.toLowerCase()}-${random}`;
}

function required(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing field: ${key}`);
  }
  return value;
}

/** Approve / reject / change a member's standing. */
export async function setMemberStatus(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const profileId = required(formData, "profileId");
  const status = required(formData, "status") as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) throw new Error("Invalid status");

  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", profileId)
    .eq("tenant_id", tenant.id);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
  revalidatePath("/dashboard");
}

/** Assign (or clear) a member's chapter. */
export async function assignChapter(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const profileId = required(formData, "profileId");
  const raw = formData.get("chapterId");
  const chapterId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = await supabase
    .from("profiles")
    .update({ chapter_id: chapterId })
    .eq("id", profileId)
    .eq("tenant_id", tenant.id);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
}

/** Change a member's tenant role — owners only. */
export async function setMemberRole(formData: FormData): Promise<void> {
  const { supabase, tenant, role } = await getAdminContext();
  if (role !== "owner") {
    throw new Error("Only an Owner can change roles.");
  }
  const profileId = required(formData, "profileId");
  const newRole = required(formData, "role") as TenantRole;
  if (!["member", "admin", "owner"].includes(newRole)) {
    throw new Error("Invalid role");
  }

  // Resolve the target user from their profile (scoped to this tenant).
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("id", profileId)
    .eq("tenant_id", tenant.id)
    .single();
  if (targetError || !target) throw new Error("Member not found");

  const { error } = await supabase
    .from("tenant_users")
    .update({ role: newRole })
    .eq("tenant_id", tenant.id)
    .eq("user_id", target.user_id);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
}

/** Generate (or regenerate) the member's NFC slug. */
export async function regenerateSlug(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const profileId = required(formData, "profileId");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("member_id")
    .eq("id", profileId)
    .eq("tenant_id", tenant.id)
    .single();
  if (profileError) throw new Error(profileError.message);

  if (!profile?.member_id) {
    throw new Error(
      "Assign a member ID first by approving the member before issuing an NFC slug.",
    );
  }

  const slug = makeSlug(profile.member_id);
  const { data: card } = await supabase
    .from("nfc_cards")
    .select("id")
    .eq("profile_id", profileId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  const { error } = card
    ? await supabase
        .from("nfc_cards")
        .update({ slug, active: true })
        .eq("id", card.id)
        .eq("tenant_id", tenant.id)
    : await supabase
        .from("nfc_cards")
        .insert({ profile_id: profileId, slug, tenant_id: tenant.id });

  if (error) throw new Error(error.message);
  revalidateMember(profileId);
}

/** Activate / deactivate an NFC card. */
export async function setCardActive(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const cardId = required(formData, "cardId");
  const active = formData.get("active") === "true";

  const { error } = await supabase
    .from("nfc_cards")
    .update({ active })
    .eq("id", cardId)
    .eq("tenant_id", tenant.id);
  if (error) throw new Error(error.message);

  const profileId = formData.get("profileId");
  revalidateMember(typeof profileId === "string" ? profileId : undefined);
}

export type ChapterState = { error?: string; notice?: string };

/** Create a new chapter (returns state for inline form feedback). */
export async function createChapter(
  _prev: ChapterState,
  formData: FormData,
): Promise<ChapterState> {
  const { supabase, tenant } = await getAdminContext();
  const name = String(formData.get("name") ?? "").trim();
  const district = String(formData.get("district") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (name.length < 2) return { error: "Enter a chapter name." };

  const { error } = await supabase
    .from("chapters")
    .insert({ name, district: district || null, region: region || null, tenant_id: tenant.id });
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "A chapter with that name already exists."
        : error.message,
    };
  }

  revalidatePath("/admin/chapters");
  revalidatePath("/admin");
  return { notice: `Chapter “${name}” created.` };
}

/** Rename / re-region an existing chapter (returns state for inline feedback). */
export async function updateChapter(
  _prev: ChapterState,
  formData: FormData,
): Promise<ChapterState> {
  const { supabase, tenant } = await getAdminContext();
  const id = required(formData, "chapterId");
  const name = String(formData.get("name") ?? "").trim();
  const district = String(formData.get("district") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (name.length < 2) return { error: "Enter a chapter name." };

  const { error } = await supabase
    .from("chapters")
    .update({ name, district: district || null, region: region || null })
    .eq("id", id)
    .eq("tenant_id", tenant.id);
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "A chapter with that name already exists."
        : error.message,
    };
  }

  revalidatePath("/admin/chapters");
  revalidatePath("/admin");
  return { notice: "Chapter updated." };
}

/** Delete a chapter. Members assigned to it become Unassigned (FK ON DELETE SET NULL). */
export async function deleteChapter(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const id = required(formData, "chapterId");

  const { error } = await supabase
    .from("chapters")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenant.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

/** Assign (or clear) the verifying officer for a chapter. */
export async function setChapterOfficer(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const chapterId = required(formData, "chapterId");
  const raw = formData.get("officerId");
  const officerId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = await supabase
    .from("chapters")
    .update({ verify_officer_id: officerId })
    .eq("id", chapterId)
    .eq("tenant_id", tenant.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
}

/** Assign (or clear) the verifying officer for a district. */
export async function setDistrictOfficer(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const district = required(formData, "district");
  const raw = formData.get("officerId");
  const officerId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = officerId
    ? await supabase
        .from("district_officers")
        .upsert(
          { district, officer_id: officerId, tenant_id: tenant.id },
          { onConflict: "tenant_id,district" },
        )
    : await supabase
        .from("district_officers")
        .delete()
        .eq("tenant_id", tenant.id)
        .eq("district", district);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
}
