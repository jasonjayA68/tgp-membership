-- Probe for 0018_delete_member. Run in the Supabase SQL editor. Rolls back.
begin;

-- 1) Function exists and is granted to authenticated.
do $$
begin
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_member'
  ) then
    raise exception 'FAIL: delete_member() is missing';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_member(uuid)', 'execute') then
    raise exception 'FAIL: delete_member() not executable by authenticated';
  end if;
  raise notice 'OK: delete_member() exists and is granted to authenticated';
end $$;

-- 2) Unknown profile -> "member not found" (lookup precedes the admin gate).
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.delete_member('00000000-0000-0000-0000-000000000000');
  exception when others then
    v_ok := (sqlerrm ilike '%not found%');
    if not v_ok then raise exception 'FAIL: wrong error for unknown profile: %', sqlerrm; end if;
  end;
  if not v_ok then raise exception 'FAIL: delete_member did not raise for unknown profile'; end if;
  raise notice 'OK: unknown profile raises member-not-found';
end $$;

-- 3) Real profile, no auth context (auth.uid() is null -> not a tenant admin) -> "forbidden".
do $$
declare v_pid uuid; v_ok boolean := false;
begin
  select id into v_pid from public.profiles limit 1;
  if v_pid is null then
    raise notice 'SKIP: no profiles available to test the forbidden gate';
  else
    begin
      perform public.delete_member(v_pid);
    exception when others then
      v_ok := (sqlerrm ilike '%forbidden%');
      if not v_ok then raise exception 'FAIL: wrong error for non-admin caller: %', sqlerrm; end if;
    end;
    if not v_ok then raise exception 'FAIL: non-admin caller was not blocked'; end if;
    raise notice 'OK: non-admin caller is blocked (forbidden)';
  end if;
end $$;

rollback;
