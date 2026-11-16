-- 017: customer tracking link, delivery code, personal-order receipts, driver stats, nightly report

-- settings
alter table public.settings add column if not exists require_delivery_code boolean not null default false;
alter table public.settings add column if not exists stuck_alert_min int not null default 3;

-- orders
alter table public.orders add column if not exists track_token uuid not null default gen_random_uuid();
alter table public.orders add column if not exists delivery_code text not null default lpad((floor(random() * 10000))::int::text, 4, '0');
alter table public.orders add column if not exists receipt_total numeric;
alter table public.orders add column if not exists receipt_path text;
create unique index if not exists orders_track_token_idx on public.orders (track_token);

-- public tracking (anon): only what the customer needs
create or replace function public.track_order(p_token uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare o orders; d profiles; r profiles; z zones; s settings; live boolean;
begin
  select * into o from orders where track_token = p_token;
  if not found or o.created_at < now() - interval '2 days' then return null; end if;
  select * into s from settings where id = 1;
  select * into z from zones where id = o.zone_id;
  select * into r from profiles where id = o.restaurant_id;
  select * into d from profiles where id = o.driver_id;
  live := o.status in ('accepted','picked_up','on_the_way');
  return json_build_object(
    'id', o.id, 'status', o.status, 'kind', o.kind, 'request', o.request_text, 'place', o.pickup_place,
    'zone', z.name, 'address', o.address, 'order_total', coalesce(o.receipt_total, o.order_total), 'receipt', o.receipt_total is not null,
    'fee', o.delivery_fee, 'created_at', o.created_at, 'accepted_at', o.accepted_at, 'picked_up_at', o.picked_up_at, 'delivered_at', o.delivered_at,
    'from', case when o.kind = 'personal' then null else r.name end,
    'pickup', case when o.pickup_lat is null then null else json_build_object('lat', o.pickup_lat, 'lng', o.pickup_lng) end,
    'drop', case when o.drop_lat is null then null else json_build_object('lat', o.drop_lat, 'lng', o.drop_lng) end,
    'driver', case when d.id is null then null else json_build_object('name', split_part(d.name, ' ', 1),
        'phone', case when live then d.phone end, 'vehicle', d.vehicle_type,
        'lat', case when live then d.lat end, 'lng', case when live then d.lng end, 'at', case when live then d.location_at end) end,
    'code', case when o.status in ('delivered','refused','cancelled') then null else o.delivery_code end,
    'app', json_build_object('name', s.app_name, 'logo', s.logo_url, 'color', s.primary_color, 'phone', s.support_phone));
end $$;
grant execute on function public.track_order(uuid) to anon, authenticated;

-- personal orders: driver records what he actually paid (+ optional photo) and that counts as picked up
create or replace function public.driver_set_receipt(oid bigint, p_amount numeric, p_path text default null)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = oid for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not (is_admin() or (coalesce(my_role(),'') = 'driver' and o.driver_id = auth.uid())) then raise exception 'غير مصرح'; end if;
  if o.kind <> 'personal' then raise exception 'هذا مو طلب شخصي'; end if;
  if o.status not in ('accepted','picked_up','on_the_way') then raise exception 'حالة الطلب ما تسمح'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'اكتب مبلغ الفاتورة'; end if;
  if p_path is not null and p_path not like o.driver_id::text || '/%' then raise exception 'مسار الصورة غلط'; end if;
  update orders set receipt_total = p_amount, order_total = p_amount, receipt_path = coalesce(p_path, receipt_path),
    status = case when status = 'accepted' then 'picked_up' else status end,
    picked_up_at = coalesce(picked_up_at, now())
  where id = oid returning * into o;
  return o;
end $$;
grant execute on function public.driver_set_receipt(bigint, numeric, text) to authenticated;

-- driver performance for a date range (Baghdad days)
create or replace function public.driver_stats(p_from date, p_to date)
returns json language plpgsql stable security definer set search_path = public as $$
declare tz text := 'Asia/Baghdad'; r json;
begin
  if not has_perm('drivers','reports') then raise exception 'غير مصرح'; end if;
  select coalesce(json_agg(t order by t.delivered desc, t.name), '[]'::json) into r from (
    select p.id, p.name,
      (select count(*) from order_offers f where f.driver_id = p.id and (f.created_at at time zone tz)::date between p_from and p_to) offers,
      (select count(*) from order_offers f where f.driver_id = p.id and f.result = 'accepted' and (f.created_at at time zone tz)::date between p_from and p_to) accepted,
      (select count(*) from order_offers f where f.driver_id = p.id and f.result = 'declined' and (f.created_at at time zone tz)::date between p_from and p_to) declined,
      (select count(*) from order_offers f where f.driver_id = p.id and f.result = 'expired' and (f.created_at at time zone tz)::date between p_from and p_to) expired,
      (select count(*) from orders o where o.driver_id = p.id and o.status = 'delivered' and (o.delivered_at at time zone tz)::date between p_from and p_to) delivered,
      (select count(*) from orders o where o.driver_id = p.id and o.status = 'refused' and (o.closed_at at time zone tz)::date between p_from and p_to) refused,
      (select round(avg(extract(epoch from o.delivered_at - o.accepted_at) / 60)::numeric, 1) from orders o where o.driver_id = p.id and o.status = 'delivered'
         and o.accepted_at is not null and (o.delivered_at at time zone tz)::date between p_from and p_to) avg_min,
      (select round(avg(extract(epoch from o.picked_up_at - o.accepted_at) / 60)::numeric, 1) from orders o where o.driver_id = p.id and o.picked_up_at is not null
         and o.accepted_at is not null and (o.created_at at time zone tz)::date between p_from and p_to) avg_pick_min,
      (select coalesce(sum(o.delivery_fee - o.commission), 0) from orders o where o.driver_id = p.id and o.status = 'delivered' and (o.delivered_at at time zone tz)::date between p_from and p_to) earned
    from profiles p where p.role = 'driver' and p.removed_at is null) t;
  return r;
end $$;
grant execute on function public.driver_stats(date, date) to authenticated;

-- nightly summary
create table if not exists public.daily_reports (day date primary key, data json not null, created_at timestamptz not null default now());
alter table public.daily_reports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'daily_reports' and policyname = 'daily_reports_read') then
    create policy daily_reports_read on public.daily_reports for select using (has_perm('reports'));
  end if;
end $$;

create or replace function public.daily_report_push(p_day date default null)
returns json language plpgsql security definer set search_path = public as $$
declare tz text := 'Asia/Baghdad'; dday date := coalesce(p_day, (now() at time zone tz)::date); j json; body text;
  sec text; fn text := 'https://pvhypcxlbhfwxlpmzxtm.supabase.co/functions/v1/send-push';
begin
  with d as (select * from orders o where (o.created_at at time zone tz)::date = dday)
  select json_build_object(
    'day', dday,
    'orders', (select count(*) from d),
    'delivered', (select count(*) from d where status = 'delivered'),
    'refused', (select count(*) from d where status = 'refused'),
    'cancelled', (select count(*) from d where status = 'cancelled'),
    'personal', (select count(*) from d where kind = 'personal'),
    'commission', (select coalesce(sum(commission), 0) from d where status = 'delivered'),
    'fees', (select coalesce(sum(delivery_fee), 0) from d where status = 'delivered'),
    'debt', (select coalesce(sum(amount), 0) from ledger),
    'top_restaurant', (select p.name || ' (' || count(*) || ')' from d join profiles p on p.id = d.restaurant_id where d.kind = 'restaurant' group by p.name order by count(*) desc limit 1),
    'top_driver', (select p.name || ' (' || count(*) || ')' from d join profiles p on p.id = d.driver_id where d.status = 'delivered' group by p.name order by count(*) desc limit 1)
  ) into j;
  insert into daily_reports (day, data) values (dday, j) on conflict (day) do update set data = excluded.data, created_at = now();
  body := format('%s طلب · توصّل %s · رفض %s · عمولة %s د.ع · ديون السواق %s د.ع%s%s',
    j->>'orders', j->>'delivered', j->>'refused', to_char((j->>'commission')::numeric, 'FM999,999,999'), to_char((j->>'debt')::numeric, 'FM999,999,999'),
    coalesce(' · أكثر مطعم: ' || (j->>'top_restaurant'), ''), coalesce(' · أكثر سايق: ' || (j->>'top_driver'), ''));
  select value into sec from app_secrets where key = 'push_secret';
  if sec is not null then
    perform net.http_post(url := fn, headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', sec),
      body := jsonb_build_object('type', 'report', 'user_id', p.id, 'title', '📊 تقرير اليوم ' || to_char(dday, 'YYYY-MM-DD'), 'body', body))
    from profiles p where p.role = 'admin' and p.active and (p.permissions is null or 'reports' = any(p.permissions));
  end if;
  return j;
end $$;
-- daily_report_push: execute removed from public, anon, authenticated (cron only)

select cron.schedule('daily-report', '50 20 * * *', 'select public.daily_report_push()');

-- driver_update_status: when settings.require_delivery_code is on, a driver must pass the
-- order's delivery_code as p_note to mark it delivered (admins bypass). Applied as migration "delivery_code_check".
-- storage bucket "receipts" (private, 8MB, images) with policies receipts_insert (own folder) and
-- receipts_read (own folder, admins, or the restaurant of the order). Applied as migration "receipts_bucket".
