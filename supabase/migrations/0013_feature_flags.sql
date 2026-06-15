-- =============================================================================
-- SaaS OS — Migration 0013: per-tenant feature flags
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007–0012. feature_flags table (tenant-admin write) + the two
-- public RPCs re-declared to return one flag each (default true when no row).
-- =============================================================================

create table if not exists public.feature_flags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, feature_key)
);
create index if not exists feature_flags_tenant_idx on public.feature_flags (tenant_id);

alter table public.feature_flags enable row level security;
drop policy if exists feature_flags_select on public.feature_flags;
drop policy if exists feature_flags_write  on public.feature_flags;
create policy feature_flags_select on public.feature_flags for select
  using (public.is_tenant_member(tenant_id));
create policy feature_flags_write on public.feature_flags for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- ---- get_member_card + verify_officer_enabled -----------------------------
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
  public_fields         jsonb,
  verify_officer_enabled boolean
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
         ), '[]'::jsonb),
         coalesce((select f.enabled from public.feature_flags f
                    where f.tenant_id = p.tenant_id and f.feature_key = 'verify_officer'), true)
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

-- ---- get_tenant_homepage + homepage_enabled -------------------------------
drop function if exists public.get_tenant_homepage(text) cascade;
create or replace function public.get_tenant_homepage(p_slug text)
returns table (
  tenant_name            text,
  tenant_slug            text,
  tenant_status          public.tenant_status,
  tenant_logo_url        text,
  tenant_primary_color   text,
  tenant_secondary_color text,
  content_json           jsonb,
  member_count           bigint,
  homepage_enabled       boolean
)
language sql stable security definer set search_path = public as $$
  select t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color,
         coalesce(p.content_json, '{"blocks":[]}'::jsonb),
         (select count(*) from public.profiles pr
           where pr.tenant_id = t.id and pr.status = 'active'),
         coalesce((select f.enabled from public.feature_flags f
                    where f.tenant_id = t.id and f.feature_key = 'homepage'), true)
  from public.tenants t
  left join public.tenant_pages p on p.tenant_id = t.id and p.page_type = 'home'
  where t.slug = p_slug;
$$;
revoke all on function public.get_tenant_homepage(text) from public;
grant execute on function public.get_tenant_homepage(text) to anon, authenticated;
