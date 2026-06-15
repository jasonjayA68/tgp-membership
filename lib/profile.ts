import type { Chapter, Profile, ProfileWithChapter } from "@/lib/types";

/**
 * TGP's fraternal custom-field keys. Foundation-era compat shim: these are
 * flattened onto the profile view so existing pages keep reading `.alexis_name`
 * etc. Sub-project 5 replaces this with schema-driven field rendering.
 */
export const TGP_FRATERNAL_KEYS = [
  "alexis_name",
  "batch_name",
  "date_survived",
  "gt_name",
  "gt_number",
  "mww_name",
  "mww_number",
  "contact_number",
] as const;

export type ProfileRow = Profile & {
  chapter?: Pick<Chapter, "id" | "name" | "district" | "region"> | null;
};

/** Flatten `custom_fields` onto named props for the authed-app view type. */
export function toProfileView(row: ProfileRow): ProfileWithChapter {
  const cf = row.custom_fields ?? {};
  return {
    ...row,
    chapter: row.chapter ?? null,
    alexis_name: cf.alexis_name ?? null,
    batch_name: cf.batch_name ?? null,
    date_survived: cf.date_survived ?? null,
    gt_name: cf.gt_name ?? null,
    gt_number: cf.gt_number ?? null,
    mww_name: cf.mww_name ?? null,
    mww_number: cf.mww_number ?? null,
    contact_number: cf.contact_number ?? null,
  };
}

/** Inverse: build a `custom_fields` object from profile-form inputs (nulls/empties dropped). */
export function fraternalToCustomFields(input: {
  alexisName: string | null;
  batchName: string | null;
  dateSurvived: string | null;
  gtName: string | null;
  gtNumber: string | null;
  mwwName: string | null;
  mwwNumber: string | null;
  contactNumber: string | null;
}): Record<string, string> {
  const map: Record<string, string | null> = {
    alexis_name: input.alexisName,
    batch_name: input.batchName,
    date_survived: input.dateSurvived,
    gt_name: input.gtName,
    gt_number: input.gtNumber,
    mww_name: input.mwwName,
    mww_number: input.mwwNumber,
    contact_number: input.contactNumber,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v != null && v !== "") out[k] = v;
  }
  return out;
}
