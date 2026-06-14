-- =============================================================================
-- TAU GAMMA PHI — Migration 0006: Chapter/District Verify Officers
-- -----------------------------------------------------------------------------
-- ADDITIVE — safe to run on a database that already has data.
--  * chapters.verify_officer_id  → the admin profile who verifies that chapter
--  * district_officers           → maps a district name to its verifying officer
--  * get_member_card() rewritten to resolve the public "call to verify" contact
--    as: chapter officer (with a number) → district officer (with a number) →
--    none. The member's own contact_number is NO LONGER returned publicly.
-- =============================================================================

-- 1. Per-chapter verifying officer ------------------------------------------
alter table public.chapters
  add column if not exists verify_officer_id uuid
    references public.profiles (id) on delete set null;

-- 2. District → officer mapping ---------------------------------------------
create table if not exists public.district_officers (
  district   text primary key,
  officer_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.district_officers enable row level security;

drop policy if exists district_officers_select_auth on public.district_officers;
drop policy if exists district_officers_write_admin on public.district_officers;

create policy district_officers_select_auth on public.district_officers
  for select using (auth.uid() is not null);
create policy district_officers_write_admin on public.district_officers
  for all using (public.is_admin()) with check (public.is_admin());

-- 3. Public verification RPC -------------------------------------------------
drop function if exists public.get_member_card(text);

create or replace function public.get_member_card(card_slug text)
returns table (
  full_name      text,
  member_id      text,
  alexis_name    text,
  batch_name     text,
  date_survived  date,
  gt_name        text,
  gt_number      text,
  mww_name       text,
  mww_number     text,
  chapter        text,
  district       text,
  region         text,
  batch_year     int,
  status         public.member_status,
  photo_url      text,
  card_active    boolean,
  verify_contact_name   text,
  verify_contact_number text
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
         p.gt_name,
         p.gt_number,
         p.mww_name,
         p.mww_number,
         c.name,
         c.district,
         c.region,
         p.batch_year,
         p.status,
         p.photo_url,
         n.active,
         coalesce(chap_officer.full_name, dist_officer.full_name),
         coalesce(chap_officer.contact_number, dist_officer.contact_number)
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  left join public.chapters c on c.id = p.chapter_id
  left join public.profiles chap_officer
         on chap_officer.id = c.verify_officer_id
        and chap_officer.contact_number is not null
  left join public.district_officers d_off
         on d_off.district = c.district
  left join public.profiles dist_officer
         on dist_officer.id = d_off.officer_id
        and dist_officer.contact_number is not null
  where n.slug = card_slug;
end $$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;
