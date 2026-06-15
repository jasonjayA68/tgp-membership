-- =============================================================================
-- SaaS OS — Migration 0012: tenant_pages (homepage CMS)
-- -----------------------------------------------------------------------------
-- ADDITIVE over 0007–0011. One table + one public read RPC. RLS: members read
-- (for editing), admins write, anon only via get_tenant_homepage.
-- =============================================================================

create table if not exists public.tenant_pages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  page_type    text not null,
  content_json jsonb not null default '{"blocks":[]}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, page_type)
);
create index if not exists tenant_pages_tenant_idx on public.tenant_pages (tenant_id);

alter table public.tenant_pages enable row level security;

drop policy if exists tenant_pages_select on public.tenant_pages;
drop policy if exists tenant_pages_write  on public.tenant_pages;

create policy tenant_pages_select on public.tenant_pages for select
  using (public.is_tenant_member(tenant_id));
create policy tenant_pages_write on public.tenant_pages for all
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- Public homepage read: branding + content + live active-member count.
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
  member_count           bigint
)
language sql stable security definer set search_path = public as $$
  select t.name, t.slug, t.status, t.logo_url, t.primary_color, t.secondary_color,
         coalesce(p.content_json, '{"blocks":[]}'::jsonb),
         (select count(*) from public.profiles pr
           where pr.tenant_id = t.id and pr.status = 'active')
  from public.tenants t
  left join public.tenant_pages p on p.tenant_id = t.id and p.page_type = 'home'
  where t.slug = p_slug;
$$;

revoke all on function public.get_tenant_homepage(text) from public;
grant execute on function public.get_tenant_homepage(text) to anon, authenticated;
