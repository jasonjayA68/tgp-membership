-- Run in the Supabase SQL Editor AFTER applying 0009. Transactional; rolls back.
begin;

-- Seed a throwaway TGP card with public custom fields (postgres bypasses RLS).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444',
        'authenticated','authenticated','probe-card@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{"full_name":"Probe Card"}'::jsonb, false);

update public.profiles
   set custom_fields = '{"gt_name":"Juan","gt_number":"0917-000-0001","alexis_name":"Andromeda","contact_number":"0917-999-9999"}'::jsonb
 where user_id = '44444444-4444-4444-4444-444444444444';

insert into public.nfc_cards (tenant_id, profile_id, slug)
select tenant_id, id, 'probe-card-0009'
from public.profiles where user_id = '44444444-4444-4444-4444-444444444444';

do $$
declare r record; before_n int; after_n int;
begin
  select * into r from public.get_member_card('probe-card-0009');
  if r.tenant_slug <> 'tgp' then raise exception 'FAIL: tenant_slug = %', r.tenant_slug; end if;
  if r.tenant_name is null then raise exception 'FAIL: tenant_name null'; end if;
  if jsonb_array_length(r.public_fields) < 1 then raise exception 'FAIL: no public_fields'; end if;
  raise notice 'OK: get_member_card -> tenant %, % public field(s)', r.tenant_slug, jsonb_array_length(r.public_fields);

  -- The single most important guarantee: a non-public field never leaks.
  if exists (
    select 1 from jsonb_array_elements(r.public_fields) e
    where e ->> 'key' = 'contact_number'
  ) then
    raise exception 'FAIL: non-public field contact_number leaked into public_fields';
  end if;
  raise notice 'OK: non-public custom field excluded from public_fields';

  -- get_member_card is a pure read (no scan increment).
  select scan_count into before_n from public.nfc_cards where slug = 'probe-card-0009';
  perform * from public.get_member_card('probe-card-0009');
  select scan_count into after_n from public.nfc_cards where slug = 'probe-card-0009';
  if after_n <> before_n then raise exception 'FAIL: get_member_card mutated scan_count'; end if;
  raise notice 'OK: get_member_card is a pure read';

  -- record_card_scan increments an active card exactly once.
  perform public.record_card_scan('probe-card-0009');
  select scan_count into after_n from public.nfc_cards where slug = 'probe-card-0009';
  if after_n <> before_n + 1 then raise exception 'FAIL: record_card_scan (% -> %)', before_n, after_n; end if;
  raise notice 'OK: record_card_scan increments active card';
end $$;

rollback;
