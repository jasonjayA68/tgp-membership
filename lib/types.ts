/**
 * Database types for the SaaS OS (multi-tenant). Hand-authored to mirror
 * supabase/migrations/0007_tenant_foundation.sql.
 *
 * Row shapes are `type` aliases (not `interface`) to satisfy supabase-js's
 * `Record<string, unknown>` schema constraint.
 */

export type TenantStatus = "active" | "suspended" | "onboarding" | "archived";
export type TenantRole = "owner" | "admin" | "member";

export type MemberStatus =
  | "pending"
  | "active"
  | "inactive"
  | "suspended"
  | "rejected";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  domain_verify_token: string | null;
  domain_verified_at: string | null;
  status: TenantStatus;
  plan_type: string;
  member_id_prefix: string;
  member_seq: number;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  created_at: string;
};

export type TenantPage = {
  id: string;
  tenant_id: string;
  page_type: string;
  content_json: { blocks: unknown[] };
  updated_at: string;
};

export type FeatureFlag = {
  id: string;
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  updated_at: string;
};

/** Row shape returned by the public `get_tenant_homepage` RPC. */
export type HomepageResult = {
  tenant_name: string;
  tenant_slug: string;
  tenant_status: TenantStatus;
  tenant_logo_url: string | null;
  tenant_primary_color: string | null;
  tenant_secondary_color: string | null;
  content_json: { blocks: unknown[] };
  member_count: number;
  homepage_enabled: boolean;
};

/** Per-tenant aggregate from `platform_tenant_stats`. */
export type TenantStats = {
  tenant_id: string;
  member_count: number;
  active_count: number;
};

/** Public whitelist returned by `resolve_tenant_by_slug` — the active-tenant shape. */
export type ResolvedTenant = Pick<
  Tenant,
  "id" | "name" | "slug" | "status" | "logo_url" | "primary_color" | "secondary_color"
>;

export type PlatformAdmin = { user_id: string; created_at: string };

export type TenantUser = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  created_at: string;
};

export type TenantFieldSchema = {
  id: string;
  tenant_id: string;
  key: string;
  label: string;
  type: string;
  is_public: boolean;
  sort_order: number;
  created_at: string;
};

export type Chapter = {
  id: string;
  tenant_id: string;
  name: string;
  district: string | null;
  region: string | null; // council
  verify_officer_id: string | null;
  created_at: string;
};

export type DistrictOfficer = {
  id: string;
  tenant_id: string;
  district: string;
  officer_id: string | null;
  created_at: string;
};

/** DB row. Fraternal/custom data lives in `custom_fields`. */
export type Profile = {
  id: string;
  tenant_id: string;
  user_id: string;
  full_name: string;
  member_id: string | null;
  chapter_id: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  custom_fields: Record<string, string | null>;
  created_at: string;
  updated_at: string;
};

export type NfcCard = {
  id: string;
  tenant_id: string;
  profile_id: string;
  slug: string;
  active: boolean;
  scan_count: number;
  last_verified_at: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  tenant_id: string;
  action: string;
  performed_by: string | null;
  target_user: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** One public, schema-defined member field returned by `get_member_card`. */
export type PublicField = {
  key: string;
  label: string;
  type: string; // 'text' | 'date' | 'phone' | 'number' (drives rendering)
  value: string;
};

/** Whitelisted shape returned by the public `get_member_card` RPC (tenant-aware). */
export type MemberCard = {
  full_name: string;
  member_id: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  chapter: string | null;
  district: string | null;
  region: string | null;
  card_active: boolean;
  verify_contact_name: string | null;
  verify_contact_number: string | null;
  tenant_name: string;
  tenant_slug: string;
  tenant_logo_url: string | null;
  tenant_primary_color: string | null;
  tenant_secondary_color: string | null;
  public_fields: PublicField[];
  verify_officer_enabled: boolean;
};

/**
 * View type used throughout the authed app: the profile row joined with its
 * chapter AND with TGP's fraternal `custom_fields` flattened to named props
 * (compat shim — see lib/profile.ts). Replaced by schema-driven rendering later.
 */
export type ProfileWithChapter = Profile & {
  chapter: Pick<Chapter, "id" | "name" | "district" | "region"> | null;
  alexis_name: string | null;
  batch_name: string | null;
  date_survived: string | null;
  gt_name: string | null;
  gt_number: string | null;
  mww_name: string | null;
  mww_number: string | null;
  contact_number: string | null;
};

type Generated<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      tenants: Generated<Tenant>;
      platform_admins: Generated<PlatformAdmin>;
      tenant_users: Generated<TenantUser>;
      tenant_field_schema: Generated<TenantFieldSchema>;
      chapters: Generated<Chapter>;
      district_officers: Generated<DistrictOfficer>;
      profiles: {
        Row: Profile;
        Insert: Partial<Profile>;
        Update: Partial<Profile>;
        Relationships: [
          {
            foreignKeyName: "profiles_chapter_id_fkey";
            columns: ["chapter_id"];
            isOneToOne: false;
            referencedRelation: "chapters";
            referencedColumns: ["id"];
          },
        ];
      };
      nfc_cards: {
        Row: NfcCard;
        Insert: Partial<NfcCard>;
        Update: Partial<NfcCard>;
        Relationships: [
          {
            foreignKeyName: "nfc_cards_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: Generated<AuditLog>;
      tenant_pages: Generated<TenantPage>;
      feature_flags: Generated<FeatureFlag>;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_member_card: { Args: { card_slug: string }; Returns: MemberCard[] };
      record_card_scan: { Args: { card_slug: string }; Returns: undefined };
      resolve_tenant_by_slug: {
        Args: { p_slug: string };
        Returns: ResolvedTenant[];
      };
      resolve_tenant_by_host: {
        Args: { p_host: string };
        Returns: ResolvedTenant[];
      };
      join_tenant_by_slug: { Args: { p_slug: string }; Returns: undefined };
      is_platform_admin: { Args: Record<string, never>; Returns: boolean };
      claim_platform_admin: { Args: Record<string, never>; Returns: boolean };
      is_tenant_member: { Args: { tid: string }; Returns: boolean };
      is_tenant_admin: { Args: { tid: string }; Returns: boolean };
      is_tenant_owner: { Args: { tid: string }; Returns: boolean };
      next_member_id: { Args: { tid: string }; Returns: string };
      assign_tenant_owner: {
        Args: { p_tenant_id: string; p_email: string };
        Returns: undefined;
      };
      delete_member: { Args: { p_profile_id: string }; Returns: undefined };
      platform_tenant_stats: { Args: Record<string, never>; Returns: TenantStats[] };
      get_tenant_homepage: { Args: { p_slug: string }; Returns: HomepageResult[] };
    };
    Enums: {
      tenant_status: TenantStatus;
      tenant_role: TenantRole;
      member_status: MemberStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
