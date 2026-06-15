-- Run in the Supabase SQL Editor AFTER applying 0008. Transactional; rolls back.
begin;

-- resolve_tenant_by_slug returns the active TGP tenant whitelist.
do $$
declare r record;
begin
  select * into r from public.resolve_tenant_by_slug('tgp');
  if r.id is null then raise exception 'FAIL: tgp did not resolve'; end if;
  if r.slug <> 'tgp' then raise exception 'FAIL: wrong slug %', r.slug; end if;
  raise notice 'OK: resolve_tenant_by_slug(tgp) -> %', r.name;
end $$;

-- Unknown slug resolves to no row.
do $$
declare n int;
begin
  select count(*) into n from public.resolve_tenant_by_slug('does-not-exist');
  if n <> 0 then raise exception 'FAIL: unknown slug returned % rows', n; end if;
  raise notice 'OK: unknown slug -> 0 rows';
end $$;

-- join_tenant_by_slug: a fresh user joins org-b as a pending member.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',
        'authenticated','authenticated','probe-join@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{"full_name":"Probe Join"}'::jsonb, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select public.join_tenant_by_slug('org-b');

reset role;
do $$
declare m int; p text;
begin
  select count(*) into m from public.tenant_users
   where user_id = '33333333-3333-3333-3333-333333333333'
     and tenant_id = (select id from public.tenants where slug='org-b');
  if m <> 1 then raise exception 'FAIL: join did not create membership (%).', m; end if;
  select status into p from public.profiles
   where user_id = '33333333-3333-3333-3333-333333333333'
     and tenant_id = (select id from public.tenants where slug='org-b');
  if p is distinct from 'pending' then raise exception 'FAIL: profile not pending (%)', p; end if;
  raise notice 'OK: join_tenant_by_slug created pending membership + profile';
end $$;

rollback;
