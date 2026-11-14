-- Restaurant must set its location (map pin + description) before ordering; drivers see it on offers.
create or replace function public.restaurant_set_place(p_lat double precision, p_lng double precision, p_address text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(my_role(),'') <> 'restaurant' then raise exception 'غير مصرح'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'الموقع غير صحيح'; end if;
  update profiles set lat = p_lat, lng = p_lng, address = coalesce(nullif(trim(p_address), ''), address) where id = auth.uid();
end $$;
-- revoke from public/anon (done via execute), grant to authenticated
grant execute on function public.restaurant_set_place(double precision, double precision, text) to authenticated;
-- create_order now raises 'حدد موقع المطعم أول...' when neither the restaurant nor the request has a location.
