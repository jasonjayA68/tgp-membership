"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/lib/constants";
import type { AppRole, MemberStatus } from "@/lib/types";

/**
 * Re-verifies admin authority inside every action. Page/layout guards do NOT
 * protect Server Actions, so this is the real enforcement boundary (backed in
 * turn by RLS, which independently rejects non-admin writes).
 */
async function getAdminClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (error) throw new Error("Unauthorized");

  if (!data || (data.role !== "admin" && data.role !== "super_admin")) {
    throw new Error("Forbidden");
  }
  return { supabase, user, role: data.role as AppRole };
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
  const { supabase } = await getAdminClient();
  const profileId = required(formData, "profileId");
  const status = required(formData, "status") as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) throw new Error("Invalid status");

  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", profileId);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
  revalidatePath("/dashboard");
}

/** Assign (or clear) a member's chapter. */
export async function assignChapter(formData: FormData): Promise<void> {
  const { supabase } = await getAdminClient();
  const profileId = required(formData, "profileId");
  const raw = formData.get("chapterId");
  const chapterId = typeof raw === "string" && raw.length > 0 ? raw : null;

  const { error } = await supabase
    .from("profiles")
    .update({ chapter_id: chapterId })
    .eq("id", profileId);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
}

/** Change a member's role — Grand Administrator (super_admin) only. */
export async function setMemberRole(formData: FormData): Promise<void> {
  const { supabase, role } = await getAdminClient();
  if (role !== "super_admin") {
    throw new Error("Only a Grand Administrator can change roles.");
  }
  const profileId = required(formData, "profileId");
  const newRole = required(formData, "role") as AppRole;
  if (!["member", "admin", "super_admin"].includes(newRole)) {
    throw new Error("Invalid role");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", profileId);
  if (error) throw new Error(error.message);

  revalidateMember(profileId);
}

/** Generate (or regenerate) the member's NFC slug. */
export async function regenerateSlug(formData: FormData): Promise<void> {
  const { supabase } = await getAdminClient();
  const profileId = required(formData, "profileId");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("member_id")
    .eq("id", profileId)
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
    .maybeSingle();

  const { error } = card
    ? await supabase
        .from("nfc_cards")
        .update({ slug, active: true })
        .eq("id", card.id)
    : await supabase.from("nfc_cards").insert({ profile_id: profileId, slug });

  if (error) throw new Error(error.message);
  revalidateMember(profileId);
}

/** Activate / deactivate an NFC card. */
export async function setCardActive(formData: FormData): Promise<void> {
  const { supabase } = await getAdminClient();
  const cardId = required(formData, "cardId");
  const active = formData.get("active") === "true";

  const { error } = await supabase
    .from("nfc_cards")
    .update({ active })
    .eq("id", cardId);
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
  const { supabase } = await getAdminClient();
  const name = String(formData.get("name") ?? "").trim();
  const district = String(formData.get("district") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (name.length < 2) return { error: "Enter a chapter name." };

  const { error } = await supabase
    .from("chapters")
    .insert({ name, district: district || null, region: region || null });
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
  const { supabase } = await getAdminClient();
  const id = required(formData, "chapterId");
  const name = String(formData.get("name") ?? "").trim();
  const district = String(formData.get("district") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();

  if (name.length < 2) return { error: "Enter a chapter name." };

  const { error } = await supabase
    .from("chapters")
    .update({ name, district: district || null, region: region || null })
    .eq("id", id);
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
  const { supabase } = await getAdminClient();
  const id = required(formData, "chapterId");

  const { error } = await supabase.from("chapters").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/chapters");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}
