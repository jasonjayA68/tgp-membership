-- =============================================================================
-- TAU GAMMA PHI — Migration 0003: contact number + public lineage on verify page
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe to run on a database that already has data.
-- Adds profiles.contact_number and exposes contact + GT/MWW lineage through the
-- public verification RPC so they appear on the NFC verification page.
-- =============================================================================

alter table public.profiles
  add column if not exists contact_number text;

drop function if exists public.get_member_card(text);

create or replace function public.get_member_card(card_slug text)
returns table (
  full_name      text,
  member_id      text,
  alexis_name    text,
  batch_name     text,
  date_survived  date,
  contact_number text,
  gt_name        text,
  gt_number      text,
  mww_name       text,
  mww_number     text,
  chapter        text,
  region         text,
  batch_year     int,
  status         public.member_status,
  photo_url      text,
  card_active    boolean
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
         p.contact_number,
         p.gt_name,
         p.gt_number,
         p.mww_name,
         p.mww_number,
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
