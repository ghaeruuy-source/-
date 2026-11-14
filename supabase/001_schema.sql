-- جايك بالطريق: schema
create extension if not exists pg_cron;

-- ===== tables =====
create table public.settings (
  id int primary key default 1 check (id = 1),
  app_name text not null default 'جايك بالطريق',
  logo_url text,
  primary_color text not null default '#E8590C',
  commission_type text not null default 'fixed' check (commission_type in ('fixed','percent')),
  commission_value numeric not null default 500,
  debt_cap numeric not null default 25000,
  offer_timeout_sec int not null default 30,
  max_active_per_driver int not null default 1,
  location_stale_min int not null default 10,
  support_phone text,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

create table public.zones (
  id bigint generated always as identity primary key,
  name text not null unique,
  delivery_fee numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','restaurant','driver')),
  name text not null,
  phone text not null unique,
  active boolean not null default true,
  -- restaurant fields
  address text,
  zone_id bigint references public.zones(id),
  lat double precision,
  lng double precision,
  -- driver fields
  online boolean not null default false,
  location_at timestamptz,
  vehicle text,
  created_at timestamptz not null default now()
);

create table public.orders (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.profiles(id),
  driver_id uuid references public.profiles(id),
  customer_name text not null,
  customer_phone text not null,
  zone_id bigint not null references public.zones(id),
  address text not null,
  notes text,
  order_total numeric not null check (order_total >= 0),
  delivery_fee numeric not null default 0,
  commission numeric not null default 0,
  pickup_lat double precision,
  pickup_lng double precision,
  status text not null default 'searching' check (status in
    ('searching','offered','accepted','picked_up','on_the_way','delivered','refused','cancelled')),
  offered_driver_id uuid references public.profiles(id),
  offer_expires_at timestamptz,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  close_reason text
);
create index on public.orders (status);
create index on public.orders (driver_id);
create index on public.orders (restaurant_id);
create index on public.orders (offered_driver_id);

create table public.order_offers (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  distance_km numeric,
  result text not null default 'pending' check (result in ('pending','accepted','declined','expired','cancelled')),
  created_at timestamptz not null default now()
);
create index on public.order_offers (order_id);

create table public.ledger (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id),
  order_id bigint references public.orders(id),
  amount numeric not null, -- + = driver owes owner, - = paid
  kind text not null check (kind in ('commission','settlement','adjustment')),
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.ledger (driver_id);

create table public.flagged_phones (
  phone text primary key,
  refused_count int not null default 0,
  last_order_id bigint references public.orders(id),
  note text,
  updated_at timestamptz not null default now()
);

-- ===== helpers =====
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid() and active), false) $$;

create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select case
    when d like '964%' then '0' || substr(d, 4)
    when d like '7%' and length(d) = 10 then '0' || d
    else d end
  from (select regexp_replace(coalesce(p,''), '[^0-9]', '', 'g') as d) s
$$;

create or replace function public.driver_debt(did uuid) returns numeric
language sql stable security definer set search_path = public as
$$ select coalesce(sum(amount), 0) from ledger where driver_id = did $$;

create or replace function public.haversine_km(lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ===== dispatch =====
create or replace function public.dispatch_order(oid bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o orders; s settings; cand record;
begin
  select * into o from orders where id = oid for update;
  if not found or o.status not in ('searching','offered') then return null; end if;
  select * into s from settings where id = 1;

  -- pick nearest available driver not yet tried for this order (declined/expired)
  select p.id,
         case when o.pickup_lat is null or p.lat is null then 9999
              else haversine_km(o.pickup_lat, o.pickup_lng, p.lat, p.lng) end as km
    into cand
  from profiles p
  where p.role = 'driver' and p.active and p.online
    and p.location_at > now() - make_interval(mins => s.location_stale_min)
    and driver_debt(p.id) < s.debt_cap
    and (select count(*) from orders x where x.driver_id = p.id
         and x.status in ('accepted','picked_up','on_the_way')) < s.max_active_per_driver
    and not exists (select 1 from orders x where x.offered_driver_id = p.id and x.status = 'offered' and x.id <> oid)
    and not exists (select 1 from order_offers f where f.order_id = oid and f.driver_id = p.id
                    and f.result in ('declined','expired','pending'))
  order by km asc, p.location_at desc
  limit 1;

  if cand.id is null then
    -- everybody tried: start a new round (drivers who let it expire can get it again; decliners can't)
    select p.id,
           case when o.pickup_lat is null or p.lat is null then 9999
                else haversine_km(o.pickup_lat, o.pickup_lng, p.lat, p.lng) end as km
      into cand
    from profiles p
    where p.role = 'driver' and p.active and p.online
      and p.location_at > now() - make_interval(mins => s.location_stale_min)
      and driver_debt(p.id) < s.debt_cap
      and (select count(*) from orders x where x.driver_id = p.id
           and x.status in ('accepted','picked_up','on_the_way')) < s.max_active_per_driver
      and not exists (select 1 from orders x where x.offered_driver_id = p.id and x.status = 'offered' and x.id <> oid)
      and not exists (select 1 from order_offers f where f.order_id = oid and f.driver_id = p.id
                      and f.result in ('declined','pending'))
      and (o.offered_driver_id is null or p.id <> o.offered_driver_id)
    order by km asc
    limit 1;
  end if;

  if cand.id is null then
    update orders set status = 'searching', offered_driver_id = null, offer_expires_at = null where id = oid;
    return null;
  end if;

  insert into order_offers (order_id, driver_id, distance_km)
    values (oid, cand.id, case when cand.km = 9999 then null else round(cand.km::numeric, 2) end);
  update orders set status = 'offered', offered_driver_id = cand.id,
    offer_expires_at = now() + make_interval(secs => s.offer_timeout_sec)
  where id = oid;
  return cand.id;
end $$;

create or replace function public.sweep_dispatch() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, offered_driver_id from orders
           where status = 'offered' and offer_expires_at < now() order by id loop
    update order_offers set result = 'expired'
      where order_id = r.id and driver_id = r.offered_driver_id and result = 'pending';
    perform dispatch_order(r.id); n := n + 1;
  end loop;
  for r in select id from orders where status = 'searching' order by id loop
    perform dispatch_order(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- ===== RPCs: restaurant =====
create or replace function public.check_phone(p_phone text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('refused_count', coalesce(
    (select refused_count from flagged_phones where phone = normalize_phone(p_phone)), 0))
  where my_role() in ('restaurant','admin')
$$;

create or replace function public.create_order(
  p_customer_name text, p_customer_phone text, p_zone_id bigint, p_address text,
  p_order_total numeric, p_notes text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_restaurant_id uuid default null)
returns orders language plpgsql security definer set search_path = public as $$
declare me profiles; z zones; s settings; rid uuid; o orders; comm numeric;
begin
  select * into me from profiles where id = auth.uid() and active;
  if not found or me.role not in ('restaurant','admin') then raise exception 'غير مصرح'; end if;
  rid := case when me.role = 'admin' then coalesce(p_restaurant_id, me.id) else me.id end;
  if me.role = 'admin' then select * into me from profiles where id = rid; end if;
  select * into z from zones where id = p_zone_id and active;
  if not found then raise exception 'المنطقة غير موجودة'; end if;
  if coalesce(trim(p_customer_name),'') = '' or coalesce(trim(p_address),'') = '' then
    raise exception 'اكمل معلومات الزبون'; end if;
  select * into s from settings where id = 1;
  comm := case when s.commission_type = 'percent'
               then round(z.delivery_fee * s.commission_value / 100)
               else s.commission_value end;
  insert into orders (restaurant_id, customer_name, customer_phone, zone_id, address, notes,
                      order_total, delivery_fee, commission, pickup_lat, pickup_lng)
  values (rid, trim(p_customer_name), normalize_phone(p_customer_phone), z.id, trim(p_address), p_notes,
          p_order_total, z.delivery_fee, comm, coalesce(me.lat, p_lat), coalesce(me.lng, p_lng))
  returning * into o;
  if me.lat is null and p_lat is not null then
    update profiles set lat = p_lat, lng = p_lng where id = rid;
  end if;
  perform dispatch_order(o.id);
  select * into o from orders where id = o.id;
  return o;
end $$;

create or replace function public.cancel_order(oid bigint, reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = oid for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not (is_admin() or (o.restaurant_id = auth.uid() and o.status in ('searching','offered','accepted'))) then
    raise exception 'ما تكدر تلغي هذا الطلب'; end if;
  if o.status in ('delivered','refused','cancelled') then raise exception 'الطلب منتهي'; end if;
  update order_offers set result = 'cancelled' where order_id = oid and result = 'pending';
  update orders set status = 'cancelled', closed_at = now(), close_reason = reason,
    offered_driver_id = null, offer_expires_at = null where id = oid;
end $$;

-- ===== RPCs: driver =====
create or replace function public.driver_set_online(p_online boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') <> 'driver' then raise exception 'غير مصرح'; end if;
  update profiles set online = p_online where id = auth.uid();
  if not p_online then
    -- release any pending offer
    update order_offers set result = 'declined'
      where driver_id = auth.uid() and result = 'pending';
    perform dispatch_order(id) from orders where offered_driver_id = auth.uid() and status = 'offered';
  end if;
end $$;

create or replace function public.driver_location(p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') <> 'driver' then raise exception 'غير مصرح'; end if;
  update profiles set lat = p_lat, lng = p_lng, location_at = now() where id = auth.uid();
end $$;

create or replace function public.driver_respond(oid bigint, p_accept boolean) returns orders
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if coalesce(my_role(),'') <> 'driver' then raise exception 'غير مصرح'; end if;
  select * into o from orders where id = oid for update;
  if not found or o.status <> 'offered' or o.offered_driver_id is distinct from auth.uid() then
    raise exception 'العرض انتهى'; end if;
  if p_accept then
    update order_offers set result = 'accepted' where order_id = oid and driver_id = auth.uid() and result = 'pending';
    update orders set status = 'accepted', driver_id = auth.uid(), accepted_at = now(),
      offered_driver_id = null, offer_expires_at = null where id = oid returning * into o;
  else
    update order_offers set result = 'declined' where order_id = oid and driver_id = auth.uid() and result = 'pending';
    perform dispatch_order(oid);
    select * into o from orders where id = oid;
  end if;
  return o;
end $$;

create or replace function public.driver_update_status(oid bigint, p_status text, p_note text default null) returns orders
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = oid for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not (is_admin() or (coalesce(my_role(),'') = 'driver' and o.driver_id = auth.uid())) then raise exception 'غير مصرح'; end if;
  if o.status not in ('accepted','picked_up','on_the_way') then raise exception 'حالة الطلب ما تسمح'; end if;
  if p_status = 'picked_up' then
    update orders set status = 'picked_up', picked_up_at = now() where id = oid;
  elsif p_status = 'on_the_way' then
    update orders set status = 'on_the_way', picked_up_at = coalesce(picked_up_at, now()) where id = oid;
  elsif p_status = 'delivered' then
    update orders set status = 'delivered', delivered_at = now(), closed_at = now() where id = oid;
    if o.commission > 0 then
      insert into ledger (driver_id, order_id, amount, kind, note)
        values (o.driver_id, oid, o.commission, 'commission', 'عمولة طلب #' || oid);
    end if;
  elsif p_status = 'refused' then
    update orders set status = 'refused', closed_at = now(), close_reason = coalesce(p_note, 'رفض/ما رد') where id = oid;
    insert into flagged_phones (phone, refused_count, last_order_id, note, updated_at)
      values (o.customer_phone, 1, oid, p_note, now())
      on conflict (phone) do update set refused_count = flagged_phones.refused_count + 1,
        last_order_id = oid, note = coalesce(excluded.note, flagged_phones.note), updated_at = now();
  else
    raise exception 'حالة غير معروفة';
  end if;
  select * into o from orders where id = oid;
  return o;
end $$;

-- ===== RPCs: admin =====
create or replace function public.admin_ledger_entry(p_driver uuid, p_amount numeric, p_kind text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  if p_kind not in ('settlement','adjustment') then raise exception 'نوع غير صحيح'; end if;
  insert into ledger (driver_id, amount, kind, note, created_by)
    values (p_driver, case when p_kind = 'settlement' then -abs(p_amount) else p_amount end, p_kind, p_note, auth.uid());
end $$;

create or replace view public.driver_balances with (security_invoker = true) as
  select p.id as driver_id, p.name, p.phone, p.online, p.active, p.lat, p.lng, p.location_at,
    coalesce((select sum(amount) from ledger l where l.driver_id = p.id), 0) as debt,
    (select count(*) from orders o where o.driver_id = p.id and o.status = 'delivered') as delivered_count,
    (select count(*) from orders o where o.driver_id = p.id and o.status in ('accepted','picked_up','on_the_way')) as active_count
  from profiles p where p.role = 'driver';

-- ===== RLS =====
alter table settings enable row level security;
alter table zones enable row level security;
alter table profiles enable row level security;
alter table orders enable row level security;
alter table order_offers enable row level security;
alter table ledger enable row level security;
alter table flagged_phones enable row level security;

create policy settings_read on settings for select using (true);
create policy settings_admin on settings for update using (is_admin()) with check (is_admin());

create policy zones_read on zones for select using (auth.role() = 'authenticated');
create policy zones_admin on zones for all using (is_admin()) with check (is_admin());

create policy profiles_read on profiles for select using (
  id = auth.uid() or is_admin()
  or role = 'restaurant'
  or (role = 'driver' and exists (select 1 from orders o where o.driver_id = profiles.id
        and o.restaurant_id = auth.uid() and o.status in ('accepted','picked_up','on_the_way')))
);
create policy profiles_admin on profiles for all using (is_admin()) with check (is_admin());
create policy orders_read on orders for select using (
  is_admin() or restaurant_id = auth.uid() or driver_id = auth.uid() or offered_driver_id = auth.uid());
create policy orders_admin on orders for update using (is_admin()) with check (is_admin());

create policy offers_read on order_offers for select using (is_admin() or driver_id = auth.uid());

create policy ledger_read on ledger for select using (is_admin() or driver_id = auth.uid());

create policy flagged_read on flagged_phones for select using (is_admin());
create policy flagged_admin on flagged_phones for all using (is_admin()) with check (is_admin());

-- functions only for signed-in users
revoke execute on function public.dispatch_order(bigint) from public, anon, authenticated;
revoke execute on function public.sweep_dispatch() from public, anon;
grant execute on function public.sweep_dispatch() to authenticated;

-- ===== realtime =====
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.ledger;
alter publication supabase_realtime add table public.settings;

-- ===== cron: re-dispatch every 5 seconds =====
select cron.schedule('sweep-dispatch', '5 seconds', $$select public.sweep_dispatch()$$);


-- ===== later additions =====
create or replace function public.needs_setup() returns boolean
language sql stable security definer set search_path = public as
$$ select not exists (select 1 from profiles where role = 'admin') $$;
grant execute on function public.needs_setup() to anon, authenticated;

create or replace function public.restaurant_set_location(p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') <> 'restaurant' then raise exception 'غير مصرح'; end if;
  update profiles set lat = p_lat, lng = p_lng where id = auth.uid();
end $$;
