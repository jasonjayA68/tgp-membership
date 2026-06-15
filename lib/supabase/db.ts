import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types";

type DB = SupabaseClient<Database>;

/** Tables that carry a tenant_id and must always be tenant-scoped. */
export type TenantTable =
  | "profiles"
  | "chapters"
  | "nfc_cards"
  | "audit_logs"
  | "district_officers"
  | "tenant_users"
  | "tenant_field_schema";

/**
 * Wraps a Supabase client so every access to a tenant table is automatically
 * scoped to `tenantId`: reads/updates/deletes get `.eq('tenant_id', …)` and
 * inserts get `tenant_id` injected. This is the app-layer backstop behind RLS —
 * ALL tenant-table access in Server Actions/Components should go through it.
 */
export function tdb(supabase: DB, tenantId: string) {
  return {
    select(table: TenantTable, columns = "*") {
      return supabase.from(table).select(columns).eq("tenant_id", tenantId);
    },
    insert(
      table: TenantTable,
      values: Record<string, unknown> | Record<string, unknown>[],
    ) {
      const stamp = (v: Record<string, unknown>) => ({ ...v, tenant_id: tenantId });
      const payload = Array.isArray(values) ? values.map(stamp) : stamp(values);
      // Cast: the hand-authored Database type can't narrow per-table inserts.
      return supabase.from(table).insert(payload as never);
    },
    update(table: TenantTable, values: Record<string, unknown>) {
      return supabase
        .from(table)
        .update(values as never)
        .eq("tenant_id", tenantId);
    },
    delete(table: TenantTable) {
      return supabase.from(table).delete().eq("tenant_id", tenantId);
    },
  };
}
