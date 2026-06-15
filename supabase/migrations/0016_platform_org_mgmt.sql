-- =============================================================================
-- SaaS OS — Migration 0016: Platform Org Management
-- -----------------------------------------------------------------------------
-- ADDITIVE. Adds the 'archived' tenant status + a public 'branding' Storage
-- bucket (platform-admin write) for tenant logo uploads. Safe on a DB with
-- 0007–0015 applied.
--
-- NOTE: 'archived' is only USED at runtime (by archiveTenant) — never in this
-- migration — so there is no same-transaction "unsafe use of new enum value".
-- If your SQL editor rejects ADD VALUE inside a transaction, run that one line
-- on its own first, then the rest.
-- =============================================================================

alter type public.tenant_status add value if not exists 'archived';

-- Tenant-logo bucket: public read, platform-admin write (mirrors avatars, 0007).
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists branding_public_read  on storage.objects;
drop policy if exists branding_admin_insert on storage.objects;
drop policy if exists branding_admin_update on storage.objects;
drop policy if exists branding_admin_delete on storage.objects;

create policy branding_public_read on storage.objects for select
  using (bucket_id = 'branding');
create policy branding_admin_insert on storage.objects for insert
  with check (bucket_id = 'branding' and public.is_platform_admin());
create policy branding_admin_update on storage.objects for update
  using (bucket_id = 'branding' and public.is_platform_admin());
create policy branding_admin_delete on storage.objects for delete
  using (bucket_id = 'branding' and public.is_platform_admin());

-- audit_logs INSERT: the new platform/tenant-admin actions write audit rows via
-- the RLS client (0007 shipped a SELECT-only policy). Integrity: you may only
-- write a row attributed to yourself, and only for a tenant you administer (or
-- as a platform admin). SECURITY DEFINER writes (e.g. assign_tenant_owner) still
-- bypass RLS and are unaffected.
drop policy if exists audit_insert_admin on public.audit_logs;
create policy audit_insert_admin on public.audit_logs for insert
  with check (
    performed_by = auth.uid()
    and (public.is_platform_admin() or public.is_tenant_admin(tenant_id))
  );
