-- Cash boxes (الصناديق): every voucher lands in a box (default: الصندوق اليومي).
-- A box with close_to set is closed every night at 23:59 Baghdad time and its balance moves to that box (القاصة).
create table if not exists public.cash_boxes (
  id bigint generated always as identity primary key,
  name text not null unique,
  is_default boolean not null default false,
  close_to bigint references public.cash_boxes(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.cash_boxes (name) values ('القاصة') on conflict (name) do nothing;
insert into public.cash_boxes (name, is_default, close_to)
  select 'الصندوق اليومي', true, id from public.cash_boxes where name = 'القاصة'
on conflict (name) do nothing;

create table if not exists public.box_transfers (
  id bigint generated always as identity primary key,
  from_box bigint not null references public.cash_boxes(id),
  to_box bigint not null references public.cash_boxes(id),
  amount numeric not null check (amount > 0),
  note text,
  closing_id bigint,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (from_box <> to_box)
);

create table if not exists public.box_closings (
  id bigint generated always as identity primary key,
  box_id bigint not null references public.cash_boxes(id),
  close_day date not null,
  opening numeric not null default 0,
  total_in numeric not null default 0,
  total_out numeric not null default 0,
  closing numeric not null default 0,
  moved_to bigint references public.cash_boxes(id),
  auto boolean not null default false,
  note text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now()
);

create or replace function public.default_box_id() returns bigint
language sql stable security definer set search_path = public as
$$ select id from cash_boxes where is_default and active order by id limit 1 $$;

alter table public.vouchers add column if not exists box_id bigint references public.cash_boxes(id) default public.default_box_id();

alter table public.cash_boxes enable row level security;
alter table public.box_transfers enable row level security;
alter table public.box_closings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'cash_boxes' and policyname = 'boxes_read') then
    create policy boxes_read on public.cash_boxes for select using (has_perm('boxes','vouchers','accounts','daily'));
    create policy boxes_admin on public.cash_boxes for insert with check (has_perm('boxes'));
    create policy boxes_admin_upd on public.cash_boxes for update using (has_perm('boxes')) with check (has_perm('boxes'));
    create policy box_transfers_read on public.box_transfers for select using (has_perm('boxes','daily'));
    create policy box_closings_read on public.box_closings for select using (has_perm('boxes','daily'));
  end if;
end $$;

-- movement of a box between two instants
create or replace function public.box_flow(p_box bigint, p_from timestamptz, p_to timestamptz, out total_in numeric, out total_out numeric)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(amount) from vouchers where box_id = p_box and not cancelled and vtype = 'receive' and created_at >= p_from and created_at < p_to), 0)
  + coalesce((select sum(amount) from box_transfers where to_box = p_box and created_at >= p_from and created_at < p_to), 0),
    coalesce((select sum(amount) from vouchers where box_id = p_box and not cancelled and vtype in ('spend','pay') and created_at >= p_from and created_at < p_to), 0)
  + coalesce((select sum(amount) from box_transfers where from_box = p_box and created_at >= p_from and created_at < p_to), 0)
$$;

create or replace function public.box_balance(p_box bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select f.total_in - f.total_out from box_flow(p_box, '-infinity', 'infinity') f
$$;

create or replace function public._close_box(p_box bigint, p_auto boolean, p_note text default null) returns public.box_closings
language plpgsql security definer set search_path = public as $$
declare b cash_boxes; last_at timestamptz; f record; bal numeric; c box_closings; tz text := 'Asia/Baghdad';
begin
  if auth.uid() is not null and not has_perm('boxes') then raise exception 'غير مصرح'; end if;
  select * into b from cash_boxes where id = p_box for update;
  if not found then raise exception 'الصندوق غير موجود'; end if;
  if b.close_to is null then raise exception 'هذا الصندوق ما يتسكر (ما محدد وين يروح رصيده)'; end if;
  select max(closed_at) into last_at from box_closings where box_id = p_box;
  select * into f from box_flow(p_box, coalesce(last_at, '-infinity'), 'infinity');
  bal := box_balance(p_box);
  insert into box_closings (box_id, close_day, opening, total_in, total_out, closing, moved_to, auto, note, closed_by)
    values (p_box, (now() at time zone tz)::date, bal - f.total_in + f.total_out, f.total_in, f.total_out, bal, b.close_to, p_auto, p_note, auth.uid())
    returning * into c;
  if bal <> 0 then
    -- a negative balance is covered from the target box
    insert into box_transfers (from_box, to_box, amount, note, closing_id, created_by, created_at)
      values (case when bal > 0 then p_box else b.close_to end, case when bal > 0 then b.close_to else p_box end,
              abs(bal), 'تسكير ' || b.name || ' ' || c.close_day, c.id, auth.uid(), c.closed_at - interval '1 millisecond');
  end if;
  return c;
end $$;

create or replace function public.close_box(p_box bigint, p_note text default null) returns public.box_closings
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('boxes') then raise exception 'غير مصرح'; end if;
  return _close_box(p_box, false, p_note);
end $$;

create or replace function public.close_all_boxes_nightly() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is not null and not has_perm('boxes') then raise exception 'غير مصرح'; end if;
  for r in select id from cash_boxes where active and close_to is not null loop
    perform _close_box(r.id, true, 'تسكير تلقائي');
  end loop;
end $$;

create or replace function public.transfer_box(p_from bigint, p_to bigint, p_amount numeric, p_note text default null) returns public.box_transfers
language plpgsql security definer set search_path = public as $$
declare t box_transfers;
begin
  if not has_perm('boxes') then raise exception 'غير مصرح'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'المبلغ لازم يكون أكبر من صفر'; end if;
  if p_from = p_to then raise exception 'اختار صندوقين مختلفين'; end if;
  insert into box_transfers (from_box, to_box, amount, note) values (p_from, p_to, p_amount, nullif(trim(p_note), '')) returning * into t;
  return t;
end $$;

create or replace function public.box_summary() returns json
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'Asia/Baghdad'; today_start timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
begin
  if not has_perm('boxes','vouchers','daily') then raise exception 'غير مصرح'; end if;
  return (select coalesce(json_agg(json_build_object(
      'id', b.id, 'name', b.name, 'is_default', b.is_default, 'close_to', b.close_to, 'active', b.active,
      'balance', box_balance(b.id),
      'today_in', (select total_in from box_flow(b.id, today_start, 'infinity')),
      'today_out', (select total_out from box_flow(b.id, today_start, 'infinity')),
      'last_closed', (select max(closed_at) from box_closings c where c.box_id = b.id)
    ) order by b.is_default desc, b.id), '[]'::json) from cash_boxes b where b.active);
end $$;

-- voucher into a chosen box
create or replace function public.create_voucher_box(
  p_box bigint, p_type text, p_amount numeric, p_date date default current_date,
  p_category text default null, p_party_type text default 'other', p_party_id text default null,
  p_party_name text default null, p_note text default null, p_salary_month date default null)
returns public.vouchers language plpgsql security definer set search_path = public as $$
declare v vouchers;
begin
  v := create_voucher(p_type, p_amount, p_date, p_category, p_party_type, p_party_id, p_party_name, p_note, p_salary_month);
  if p_box is not null and p_box <> coalesce(v.box_id, -1) then
    if not exists (select 1 from cash_boxes where id = p_box and active) then raise exception 'الصندوق غير موجود'; end if;
    update vouchers set box_id = p_box where id = v.id returning * into v;
  end if;
  return v;
end $$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'close-boxes-nightly') then
    perform cron.schedule('close-boxes-nightly', '59 20 * * *', 'select public.close_all_boxes_nightly()');
  end if;
end $$;
