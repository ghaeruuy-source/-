-- Vouchers (سندات): receive (قبض), spend (صرف), pay (دفع) + expense categories (تبويبات المصاريف)
-- Vouchers are never removed: they are cancelled (ملغي) and their effect is reversed.
create table if not exists public.expense_categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.expense_categories (name) values
  ('رواتب'), ('إيجار'), ('وقود'), ('إعلانات'), ('اتصالات وإنترنت'), ('صيانة'), ('كهرباء ومولدة'), ('ضيافة'), ('مكتب ولوازم'), ('مصاريف عامة')
on conflict (name) do nothing;
alter table public.expense_categories enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'expense_categories' and policyname = 'excat_admin') then
    create policy excat_admin on public.expense_categories for all using (is_admin()) with check (is_admin());
  end if;
end $$;

create table if not exists public.vouchers (
  id bigint generated always as identity primary key,
  vtype text not null check (vtype in ('receive','spend','pay')),
  number int not null,
  voucher_date date not null default current_date,
  amount numeric not null check (amount > 0),
  category text,
  party_type text not null default 'other' check (party_type in ('driver','partner','employee','other')),
  party_id text,
  party_name text,
  note text,
  cancelled boolean not null default false,
  cancelled_at timestamptz,
  cancel_reason text,
  cancelled_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (vtype, number)
);
create index if not exists vouchers_date_idx on public.vouchers (voucher_date);
alter table public.vouchers enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'vouchers' and policyname = 'vouchers_admin_read') then
    create policy vouchers_admin_read on public.vouchers for select using (is_admin());
  end if;
end $$;

alter table public.expenses add column if not exists voucher_id bigint references public.vouchers(id);
alter table public.expenses add column if not exists void boolean not null default false;
alter table public.ledger add column if not exists voucher_id bigint references public.vouchers(id);
alter table public.partner_transactions add column if not exists voucher_id bigint references public.vouchers(id);
alter table public.partner_transactions add column if not exists void boolean not null default false;

create or replace function public.create_voucher(
  p_type text, p_amount numeric, p_date date default current_date,
  p_category text default null, p_party_type text default 'other', p_party_id text default null,
  p_party_name text default null, p_note text default null, p_salary_month date default null)
returns public.vouchers language plpgsql security definer set search_path = public as $$
declare v vouchers; n int; pname text := p_party_name;
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'المبلغ لازم يكون أكبر من صفر'; end if;
  if p_type not in ('receive','spend','pay') then raise exception 'نوع السند غلط'; end if;
  if p_type = 'spend' and coalesce(trim(p_category), '') = '' then raise exception 'اختار تبويب المصروف'; end if;

  if p_party_type = 'driver' then select name into pname from profiles where id = p_party_id::uuid and role = 'driver';
  elsif p_party_type = 'partner' then select name into pname from partners where id = p_party_id::bigint;
  elsif p_party_type = 'employee' then select name into pname from employees where id = p_party_id::bigint;
  end if;
  if p_party_type <> 'other' and pname is null then raise exception 'الجهة غير موجودة'; end if;

  perform pg_advisory_xact_lock(hashtext('voucher_' || p_type));
  select coalesce(max(number), 0) + 1 into n from vouchers where vtype = p_type;
  insert into vouchers (vtype, number, voucher_date, amount, category, party_type, party_id, party_name, note)
    values (p_type, n, coalesce(p_date, current_date), p_amount, nullif(trim(p_category), ''), p_party_type, p_party_id, pname, p_note)
    returning * into v;

  if p_type = 'spend' then
    insert into expenses (spent_on, category, amount, note, employee_id, salary_month, voucher_id)
      values (v.voucher_date, v.category, p_amount, coalesce(p_note, pname),
              case when p_party_type = 'employee' then p_party_id::bigint end, p_salary_month, v.id);
  elsif p_type = 'receive' and p_party_type = 'driver' then
    insert into ledger (driver_id, amount, kind, note, created_by, voucher_id)
      values (p_party_id::uuid, -p_amount, 'settlement', 'سند قبض #' || n || coalesce(' · ' || p_note, ''), auth.uid(), v.id);
  elsif p_type = 'receive' and p_party_type = 'partner' then
    insert into partner_transactions (partner_id, kind, amount, happened_on, note, voucher_id)
      values (p_party_id::bigint, 'capital', p_amount, v.voucher_date, coalesce(p_note, 'سند قبض #' || n), v.id);
  elsif p_type = 'pay' and p_party_type = 'partner' then
    insert into partner_transactions (partner_id, kind, amount, happened_on, note, voucher_id)
      values (p_party_id::bigint, 'withdrawal', p_amount, v.voucher_date, coalesce(p_note, 'سند دفع #' || n), v.id);
  elsif p_type = 'pay' and p_party_type = 'driver' then
    -- cash handed to a driver: he owes it back
    insert into ledger (driver_id, amount, kind, note, created_by, voucher_id)
      values (p_party_id::uuid, p_amount, 'adjustment', 'سند دفع #' || n || coalesce(' · ' || p_note, ''), auth.uid(), v.id);
  end if;
  return v;
end $$;

create or replace function public.cancel_voucher(p_id bigint, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v vouchers;
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الحذف'; end if;
  select * into v from vouchers where id = p_id for update;
  if not found then raise exception 'السند غير موجود'; end if;
  if v.cancelled then raise exception 'السند محذوف من قبل'; end if;
  update vouchers set cancelled = true, cancelled_at = now(), cancel_reason = trim(p_reason), cancelled_by = auth.uid() where id = p_id;
  update expenses set void = true where voucher_id = p_id;
  update partner_transactions set void = true where voucher_id = p_id;
  -- reverse driver ledger effect with an opposite entry of the same kind
  insert into ledger (driver_id, amount, kind, note, created_by, voucher_id)
    select driver_id, -amount, kind, 'حذف ' || note, auth.uid(), p_id from ledger
    where voucher_id = p_id and note not like 'حذف %';
end $$;

-- totals now exclude void rows and include other income / other payments
create or replace function public.finance_totals() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  return json_build_object(
    'commission', (select coalesce(sum(commission),0) from orders where status = 'delivered'),
    'received', (select coalesce(-sum(amount),0) from ledger where kind = 'settlement'),
    'debt', (select coalesce(sum(amount),0) from ledger),
    'salaries', (select coalesce(sum(amount),0) from expenses where category = 'رواتب' and not void),
    'expenses', (select coalesce(sum(amount),0) from expenses where category <> 'رواتب' and not void),
    'capital', (select coalesce(sum(amount),0) from partner_transactions where kind = 'capital' and not void),
    'withdrawals', (select coalesce(sum(amount),0) from partner_transactions where kind = 'withdrawal' and not void),
    'other_income', (select coalesce(sum(amount),0) from vouchers where vtype = 'receive' and party_type = 'other' and not cancelled),
    'other_payments', (select coalesce(sum(amount),0) from vouchers where vtype = 'pay' and party_type in ('other','employee') and not cancelled),
    'driver_payouts', (select coalesce(sum(amount),0) from vouchers where vtype = 'pay' and party_type = 'driver' and not cancelled),
    'partners', (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'share', p.share_percent, 'active', p.active,
        'capital', (select coalesce(sum(amount),0) from partner_transactions t where t.partner_id = p.id and kind = 'capital' and not void),
        'withdrawals', (select coalesce(sum(amount),0) from partner_transactions t where t.partner_id = p.id and kind = 'withdrawal' and not void)) order by p.id), '[]'::json) from partners p)
  );
end $$;

create or replace function public.profit_report(p_from date, p_to date) returns json
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'Asia/Baghdad'; r json;
begin
  if not is_admin() then raise exception 'غير مصرح'; end if;
  with d as (
    select o.*, (o.delivered_at at time zone tz)::date as day from orders o
    where o.status = 'delivered' and (o.delivered_at at time zone tz)::date between p_from and p_to
  ), x as (
    select * from expenses where spent_on between p_from and p_to and not void
  ), st as (
    select l.*, (l.created_at at time zone tz)::date as day from ledger l
    where l.kind = 'settlement' and (l.created_at at time zone tz)::date between p_from and p_to
  ), oi as (
    select * from vouchers where vtype = 'receive' and party_type = 'other' and not cancelled and voucher_date between p_from and p_to
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
    'other_income', (select coalesce(sum(amount),0) from oi),
    'received', (select coalesce(-sum(amount),0) from st),
    'salaries', (select coalesce(sum(amount),0) from x where category = 'رواتب'),
    'expenses', (select coalesce(sum(amount),0) from x where category <> 'رواتب'),
    'by_status', (select coalesce(json_object_agg(status, n), '{}'::json) from allo),
    'by_category', (select coalesce(json_object_agg(category, s), '{}'::json) from (select category, sum(amount) s from x group by 1) c),
    'by_day', (select json_agg(json_build_object('day', days.day,
        'orders', (select count(*) from d where d.day = days.day),
        'commission', (select coalesce(sum(commission),0) from d where d.day = days.day) + (select coalesce(sum(amount),0) from oi where oi.voucher_date = days.day),
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
