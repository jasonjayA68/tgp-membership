"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/lib/constants";
import { getActiveTenant } from "@/lib/tenant/context";
import { fraternalToCustomFields } from "@/lib/profile";
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
  if (!tenant) throw new Error("Unauthorized");

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

export type AdminMemberState = {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
};

const optionalText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

// Same field set the member-facing profile form validates (lib/actions/profile.ts),
// so an admin edit and a self-edit accept identical input.
const MemberEditSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name.").max(120),
  batchYear: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .int()
        .min(1968, "Batch year cannot precede 1968.")
        .max(2100, "Enter a valid batch year."),
    ])
    .transform((v) => (v === "" ? null : v)),
  alexisName: optionalText(),
  batchName: optionalText(),
  dateSurvived: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  gtName: optionalText(),
  gtNumber: optionalText(60),
  mwwName: optionalText(),
  mwwNumber: optionalText(60),
  contactNumber: optionalText(40),
});

/** Edit a member's biographical details (name, batch year, fraternal fields). */
export async function updateMemberProfile(
  _prev: AdminMemberState,
  formData: FormData,
): Promise<AdminMemberState> {
  const { supabase, tenant, user } = await getAdminContext();
  const profileId = required(formData, "profileId");

  const parsed = MemberEditSchema.safeParse({
    fullName: formData.get("fullName"),
    batchYear: formData.get("batchYear") ?? "",
    alexisName: formData.get("alexisName") ?? "",
    batchName: formData.get("batchName") ?? "",
    dateSurvived: formData.get("dateSurvived") ?? "",
    gtName: formData.get("gtName") ?? "",
    gtNumber: formData.get("gtNumber") ?? "",
    mwwName: formData.get("mwwName") ?? "",
    mwwNumber: formData.get("mwwNumber") ?? "",
    contactNumber: formData.get("contactNumber") ?? "",
  });

  if (!parsed.success) {
    return {
      error: "Please correct the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      batch_year: parsed.data.batchYear,
      custom_fields: fraternalToCustomFields({
        alexisName: parsed.data.alexisName,
        batchName: parsed.data.batchName,
        dateSurvived: parsed.data.dateSurvived,
        gtName: parsed.data.gtName,
        gtNumber: parsed.data.gtNumber,
        mwwName: parsed.data.mwwName,
        mwwNumber: parsed.data.mwwNumber,
        contactNumber: parsed.data.contactNumber,
      }),
    })
    .eq("id", profileId)
    .eq("tenant_id", tenant.id);
  if (error) return { error: error.message };

  // Biographical edits are not covered by the handle_profile_change trigger
  // (it audits status/chapter only), so record one explicitly.
  await supabase.from("audit_logs").insert({
    tenant_id: tenant.id,
    action: "member_updated",
    performed_by: user.id,
    target_user: null,
    metadata: { profile_id: profileId },
  });

  revalidateMember(profileId);
  return { notice: "Member details updated." };
}

/** Hard-delete a member from THIS org (profiles + nfc_cards + tenant_users). */
export async function deleteMember(formData: FormData): Promise<void> {
  const { supabase, tenant } = await getAdminContext();
  const profileId = required(formData, "profileId");

  const { error } = await supabase.rpc("delete_member", {
    p_profile_id: profileId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  // The member detail page no longer exists; return to the members list. Use the
  // tenant-scoped path so it resolves in both path mode and custom-domain mode.
  redirect(`/t/${tenant.slug}/admin`);
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
