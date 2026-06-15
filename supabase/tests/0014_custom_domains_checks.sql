-- Transactional probe for 0014. Rolls back — leaves no data. Run in the SQL editor.
begin;

do $$
declare
  v_tid   uuid;
  v_count int;
  v_slug  text;
begin
  insert into public.tenants (name, slug, member_id_prefix, custom_domain, domain_verify_token, status)
  values ('Probe Org', 'probe-domain-org', 'PRB', 'probe.example.com', 'tok_probe', 'active')
  returning id into v_tid;

  -- 1. Unverified domain must NOT resolve.
  select count(*) into v_count from public.resolve_tenant_by_host('probe.example.com');
  if v_count <> 0 then raise exception 'FAIL: unverified domain resolved (% rows)', v_count; end if;
  raise notice 'OK: unverified domain not resolved';

  -- 2. Verified domain resolves to the correct tenant.
  update public.tenants set domain_verified_at = now() where id = v_tid;
  select slug into v_slug from public.resolve_tenant_by_host('probe.example.com');
  if v_slug is distinct from 'probe-domain-org' then raise exception 'FAIL: verified slug=%', v_slug; end if;
  raise notice 'OK: verified domain resolves to correct tenant';

  -- 3. Host match is case-insensitive.
  select count(*) into v_count from public.resolve_tenant_by_host('PROBE.example.com');
  if v_count <> 1 then raise exception 'FAIL: uppercase host not resolved (% rows)', v_count; end if;
  raise notice 'OK: host match is case-insensitive';

  -- 4. Suspended tenant's domain must NOT resolve.
  update public.tenants set status = 'suspended' where id = v_tid;
  select count(*) into v_count from public.resolve_tenant_by_host('probe.example.com');
  if v_count <> 0 then raise exception 'FAIL: suspended domain resolved (% rows)', v_count; end if;
  raise notice 'OK: suspended domain not resolved';

  raise notice 'ALL 0014 CHECKS PASSED';
end $$;

rollback;
