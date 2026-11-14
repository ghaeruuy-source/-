-- Admin can push a waiting order to a chosen driver; going offline no longer counts as a decline;
-- drivers who declined can be offered the same order again after 2 minutes (dispatch_order updated in 001).
create or replace function public.admin_offer(oid bigint, p_driver uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; s settings; d profiles;
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  select * into o from orders where id = oid for update;
  if not found or o.status not in ('searching','offered') then raise exception 'الطلب مو بانتظار سائق'; end if;
  select * into d from profiles where id = p_driver and role = 'driver' and active;
  if not found then raise exception 'السائق غير موجود'; end if;
  select * into s from settings where id = 1;
  update order_offers set result = 'expired' where order_id = oid and result = 'pending';
  insert into order_offers (order_id, driver_id, distance_km)
    values (oid, p_driver, case when o.pickup_lat is null or d.lat is null then null
            else round(haversine_km(o.pickup_lat, o.pickup_lng, d.lat, d.lng)::numeric, 2) end);
  update orders set status = 'offered', offered_driver_id = p_driver,
    offer_expires_at = now() + make_interval(secs => s.offer_timeout_sec) where id = oid;
end $$;

create or replace function public.driver_set_online(p_online boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') <> 'driver' then raise exception 'غير مصرح'; end if;
  update profiles set online = p_online where id = auth.uid();
  if not p_online then
    update order_offers set result = 'expired' where driver_id = auth.uid() and result = 'pending';
    perform dispatch_order(id) from orders where offered_driver_id = auth.uid() and status = 'offered';
  end if;
end $$;
