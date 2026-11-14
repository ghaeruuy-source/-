-- Remove (archive) a driver or restaurant with a required reason; history stays, account can be restored.
alter table public.profiles add column if not exists removed_at timestamptz;
alter table public.profiles add column if not exists removed_reason text;
alter table public.profiles add column if not exists removed_by uuid references public.profiles(id);
-- functions archive_account(p_id, p_reason) and restore_account(p_id): see live DB (migration "archive_accounts")
