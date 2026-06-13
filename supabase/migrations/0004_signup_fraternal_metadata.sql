-- =============================================================================
-- TAU GAMMA PHI — Migration 0004: capture fraternal info at sign-up
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe to run on a database that already has data.
-- Updates handle_new_user() so the optional fraternal fields submitted on the
-- registration form (stored in auth metadata) are copied into the new profile,
-- whether or not email confirmation is enabled.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (
    user_id,
    full_name,
    alexis_name,
    batch_name,
    date_survived,
    gt_name,
    gt_number,
    mww_name,
    mww_number,
    contact_number
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    nullif(new.raw_user_meta_data ->> 'alexis_name', ''),
    nullif(new.raw_user_meta_data ->> 'batch_name', ''),
    nullif(new.raw_user_meta_data ->> 'date_survived', '')::date,
    nullif(new.raw_user_meta_data ->> 'gt_name', ''),
    nullif(new.raw_user_meta_data ->> 'gt_number', ''),
    nullif(new.raw_user_meta_data ->> 'mww_name', ''),
    nullif(new.raw_user_meta_data ->> 'mww_number', ''),
    nullif(new.raw_user_meta_data ->> 'contact_number', '')
  )
  on conflict (user_id) do nothing;
  return new;
end $$;
