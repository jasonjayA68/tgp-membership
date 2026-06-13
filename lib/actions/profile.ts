"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type ProfileState = {
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

const ProfileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
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
  // Fraternal information
  alexisName: optionalText(),
  batchName: optionalText(),
  dateSurvived: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
    .optional()
    .or(z.literal(""))
    .transform((v) => (v && v.length > 0 ? v : null)),
  // Lineage / other information
  gtName: optionalText(),
  gtNumber: optionalText(60),
  mwwName: optionalText(),
  mwwNumber: optionalText(60),
  // Contact
  contactNumber: optionalText(40),
});

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const parsed = ProfileSchema.safeParse({
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  // Privileged columns (role/status/member_id/chapter) are guarded by a DB
  // trigger, so this can only ever touch the member's own biographical fields.
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      batch_year: parsed.data.batchYear,
      alexis_name: parsed.data.alexisName,
      batch_name: parsed.data.batchName,
      date_survived: parsed.data.dateSurvived,
      gt_name: parsed.data.gtName,
      gt_number: parsed.data.gtNumber,
      mww_name: parsed.data.mwwName,
      mww_number: parsed.data.mwwNumber,
      contact_number: parsed.data.contactNumber,
    })
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { notice: "Profile updated." };
}

export async function uploadAvatar(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: "Image must be 5 MB or smaller." };
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return { error: "Use a JPG, PNG, or WebP image." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  // Unique, query-less filename → the public URL changes on every upload
  // (so next/image never serves a stale avatar) without needing a `?v=` query.
  const stamp = Date.now();
  const filename = `${stamp}.${ext}`;
  const path = `${user.id}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ photo_url: publicUrl })
    .eq("user_id", user.id);
  if (updateError) return { error: updateError.message };

  // Remove superseded photos so the bucket doesn't accumulate orphans.
  const { data: existing } = await supabase.storage
    .from("avatars")
    .list(user.id);
  const stale = (existing ?? [])
    .filter((f) => f.name !== filename)
    .map((f) => `${user.id}/${f.name}`);
  if (stale.length) {
    await supabase.storage.from("avatars").remove(stale);
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { notice: "Photo updated." };
}
