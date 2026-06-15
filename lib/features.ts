/** Pure feature-flag catalog + resolver (no imports — Node-testable). */

export const FEATURES = [
  {
    key: "chapters",
    label: "Chapters & Districts",
    description: "Chapter/district structure, member assignment, and verifying officers.",
  },
  { key: "audit", label: "Audit Log", description: "Record of administrative actions." },
  { key: "homepage", label: "Public Homepage", description: "The organization's public /home page." },
  {
    key: "verify_officer",
    label: "Verify-officer contact",
    description: "The 'call officer to verify' contact shown on member verification cards.",
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

const DEFAULTS: Record<FeatureKey, boolean> = {
  chapters: true,
  audit: true,
  homepage: true,
  verify_officer: true,
};

/** A flag is on unless a tenant has explicitly set it to false. */
export function isFeatureEnabled(flags: Record<string, boolean>, key: FeatureKey): boolean {
  return flags[key] ?? DEFAULTS[key];
}
