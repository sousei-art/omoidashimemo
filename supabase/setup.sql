-- 思い出しメモ v2.0.0 / Supabase 初期設定
-- Supabase Dashboard > SQL Editor で実行してください。

create extension if not exists pgcrypto;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  title text not null default '',
  category text not null default '',
  tags text[] not null default '{}',
  body text not null default '',
  steps text not null default '',
  caution text not null default '',
  reference_url text not null default '',
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  name text not null default '',
  category text not null default '',
  maker text not null default '',
  model_number text not null default '',
  purchase_date date,
  shop text not null default '',
  price numeric(12,2),
  warranty_until date,
  storage_place text not null default '',
  manual_url text not null default '',
  consumables_memo text not null default '',
  free_memo text not null default '',
  tags text[] not null default '{}',
  status text not null default '所持中（使用中）',
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_status_check check (status in (
    '所持中（使用中）','所持中（未使用）','所持中（使用終わり）','故障','紛失・廃棄','売却済み'
  ))
);

create table if not exists public.image_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_type text not null check (parent_type in ('note','item')),
  parent_id uuid not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists notes_user_legacy_unique on public.notes(user_id, legacy_id) where legacy_id is not null;
create unique index if not exists items_user_legacy_unique on public.items(user_id, legacy_id) where legacy_id is not null;
create index if not exists notes_user_id_idx on public.notes(user_id);
create index if not exists notes_updated_at_idx on public.notes(updated_at desc);
create index if not exists items_user_id_idx on public.items(user_id);
create index if not exists items_purchase_date_idx on public.items(purchase_date desc);
create index if not exists items_updated_at_idx on public.items(updated_at desc);
create index if not exists image_files_user_id_idx on public.image_files(user_id);
create index if not exists image_files_parent_idx on public.image_files(parent_type,parent_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes for each row execute function public.set_updated_at();
drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at before update on public.items for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
alter table public.items enable row level security;
alter table public.image_files enable row level security;

-- notes
drop policy if exists notes_select_own on public.notes;
create policy notes_select_own on public.notes for select to authenticated using (auth.uid()=user_id);
drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes for delete to authenticated using (auth.uid()=user_id);

-- items
drop policy if exists items_select_own on public.items;
create policy items_select_own on public.items for select to authenticated using (auth.uid()=user_id);
drop policy if exists items_insert_own on public.items;
create policy items_insert_own on public.items for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists items_update_own on public.items;
create policy items_update_own on public.items for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists items_delete_own on public.items;
create policy items_delete_own on public.items for delete to authenticated using (auth.uid()=user_id);

-- image_files
drop policy if exists image_files_select_own on public.image_files;
create policy image_files_select_own on public.image_files for select to authenticated using (auth.uid()=user_id);
drop policy if exists image_files_insert_own on public.image_files;
create policy image_files_insert_own on public.image_files for insert to authenticated with check (auth.uid()=user_id);
drop policy if exists image_files_delete_own on public.image_files;
create policy image_files_delete_own on public.image_files for delete to authenticated using (auth.uid()=user_id);

-- Private Storage bucket
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('memo-images','memo-images',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- Storage policies: first folder must equal auth.uid()
drop policy if exists memo_images_select_own on storage.objects;
create policy memo_images_select_own on storage.objects for select to authenticated
using (bucket_id='memo-images' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists memo_images_insert_own on storage.objects;
create policy memo_images_insert_own on storage.objects for insert to authenticated
with check (bucket_id='memo-images' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists memo_images_update_own on storage.objects;
create policy memo_images_update_own on storage.objects for update to authenticated
using (bucket_id='memo-images' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='memo-images' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists memo_images_delete_own on storage.objects;
create policy memo_images_delete_own on storage.objects for delete to authenticated
using (bucket_id='memo-images' and (storage.foldername(name))[1]=auth.uid()::text);
