-- Driver vehicle (motorcycle/car + full info) and documents (private storage bucket driver-docs).
alter table public.profiles add column if not exists vehicle_type text check (vehicle_type in ('motorcycle','car'));
alter table public.profiles add column if not exists vehicle_info jsonb;
alter table public.profiles add column if not exists biz_type text; -- restaurant | shop | page | free text (≤30)
create table if not exists public.driver_documents (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles(id),
  doc_type text not null, file_path text not null unique, file_name text, mime text, note text,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now());
alter table public.driver_documents enable row level security;
create policy ddocs_admin on public.driver_documents for all using (has_perm('drivers')) with check (has_perm('drivers'));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf']) on conflict (id) do nothing;
create policy driver_docs_rw on storage.objects for all to authenticated
  using (bucket_id = 'driver-docs' and public.has_perm('drivers')) with check (bucket_id = 'driver-docs' and public.has_perm('drivers'));
