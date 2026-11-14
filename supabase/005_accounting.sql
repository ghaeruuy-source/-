-- Accounting: expenses, employees, salary payments (admin only)
alter table public.settings add column if not exists font_family text not null default 'IBM Plex Sans Arabic';

create table if not exists public.employees (
  id bigint generated always as identity primary key,
  name text not null,
  job text,
  phone text,
  monthly_salary numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  spent_on date not null default current_date,
  category text not null,
  amount numeric not null check (amount > 0),
  note text,
  employee_id bigint references public.employees(id),
  salary_month date, -- first day of the month this salary covers
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists expenses_spent_on_idx on public.expenses (spent_on);

alter table public.employees enable row level security;
alter table public.expenses enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'employees' and policyname = 'employees_admin') then
    create policy employees_admin on public.employees for all using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'expenses' and policyname = 'expenses_admin') then
    create policy expenses_admin on public.expenses for all using (is_admin()) with check (is_admin());
  end if;
end $$;
