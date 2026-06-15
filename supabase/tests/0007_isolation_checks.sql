-- Run in the Supabase SQL Editor (as postgres) AFTER applying 0007.
-- Self-contained: creates two throwaway auth users, asserts isolation, then rolls back.
begin;

-- Two fake authenticated users in different tenants (tenant resolved from metadata).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','probe-a@test.dev','', now(), now(), now(),
   '{}'::jsonb, jsonb_build_object('full_name','Probe A','tenant_slug','tgp',
                                   'alexis_name','Andromeda','contact_number','0917-000-0001'), false),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','probe-b@test.dev','', now(), now(), now(),
   '{}'::jsonb, jsonb_build_object('full_name','Probe B','tenant_slug','org-b'), false);

-- Sanity: the trigger created exactly one profile per user, in the right tenant.
do $$
declare a_tenant text; b_tenant text;
begin
  select tn.slug into a_tenant from public.profiles p
    join public.tenants tn on tn.id = p.tenant_id
   where p.user_id = '11111111-1111-1111-1111-111111111111';
  select tn.slug into b_tenant from public.profiles p
    join public.tenants tn on tn.id = p.tenant_id
   where p.user_id = '22222222-2222-2222-2222-222222222222';
  if a_tenant is distinct from 'tgp' then raise exception 'FAIL: A not in tgp (got %)', a_tenant; end if;
  if b_tenant is distinct from 'org-b' then raise exception 'FAIL: B not in org-b (got %)', b_tenant; end if;
  raise notice 'OK: trigger placed each user in the correct tenant';
end $$;

-- Sanity: A's fraternal signup metadata landed in custom_fields.
do $$
declare alexis text;
begin
  select custom_fields ->> 'alexis_name' into alexis from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111';
  if alexis is distinct from 'Andromeda' then raise exception 'FAIL: custom_fields not populated (got %)', alexis; end if;
  raise notice 'OK: signup metadata flattened into custom_fields';
end $$;

-- As user A (TGP member), under RLS: must see own profile, must NOT see org-b rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare visible int; foreign_visible int;
begin
  select count(*) into visible from public.profiles where user_id = '11111111-1111-1111-1111-111111111111';
  if visible <> 1 then raise exception 'FAIL: A cannot see own profile (count=%)', visible; end if;

  select count(*) into foreign_visible from public.profiles
   where user_id = '22222222-2222-2222-2222-222222222222';
  if foreign_visible <> 0 then raise exception 'FAIL: A can see org-b profile (count=%)', foreign_visible; end if;

  -- A is a plain member, not admin: cannot see other TGP members' rows either.
  select count(*) into foreign_visible from public.chapters
   where tenant_id = (select id from public.tenants where slug = 'org-b');
  if foreign_visible <> 0 then raise exception 'FAIL: A can see org-b chapters (count=%)', foreign_visible; end if;

  raise notice 'OK: TGP member is isolated from org-b under RLS';
end $$;

reset role;
rollback;
