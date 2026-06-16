import type { MemberStatus, TenantRole } from "@/lib/types";

export const SITE = {
  name: "Tau Gamma Phi",
  glyph: "ΤΓΦ",
  legalName: "Tau Gamma Phi — Triskelion Grand Fraternity",
  motto: "Fortis Voluntas Fraternitas",
  mottoEn: "Strong Willed Brotherhood",
  founded: "1968",
  registry: "Digital Membership Registry",
  description:
    "The official digital membership registry of Tau Gamma Phi. Verify member credentials instantly via NFC.",
} as const;

/**
 * Neutral PLATFORM identity for the platform plane (root landing, /platform,
 * the super-admin portal). Distinct from SITE, which is TGP's tenant identity.
 */
export const PLATFORM = {
  name: "Organization Registry",
  tagline: "Multi-tenant membership platform",
  description:
    "A multi-tenant platform for organizations to issue digital member IDs, manage chapters, and verify membership instantly via NFC.",
} as const;

/**
 * Shared homepage copy (motto/tagline). One swap point for now; a per-tenant
 * `tagline` field is the future change. First tenants are TGP councils.
 */
export const HOMEPAGE = {
  eyebrow: "Official Membership Registry",
  tagline: "Fortis Voluntas Fraternitas",
  subtext:
    "Light over darkness — your standing in the brotherhood, recorded, sealed, and verifiable in real time.",
} as const;

type Tone = "gold" | "amber" | "muted" | "danger";

export const STATUS_META: Record<
  MemberStatus,
  { label: string; tone: Tone; verified: boolean; description: string }
> = {
  active: {
    label: "Active",
    tone: "gold",
    verified: true,
    description: "Member in good standing.",
  },
  pending: {
    label: "Pending Review",
    tone: "amber",
    verified: false,
    description: "Registration is awaiting administrator approval.",
  },
  inactive: {
    label: "Inactive",
    tone: "muted",
    verified: false,
    description: "Membership is currently inactive.",
  },
  suspended: {
    label: "Suspended",
    tone: "danger",
    verified: false,
    description: "Membership privileges are suspended.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    verified: false,
    description: "Registration was not approved.",
  },
};

export const TENANT_ROLE_META: Record<
  TenantRole,
  { label: string; rank: number }
> = {
  owner: { label: "Owner", rank: 3 },
  admin: { label: "Administrator", rank: 2 },
  member: { label: "Member", rank: 1 },
};

export const MEMBER_STATUSES: MemberStatus[] = [
  "pending",
  "active",
  "inactive",
  "suspended",
  "rejected",
];

export function isTenantAdminRole(
  role: TenantRole | null | undefined,
): boolean {
  return role === "admin" || role === "owner";
}
