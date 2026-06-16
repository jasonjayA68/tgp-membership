-- =============================================================================
-- SaaS OS — Migration 0018: delete_member (hard-delete a member from one org)
-- -----------------------------------------------------------------------------
-- A tenant admin may delete a mistaken member application. A member spans three
-- tables (profiles + nfc_cards + tenant_users), so removal is atomic via a
-- SECURITY DEFINER RPC, gated by is_tenant_admin() and audited. The login
-- account in auth.users is NOT touched (no service-role key; they may re-apply).
-- nfc_cards.profile_id is ON DELETE CASCADE and chapters.verify_officer_id is
-- ON DELETE SET NULL, so deleting the profile is FK-safe.
-- district_officers.officer_id is ON DELETE CASCADE, so deleting the profile
-- of a member who is a district verifying officer also removes that officer row
-- (intended — a deleted person cannot remain an officer).
-- =============================================================================

create or replace function public.delete_member(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_user_id   uuid;
  v_name      text;
begin
  select tenant_id, user_id, full_name
    into v_tenant_id, v_user_id, v_name
    from public.profiles
   where id = p_profile_id;

  if not found then
    raise exception 'member not found';
  end if;

  if not public.is_tenant_admin(v_tenant_id) then
    raise exception 'forbidden';
  end if;

  delete from public.nfc_cards where profile_id = p_profile_id;
  delete from public.profiles  where id = p_profile_id;
  delete from public.tenant_users
   where tenant_id = v_tenant_id and user_id = v_user_id;

  insert into public.audit_logs (tenant_id, action, performed_by, target_user, metadata)
  values (v_tenant_id, 'member_deleted', auth.uid(), v_user_id,
          jsonb_build_object('name', v_name, 'profile_id', p_profile_id));
end $$;

revoke all on function public.delete_member(uuid) from public;
grant execute on function public.delete_member(uuid) to authenticated;
