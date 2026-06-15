-- Run in the Supabase SQL Editor AFTER applying 0013. Transactional; rolls back.
begin;

-- Defaults: no flag rows → enabled flags default true.
do $$
declare r record;
begin
  select * into r from public.get_tenant_homepage('tgp');
  if r.homepage_enabled is not true then raise exception 'FAIL: homepage default not true'; end if;
  raise notice 'OK: homepage_enabled defaults true';
end $$;

-- Setting a flag off is reflected by the RPC.
insert into public.feature_flags (tenant_id, feature_key, enabled)
select id, 'homepage', false from public.tenants where slug = 'tgp'
on conflict (tenant_id, feature_key) do update set enabled = excluded.enabled;

do $$
declare r record;
begin
  select * into r from public.get_tenant_homepage('tgp');
  if r.homepage_enabled is not false then raise exception 'FAIL: homepage flag off not honored'; end if;
  raise notice 'OK: homepage_enabled reflects the flag';
end $$;

-- verify_officer_enabled defaults true on a card with no flag row.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','99999999-9999-9999-9999-999999999999',
        'authenticated','authenticated','probe-ff@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb, false);
insert into public.nfc_cards (tenant_id, profile_id, slug)
select tenant_id, id, 'probe-card-0013'
from public.profiles where user_id = '99999999-9999-9999-9999-999999999999';

do $$
declare r record;
begin
  select * into r from public.get_member_card('probe-card-0013');
  if r.verify_officer_enabled is not true then raise exception 'FAIL: verify_officer default not true'; end if;
  raise notice 'OK: verify_officer_enabled defaults true';
end $$;

-- A non-admin tgp member cannot write feature_flags (RLS write = is_tenant_admin).
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
do $$
begin
  begin
    insert into public.feature_flags (tenant_id, feature_key, enabled)
    select id, 'probe-flag', true from public.tenants where slug = 'tgp';
    raise exception 'FAIL: non-admin wrote feature_flags';
  exception
    when insufficient_privilege then raise notice 'OK: RLS blocked non-admin write';
  end;
end $$;
reset role;

rollback;
