-- Security audit fixes (already applied to the live DB)
-- 1) driver_balances view ran as its owner, so anyone with the public key could read every driver's name, phone, location and debt.
alter view public.driver_balances set (security_invoker = true);
revoke all on public.driver_balances from anon;

-- 2) internal box-closing functions must never be callable through the API (only pg_cron runs them)
revoke execute on function public._close_box(bigint, boolean, text), public.close_all_boxes_nightly() from public, anon, authenticated;
revoke execute on function public.box_balance(bigint), public.box_flow(bigint, timestamptz, timestamptz), public.default_box_id() from public, anon, authenticated;

-- 3) admin-only functions are not callable by signed-out visitors
revoke execute on function public.box_summary(), public.close_box(bigint, text), public.transfer_box(bigint, bigint, numeric, text),
  public.create_voucher(text, numeric, date, text, text, text, text, text, date), public.create_voucher_box(bigint, text, numeric, date, text, text, text, text, text, date),
  public.cancel_voucher(bigint, text), public.cash_movements(date, date), public.finance_totals(), public.profit_report(date, date),
  public.admin_offer(bigint, uuid), public.has_perm(text[]), public.is_admin(), public.my_permissions(), public.my_role(),
  public.guard_profile_perms(), public.notify_push(), public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.box_summary(), public.close_box(bigint, text), public.transfer_box(bigint, bigint, numeric, text),
  public.create_voucher(text, numeric, date, text, text, text, text, text, date), public.create_voucher_box(bigint, text, numeric, date, text, text, text, text, text, date),
  public.cancel_voucher(bigint, text), public.cash_movements(date, date), public.finance_totals(), public.profit_report(date, date),
  public.admin_offer(bigint, uuid), public.has_perm(text[]), public.is_admin(), public.my_permissions(), public.my_role(),
  public.save_push_subscription(text, text, text, text) to authenticated;

-- 4) manual driver ledger entries need the accounts or vouchers permission (was: any admin)
--    applied by replacing "if not is_admin() then" with "if not has_perm('accounts','vouchers') then" in admin_ledger_entry
