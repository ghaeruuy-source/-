-- Partners (profit split), partner money movements, and a report function.
create table if not exists public.partners (
  id bigint generated always as identity primary key,
  name text not null,
  phone text,
  share_percent numeric not null default 50 check (share_percent >= 0 and share_percent <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.partner_transactions (
  id bigint generated always as identity primary key,
  partner_id bigint not null references public.partners(id),
  kind text not null check (kind in ('withdrawal','capital')),
  amount numeric not null check (amount > 0),
  happened_on date not null default current_date,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists partner_tx_date_idx on public.partner_transactions (happened_on);
alter table public.partners enable row level security;
alter table public.partner_transactions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'partners' and policyname = 'partners_admin') then
    create policy partners_admin on public.partners for all using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'partner_transactions' and policyname = 'partner_tx_admin') then
    create policy partner_tx_admin on public.partner_transactions for all using (is_admin()) with check (is_admin());
  end if;
end $$;

-- Profit report for a date range (Baghdad time). Admin only.
create or replace function public.profit_report(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'Asia/Baghdad'; r json;
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  with d as (
    select o.*, (o.delivered_at at time zone tz)::date as day from orders o
    where o.status = 'delivered' and (o.delivered_at at time zone tz)::date between p_from and p_to
  ), x as (
    select * from expenses where spent_on between p_from and p_to
  ), st as (
    select l.*, (l.created_at at time zone tz)::date as day from ledger l
    where l.kind = 'settlement' and (l.created_at at time zone tz)::date between p_from and p_to
  ), allo as (
    select o.status, count(*) n from orders o where (o.created_at at time zone tz)::date between p_from and p_to group by 1
  ), days as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  )
  select json_build_object(
    'orders', (select count(*) from d),
    'order_value', (select coalesce(sum(order_total),0) from d),
    'delivery_fees', (select coalesce(sum(delivery_fee),0) from d),
    'commission', (select coalesce(sum(commission),0) from d),
    'received', (select coalesce(-sum(amount),0) from st),
    'salaries', (select coalesce(sum(amount),0) from x where category = 'رواتب'),
    'expenses', (select coalesce(sum(amount),0) from x where category <> 'رواتب'),
    'by_status', (select coalesce(json_object_agg(status, n), '{}'::json) from allo),
    'by_category', (select coalesce(json_object_agg(category, s), '{}'::json) from (select category, sum(amount) s from x group by 1) c),
    'by_day', (select json_agg(json_build_object('day', days.day,
        'orders', (select count(*) from d where d.day = days.day),
        'commission', (select coalesce(sum(commission),0) from d where d.day = days.day),
        'received', (select coalesce(-sum(amount),0) from st where st.day = days.day),
        'spent', (select coalesce(sum(amount),0) from x where x.spent_on = days.day)) order by days.day) from days),
    'by_driver', (select coalesce(json_agg(t order by t.commission desc), '[]'::json) from (
        select p.name, count(*) orders, sum(d.delivery_fee) fees, sum(d.commission) commission,
          coalesce((select -sum(amount) from st where st.driver_id = p.id), 0) paid,
          (select coalesce(sum(amount),0) from ledger l where l.driver_id = p.id) debt_now
        from d join profiles p on p.id = d.driver_id group by p.id, p.name) t),
    'by_restaurant', (select coalesce(json_agg(t order by t.orders desc), '[]'::json) from (
        select p.name, count(*) orders, sum(d.order_total) value, sum(d.commission) commission
        from d join profiles p on p.id = d.restaurant_id group by p.id, p.name) t),
    'by_zone', (select coalesce(json_agg(t order by t.orders desc), '[]'::json) from (
        select z.name, count(*) orders, sum(d.delivery_fee) fees, sum(d.commission) commission
        from d join zones z on z.id = d.zone_id group by z.id, z.name) t)
  ) into r;
  return r;
end $$;

-- All-time totals for the cash box and partner balances. Admin only.
create or replace function public.finance_totals() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  return json_build_object(
    'commission', (select coalesce(sum(commission),0) from orders where status = 'delivered'),
    'received', (select coalesce(-sum(amount),0) from ledger where kind = 'settlement'),
    'adjustments', (select coalesce(sum(amount),0) from ledger where kind = 'adjustment'),
    'debt', (select coalesce(sum(amount),0) from ledger),
    'salaries', (select coalesce(sum(amount),0) from expenses where category = 'رواتب'),
    'expenses', (select coalesce(sum(amount),0) from expenses where category <> 'رواتب'),
    'capital', (select coalesce(sum(amount),0) from partner_transactions where kind = 'capital'),
    'withdrawals', (select coalesce(sum(amount),0) from partner_transactions where kind = 'withdrawal'),
    'partners', (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'share', p.share_percent, 'active', p.active,
        'capital', (select coalesce(sum(amount),0) from partner_transactions t where t.partner_id = p.id and kind = 'capital'),
        'withdrawals', (select coalesce(sum(amount),0) from partner_transactions t where t.partner_id = p.id and kind = 'withdrawal')) order by p.id), '[]'::json) from partners p)
  );
end $$;
