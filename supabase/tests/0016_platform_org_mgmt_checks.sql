-- Transactional probe for 0016. Rolls back. Run AFTER applying the migration.
begin;

do $$
declare
  v_tid      uuid;
  v_buckets  int;
  v_policies int;
begin
  -- 1. The enum accepts 'archived', and it round-trips.
  insert into public.tenants (name, slug, member_id_prefix, status)
  values ('Probe Arch', 'probe-arch-org', 'PRA', 'archived')
  returning id into v_tid;
  if (select status from public.tenants where id = v_tid) <> 'archived' then
    raise exception 'FAIL: archived status not stored';
  end if;
  raise notice 'OK: archived status accepted';

  -- 2. Restore back to active.
  update public.tenants set status = 'active' where id = v_tid;
  if (select status from public.tenants where id = v_tid) <> 'active' then
    raise exception 'FAIL: restore failed';
  end if;
  raise notice 'OK: restore to active works';

  -- 3. The branding bucket exists.
  select count(*) into v_buckets from storage.buckets where id = 'branding';
  if v_buckets <> 1 then raise exception 'FAIL: branding bucket missing'; end if;
  raise notice 'OK: branding bucket exists';

  -- 4. Four branding storage policies exist.
  select count(*) into v_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'branding_%';
  if v_policies <> 4 then
    raise exception 'FAIL: expected 4 branding policies, got %', v_policies;
  end if;
  raise notice 'OK: 4 branding storage policies present';

  -- 5. The audit_logs INSERT policy exists (so action audit writes succeed).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_logs'
      and policyname = 'audit_insert_admin' and cmd = 'INSERT'
  ) then
    raise exception 'FAIL: audit_insert_admin policy missing';
  end if;
  raise notice 'OK: audit_logs insert policy present';

  raise notice 'ALL 0016 CHECKS PASSED';
end $$;

rollback;
