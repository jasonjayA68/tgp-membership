-- =============================================================================
-- TAU GAMMA PHI — Migration 0002: Fraternal information & lineage fields
-- -----------------------------------------------------------------------------
-- ADDITIVE migration — safe to run on a database that already has data.
-- Run this in the Supabase SQL Editor after 0001_init.sql.
-- =============================================================================

-- New profile columns ---------------------------------------------------------
alter table public.profiles
  add column if not exists alexis_name   text,   -- fraternal alias ("Alexis")
  add column if not exists batch_name    text,   -- name of initiation batch
  add column if not exists date_survived date,    -- date the member "survived"
  add column if not exists gt_name       text,   -- Grand Triskelion (when survived)
  add column if not exists gt_number     text,   -- GT's number
  add column if not exists mww_name      text,   -- MWW (when survived)
  add column if not exists mww_number    text;   -- MWW's number

-- Extend the public verification RPC ------------------------------------------
-- The return signature changes, so the function must be dropped and recreated.
-- Only the fraternal *identity* fields are exposed publicly (Alexis, batch,
-- date survived); GT/MWW lineage stays private to the portal and admin.
drop function if exists public.get_member_card(text);

create or replace function public.get_member_card(card_slug text)
returns table (
  full_name     text,
  member_id     text,
  alexis_name   text,
  batch_name    text,
  date_survived date,
  chapter       text,
  region        text,
  batch_year    int,
  status        public.member_status,
  photo_url     text,
  card_active   boolean
)
language plpgsql security definer set search_path = public as $$
begin
  update public.nfc_cards
     set scan_count = scan_count + 1,
         last_verified_at = now()
   where slug = card_slug and active = true;

  return query
  select p.full_name,
         p.member_id,
         p.alexis_name,
         p.batch_name,
         p.date_survived,
         c.name,
         c.region,
         p.batch_year,
         p.status,
         p.photo_url,
         n.active
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  left join public.chapters c on c.id = p.chapter_id
  where n.slug = card_slug;
end $$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;
