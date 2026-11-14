-- Users & permissions: an admin with permissions = null is a full admin (owner).
-- Otherwise permissions lists the admin tabs he may use:
-- live, map, drivers, restaurants, orders, vouchers, daily, accounts, reports, statement, zones, flagged, settings, users
alter table public.profiles add column if not exists permissions text[];

create or replace function public.has_perm(variadic p text[]) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' and active and (permissions is null or permissions && p)
                    from profiles where id = auth.uid()), false) $$;
grant execute on function public.has_perm(text[]) to authenticated;

create or replace function public.my_permissions() returns text[]
language sql stable security definer set search_path = public as
$$ select permissions from profiles where id = auth.uid() $$;

-- only someone with the "users" permission can change roles, permissions, or admin accounts
create or replace function public.guard_profile_perms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role (edge function)
  if tg_op = 'INSERT' then
    if (new.role = 'admin' or new.permissions is not null) and not has_perm('users') then raise exception 'ما عندك صلاحية المستخدمين'; end if;
    return new;
  end if;
  if (new.permissions is distinct from old.permissions or new.role is distinct from old.role
      or (old.role = 'admin' and new.active is distinct from old.active)) then
    if not has_perm('users') then raise exception 'ما عندك صلاحية المستخدمين'; end if;
    if new.id = auth.uid() then raise exception 'ما تكدر تغير صلاحياتك أو توقف حسابك'; end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_guard_perms') then
    create trigger profiles_guard_perms before insert or update on public.profiles
      for each row execute function public.guard_profile_perms();
  end if;
end $$;

-- gate money RPCs by permission
do $$
declare r record; d text; nd text;
begin
  for r in select p.oid, x.perm from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join (values ('create_voucher','vouchers'), ('cancel_voucher','vouchers'), ('finance_totals','accounts'),
                 ('profit_report','reports'), ('cash_movements','daily')) x(fn, perm) on x.fn = p.proname
    where n.nspname = 'public'
  loop
    d := pg_get_functiondef(r.oid);
    nd := replace(d, 'if not is_admin() then', format('if not has_perm(%L) then', r.perm));
    if r.perm = 'vouchers' then nd := replace(nd, format('has_perm(%L)', 'vouchers'), 'has_perm(''vouchers'',''accounts'')'); end if;
    if nd <> d then execute nd; end if;
  end loop;
end $$;

-- table access by permission
alter policy settings_admin on public.settings using (has_perm('settings')) with check (has_perm('settings'));
alter policy employees_admin on public.employees using (has_perm('accounts')) with check (has_perm('accounts'));
alter policy partners_admin on public.partners using (has_perm('accounts')) with check (has_perm('accounts'));
alter policy partner_tx_admin on public.partner_transactions using (has_perm('accounts')) with check (has_perm('accounts'));
alter policy expenses_admin on public.expenses using (has_perm('accounts','vouchers','reports')) with check (has_perm('accounts','vouchers'));
alter policy excat_admin on public.expense_categories using (has_perm('accounts','vouchers')) with check (has_perm('accounts','vouchers'));
alter policy vouchers_admin_read on public.vouchers using (has_perm('vouchers','accounts','daily','statement'));
alter policy zones_admin on public.zones using (has_perm('zones')) with check (has_perm('zones'));
