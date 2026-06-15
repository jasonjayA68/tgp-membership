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
    select<T extends TenantTable>(table: T, columns = "*") {
      // Type `columns` as the literal "*" so PostgREST infers the plain Row of
      // the narrowed table `T` (so `.eq` accepts that table's columns and
      // `.data` is typed). The real `columns` string — including embedded-
      // resource selects — is still sent at runtime; we only suppress
      // PostgREST's `ParseQuery<Query>` type, whose recursive instantiation over
      // non-trivial literals is pathologically expensive (it OOMs `tsc`). Call
      // sites needing a richer row (e.g. an embed) supply it via
      // `.maybeSingle<T>()`.
      //
      // `tenant_id` exists on every `TenantTable` row, but TS can't prove that
      // for a generic `T`; the filter args are asserted to the builder's own
      // parameter types (the runtime call is unchanged).
      const scoped = supabase.from(table).select(columns as "*");
      type EqArgs = Parameters<typeof scoped.eq>;
      return scoped.eq(...(["tenant_id", tenantId] as unknown as EqArgs));
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
