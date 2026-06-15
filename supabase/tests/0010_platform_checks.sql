-- Run in the Supabase SQL Editor AFTER applying 0010. Transactional; rolls back.
begin;

-- Platform admin (A) and a prospective owner (B).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
 ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555',
  'authenticated','authenticated','probe-padmin@test.dev','', now(), now(), now(), '{}','{}', false),
 ('00000000-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666',
  'authenticated','authenticated','probe-owner@test.dev','', now(), now(), now(), '{}','{}', false);

insert into public.platform_admins (user_id) values ('55555555-5555-5555-5555-555555555555');
insert into public.tenants (name, slug, member_id_prefix) values ('Probe Org', 'probe-org-0010', 'PRB');

-- As platform admin A: assign B as owner by email.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select public.assign_tenant_owner(
  (select id from public.tenants where slug = 'probe-org-0010'), 'probe-owner@test.dev');

do $$
declare r text; a int;
begin
  select role::text into r from public.tenant_users
   where user_id = '66666666-6666-6666-6666-666666666666'
     and tenant_id = (select id from public.tenants where slug='probe-org-0010');
  if r is distinct from 'owner' then raise exception 'FAIL: B is not owner (%)', r; end if;
  select count(*) into a from public.audit_logs
   where action = 'owner_assigned'
     and target_user = '66666666-6666-6666-6666-666666666666'
     and tenant_id = (select id from public.tenants where slug='probe-org-0010');
  if a < 1 then raise exception 'FAIL: no owner_assigned audit row'; end if;
  raise notice 'OK: assign_tenant_owner made B an owner and wrote an audit row';
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.platform_tenant_stats();
  if n < 1 then raise exception 'FAIL: platform_tenant_stats empty'; end if;
  raise notice 'OK: platform_tenant_stats returned % tenant(s)', n;
end $$;

reset role;

-- As a NON-platform-admin (B): both RPCs must be rejected.
set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
do $$
begin
  begin
    perform * from public.platform_tenant_stats();
    raise exception 'FAIL: non-admin allowed platform_tenant_stats';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.assign_tenant_owner(
      (select id from public.tenants where slug='probe-org-0010'), 'probe-owner@test.dev');
    raise exception 'FAIL: non-admin allowed assign_tenant_owner';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
  raise notice 'OK: non-platform-admin rejected by both RPCs';
end $$;
reset role;

rollback;
