-- Offers go to the N nearest free drivers at once (settings.offer_batch, default 3); first to accept wins.
-- orders.offered_driver_ids = current round, orders.offer_seen_by = everyone offered (RLS visibility, 3h).
-- Functions replaced in migration "batch_offers_nearest_3": dispatch_order, driver_respond, sweep_dispatch,
-- _leave_offers (new, used by driver_set_online/archive_account), admin_offer, cancel_order, notify_push (push to every driver in the round).
alter table public.orders add column if not exists offered_driver_ids uuid[] not null default '{}';
alter table public.orders add column if not exists offer_seen_by uuid[] not null default '{}';
alter table public.settings add column if not exists offer_batch int not null default 3 check (offer_batch between 1 and 20);
alter policy orders_read on public.orders using (
  is_admin() or restaurant_id = auth.uid() or driver_id = auth.uid() or offered_driver_id = auth.uid()
  or (auth.uid() = any(offer_seen_by) and created_at > now() - interval '3 hours'));
