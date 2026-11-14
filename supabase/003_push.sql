-- Web Push notifications
create extension if not exists pg_net;

-- server-only secrets (RLS on, no policies => only service_role can read)
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
-- values inserted separately (vapid_public, vapid_private, push_secret) — never commit them

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy push_own_select on public.push_subscriptions for select using (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete using (user_id = auth.uid());

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or my_role() is null then raise exception 'غير مصرح'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_ua)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.notify_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare sec text; fn text := 'https://pvhypcxlbhfwxlpmzxtm.supabase.co/functions/v1/send-push'; hdr jsonb;
begin
  select value into sec from app_secrets where key = 'push_secret';
  if sec is null then return new; end if;
  hdr := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', sec);
  if new.status = 'offered' and new.offered_driver_id is not null
     and (old.status is distinct from 'offered' or new.offered_driver_id is distinct from old.offered_driver_id) then
    perform net.http_post(url := fn, headers := hdr,
      body := jsonb_build_object('type', 'offer', 'order_id', new.id, 'user_id', new.offered_driver_id));
  end if;
  if new.status is distinct from old.status and new.status in ('accepted', 'picked_up', 'delivered', 'refused') then
    perform net.http_post(url := fn, headers := hdr,
      body := jsonb_build_object('type', 'status', 'order_id', new.id, 'user_id', new.restaurant_id));
  end if;
  return new;
end $$;
revoke execute on function public.notify_push() from public, anon, authenticated;

drop trigger if exists orders_notify_push on public.orders;
create trigger orders_notify_push after update on public.orders
  for each row execute function public.notify_push();
