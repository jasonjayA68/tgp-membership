/**
 * Database types for the Tau Gamma Phi membership registry.
 * Hand-authored to mirror supabase/migrations/0001_init.sql.
 *
 * Note: the row shapes are `type` aliases (not `interface`) so they satisfy
 * supabase-js's `Record<string, unknown>` schema constraint.
 */

export type AppRole = "super_admin" | "admin" | "member";

export type MemberStatus =
  | "pending"
  | "active"
  | "inactive"
  | "suspended"
  | "rejected";

export type Chapter = {
  id: string;
  name: string;
  district: string | null;
  region: string | null; // council
  verify_officer_id: string | null; // admin profile who verifies this chapter
  created_at: string;
};

export type DistrictOfficer = {
  district: string;
  officer_id: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  user_id: string;
  full_name: string;
  member_id: string | null;
  chapter_id: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  role: AppRole;
  // Fraternal information
  alexis_name: string | null;
  batch_name: string | null;
  date_survived: string | null;
  // Lineage / other information
  gt_name: string | null;
  gt_number: string | null;
  mww_name: string | null;
  mww_number: string | null;
  // Contact
  contact_number: string | null;
  created_at: string;
  updated_at: string;
};

export type NfcCard = {
  id: string;
  profile_id: string;
  slug: string;
  active: boolean;
  scan_count: number;
  last_verified_at: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  action: string;
  performed_by: string | null;
  target_user: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Whitelisted shape returned by the public `get_member_card` RPC. */
export type MemberCard = {
  full_name: string;
  member_id: string | null;
  alexis_name: string | null;
  batch_name: string | null;
  date_survived: string | null;
  gt_name: string | null;
  gt_number: string | null;
  mww_name: string | null;
  mww_number: string | null;
  chapter: string | null;
  district: string | null;
  region: string | null;
  batch_year: number | null;
  status: MemberStatus;
  photo_url: string | null;
  card_active: boolean;
  verify_contact_name: string | null;
  verify_contact_number: string | null;
};

/** Profile joined with its chapter — used throughout the authed app. */
export type ProfileWithChapter = Profile & {
  chapter: Pick<Chapter, "id" | "name" | "district" | "region"> | null;
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
    };
    Views: { [_ in never]: never };
    Functions: {
      get_member_card: {
        Args: { card_slug: string };
        Returns: MemberCard[];
      };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_super_admin: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      app_role: AppRole;
      member_status: MemberStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
