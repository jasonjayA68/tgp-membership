-- =============================================================================
-- SaaS OS — Migration 0011: verify-card branding colors
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0009/0010. Re-declares get_member_card (still a pure read) to
-- also return the tenant's primary/secondary colors, so the anon verify card
-- can theme from one call.
-- =============================================================================

drop function if exists public.get_member_card(text) cascade;

create or replace function public.get_member_card(card_slug text)
returns table (
  full_name             text,
  member_id             text,
  batch_year            int,
  status                public.member_status,
  photo_url             text,
  chapter               text,
  district              text,
  region                text,
  card_active           boolean,
  verify_contact_name   text,
  verify_contact_number text,
  tenant_name           text,
  tenant_slug           text,
  tenant_logo_url       text,
  tenant_primary_color  text,
  tenant_secondary_color text,
  public_fields         jsonb
)
language sql stable security definer set search_path = public as $$
  select p.full_name,
         p.member_id,
         p.batch_year,
         p.status,
         p.photo_url,
         c.name,
         c.district,
         c.region,
         n.active,
         coalesce(chap_officer.full_name, dist_officer.full_name),
         coalesce(nullif(chap_officer.custom_fields ->> 'contact_number', ''),
                  nullif(dist_officer.custom_fields ->> 'contact_number', '')),
         t.name,
         t.slug,
         t.logo_url,
         t.primary_color,
         t.secondary_color,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object('key', s.key, 'label', s.label,
                                       'type', s.type, 'value', p.custom_fields ->> s.key)
                    order by s.sort_order)
           from public.tenant_field_schema s
           where s.tenant_id = p.tenant_id and s.is_public
             and nullif(p.custom_fields ->> s.key, '') is not null
         ), '[]'::jsonb)
  from public.nfc_cards n
  join public.profiles  p on p.id = n.profile_id
  join public.tenants   t on t.id = p.tenant_id
  left join public.chapters c on c.id = p.chapter_id
  left join public.profiles chap_officer
         on chap_officer.id = c.verify_officer_id
        and nullif(chap_officer.custom_fields ->> 'contact_number', '') is not null
  left join public.district_officers d_off
         on d_off.tenant_id = p.tenant_id and d_off.district = c.district
  left join public.profiles dist_officer
         on dist_officer.id = d_off.officer_id
        and nullif(dist_officer.custom_fields ->> 'contact_number', '') is not null
  where n.slug = card_slug;
$$;

revoke all on function public.get_member_card(text) from public;
grant execute on function public.get_member_card(text) to anon, authenticated;
