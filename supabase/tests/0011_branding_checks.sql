-- Run in the Supabase SQL Editor AFTER applying 0011. Transactional; rolls back.
begin;

-- Give TGP colors + a throwaway card, then confirm get_member_card returns them.
update public.tenants
   set primary_color = '#2563eb', secondary_color = '#f5f5f5'
 where slug = 'tgp';

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','77777777-7777-7777-7777-777777777777',
        'authenticated','authenticated','probe-brand@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb, false);

insert into public.nfc_cards (tenant_id, profile_id, slug)
select tenant_id, id, 'probe-card-0011'
from public.profiles where user_id = '77777777-7777-7777-7777-777777777777';

do $$
declare r record;
begin
  select * into r from public.get_member_card('probe-card-0011');
  if r.tenant_primary_color is distinct from '#2563eb' then
    raise exception 'FAIL: primary not returned (%)', r.tenant_primary_color; end if;
  if r.tenant_secondary_color is distinct from '#f5f5f5' then
    raise exception 'FAIL: secondary not returned (%)', r.tenant_secondary_color; end if;
  raise notice 'OK: get_member_card returns tenant branding colors';
end $$;

rollback;
