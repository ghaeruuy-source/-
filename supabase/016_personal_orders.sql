-- 016: personal orders (customer asks for anything: bread, groceries, errands).
-- Admin writes the request, picks the buying place on the map, and sends it to the
-- nearest drivers automatically or to one driver by hand.
-- (run separately first: alter table public.orders alter column restaurant_id drop not null;)

alter table public.orders add column if not exists kind text not null default 'restaurant';
alter table public.orders add column if not exists request_text text;
alter table public.orders add column if not exists pickup_place text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_kind_check') then
    alter table public.orders add constraint orders_kind_check
      check (kind in ('restaurant','personal') and (kind = 'personal' or restaurant_id is not null));
  end if;
end $$;

create or replace function public.create_personal_order(
  p_customer_phone text, p_zone_id bigint, p_address text, p_request text,
  p_pickup_place text default null, p_pickup_lat double precision default null, p_pickup_lng double precision default null,
  p_order_total numeric default 0, p_fee numeric default null, p_customer_name text default null,
  p_notes text default null, p_driver uuid default null)
returns orders language plpgsql security definer set search_path = public as $$
declare z zones; s settings; o orders; fee numeric; comm numeric;
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  if coalesce(trim(p_request),'') = '' then raise exception 'اكتب شنو يريد الزبون'; end if;
  select * into z from zones where id = p_zone_id and active;
  if not found then raise exception 'المنطقة غير موجودة'; end if;
  if coalesce(trim(p_address),'') = '' or coalesce(normalize_phone(p_customer_phone),'') = '' then
    raise exception 'اكمل معلومات الزبون'; end if;
  if coalesce(p_order_total,0) < 0 or coalesce(p_fee,0) < 0 then raise exception 'المبلغ غلط'; end if;
  select * into s from settings where id = 1;
  fee := coalesce(p_fee, z.delivery_fee);
  comm := case when s.commission_type = 'percent' then round(fee * s.commission_value / 100) else least(s.commission_value, fee) end;
  insert into orders (kind, restaurant_id, customer_name, customer_phone, zone_id, address, notes, request_text, pickup_place,
                      order_total, delivery_fee, commission, pickup_lat, pickup_lng)
  values ('personal', null, coalesce(nullif(trim(p_customer_name),''), 'زبون'), normalize_phone(p_customer_phone), z.id,
          trim(p_address), nullif(trim(p_notes),''), trim(p_request), nullif(trim(p_pickup_place),''),
          coalesce(p_order_total,0), fee, comm, p_pickup_lat, p_pickup_lng)
  returning * into o;
  if p_driver is not null then perform admin_offer(o.id, p_driver);
  else perform dispatch_order(o.id); end if;
  select * into o from orders where id = o.id;
  return o;
end $$;
revoke all on function public.create_personal_order(text,bigint,text,text,text,double precision,double precision,numeric,numeric,text,text,uuid) from public, anon;
grant execute on function public.create_personal_order(text,bigint,text,text,text,double precision,double precision,numeric,numeric,text,text,uuid) to authenticated;

-- notify_push: no restaurant to tell for personal orders
-- profit_report: personal orders grouped as "طلبات شخصية" in by_restaurant
-- (both patched in place with replace(), see thread notes)
