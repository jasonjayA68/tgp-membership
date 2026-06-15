-- Run in the Supabase SQL Editor AFTER applying 0012. Transactional; rolls back.
begin;

insert into public.tenant_pages (tenant_id, page_type, content_json)
select id, 'home',
       '{"blocks":[{"id":"b1","type":"hero","props":{"heading":"Welcome"}}]}'::jsonb
from public.tenants where slug = 'tgp'
on conflict (tenant_id, page_type) do update set content_json = excluded.content_json;

do $$
declare r record; direct bigint;
begin
  select * into r from public.get_tenant_homepage('tgp');
  if r.tenant_slug <> 'tgp' then raise exception 'FAIL: slug %', r.tenant_slug; end if;
  if r.content_json -> 'blocks' -> 0 ->> 'type' <> 'hero' then raise exception 'FAIL: blocks not returned'; end if;
  select count(*) into direct
  from public.profiles pr join public.tenants t on t.id = pr.tenant_id
  where t.slug = 'tgp' and pr.status = 'active';
  if r.member_count is distinct from direct then
    raise exception 'FAIL: member_count % <> direct %', r.member_count, direct;
  end if;
  raise notice 'OK: get_tenant_homepage returns content + branding + count';
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.get_tenant_homepage('does-not-exist');
  if n <> 0 then raise exception 'FAIL: unknown slug returned % rows', n; end if;
  raise notice 'OK: unknown slug -> 0 rows';
end $$;

-- A non-admin tgp member cannot write tenant_pages (RLS write = is_tenant_admin).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('00000000-0000-0000-0000-000000000000','88888888-8888-8888-8888-888888888888',
        'authenticated','authenticated','probe-cms@test.dev','', now(), now(), now(),
        '{}'::jsonb, '{}'::jsonb, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
do $$
begin
  begin
    insert into public.tenant_pages (tenant_id, page_type, content_json)
    select id, 'home-probe', '{"blocks":[]}'::jsonb from public.tenants where slug = 'tgp';
    raise exception 'FAIL: non-admin wrote tenant_pages';
  exception
    when insufficient_privilege then raise notice 'OK: RLS blocked non-admin write';
  end;
end $$;
reset role;

rollback;
