-- Keep the owner's signed-out testing and narrowly identified automated CTA
-- sessions out of the admin reports. This migration was applied to production
-- before the application-side marker shipped; committing it keeps repository
-- migration history aligned with production.
--
-- Rollback: recreate the function with only the first two admin-account
-- branches. The grants below can remain unchanged.

create or replace function public.admin_session_ids(p_start timestamptz, p_end timestamptz)
returns table(session_id text)
language sql stable security definer
set search_path = 'public', 'pg_temp'
as $$
  select distinct pe.session_id
    from public.product_events pe
    join public.admin_users a on a.user_id = pe.user_id
    where pe.created_at >= p_start and pe.created_at < p_end
  union
  select distinct pv.session_id
    from public.page_views pv
    join public.admin_users a on a.user_id = pv.user_id
    where pv.created_at >= p_start and pv.created_at < p_end
  union
  -- A tab can open before the reporting window and remain active afterwards.
  select distinct pe.session_id
    from public.product_events pe
    where pe.event = 'internal_session'
      and pe.created_at >= p_start - interval '1 day' and pe.created_at < p_end
  union
  -- A direct internal CTA hit that left before the first heartbeat and did
  -- nothing a person initiated. Every condition must hold.
  select f.session_id
    from (
      select distinct on (pv.session_id) pv.session_id, pv.created_at, pv.utm_source, pv.referrer
        from public.page_views pv
        where pv.created_at >= p_start and pv.created_at < p_end and pv.session_id is not null
        order by pv.session_id, pv.created_at
    ) f
    where rtrim(f.utm_source, '/') in ('blog', 'companies')
      and coalesce(f.referrer, '') = ''
      and (select count(*) from public.page_views v where v.session_id = f.session_id) = 1
      and not exists (select 1 from public.live_pings l
        where l.session_id = f.session_id and l.created_at >= f.created_at + interval '20 seconds')
      and not exists (select 1 from public.landing_clicks c where c.session_id = f.session_id)
      and not exists (select 1 from public.search_events s where s.session_id = f.session_id)
      and not exists (select 1 from public.export_events x where x.session_id = f.session_id)
      and not exists (select 1 from public.product_events e
        where e.session_id = f.session_id
          and e.event not in ('editor_opened', 'first_map_checklist_shown', 'first_layer_added', 'mobile_editor_banner_shown')
          and not (e.event = 'layer_added' and coalesce(e.props->>'source', '') in ('demo', 'deeplink')))
$$;

revoke execute on function public.admin_session_ids(timestamptz, timestamptz)
  from authenticated, anon, public;
grant execute on function public.admin_session_ids(timestamptz, timestamptz)
  to service_role;
