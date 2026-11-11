-- Nexo Chat database schema. Run in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Nexo user',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  room_type text not null check (room_type in ('direct','group','channel')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages(room_id,created_at);
create index if not exists room_members_user_idx on public.room_members(user_id);
create index if not exists rooms_created_idx on public.rooms(created_at desc);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

-- Profiles: signed-in users can view profile names; users edit only their own.
create policy "profiles readable by authenticated" on public.profiles for select to authenticated using (true);
create policy "users insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Room membership controls room visibility.
create policy "members can view rooms" on public.rooms for select to authenticated
using (exists(select 1 from public.room_members m where m.room_id=id and m.user_id=auth.uid()));
create policy "authenticated users create rooms" on public.rooms for insert to authenticated
with check (created_by=auth.uid());
create policy "owners can update rooms" on public.rooms for update to authenticated
using (exists(select 1 from public.room_members m where m.room_id=id and m.user_id=auth.uid() and m.role in ('owner','admin')))
with check (exists(select 1 from public.room_members m where m.room_id=id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "owners can delete rooms" on public.rooms for delete to authenticated
using (exists(select 1 from public.room_members m where m.room_id=id and m.user_id=auth.uid() and m.role='owner'));

create policy "members can view memberships" on public.room_members for select to authenticated
using (exists(select 1 from public.room_members mine where mine.room_id=room_id and mine.user_id=auth.uid()));
-- Membership insertion: user may add themselves as owner when creating a room.
create policy "users can join self as owner" on public.room_members for insert to authenticated
with check (user_id=auth.uid() and role='owner' and exists(select 1 from public.rooms r where r.id=room_id and r.created_by=auth.uid()));
-- Owners/admins can add members. This policy permits inviting known user IDs from trusted UI flows.
create policy "admins can add members" on public.room_members for insert to authenticated
with check (exists(select 1 from public.room_members mine where mine.room_id=room_id and mine.user_id=auth.uid() and mine.role in ('owner','admin')));
create policy "owners and admins remove members" on public.room_members for delete to authenticated
using (exists(select 1 from public.room_members mine where mine.room_id=room_id and mine.user_id=auth.uid() and mine.role in ('owner','admin')) or user_id=auth.uid());

create policy "members can read messages" on public.messages for select to authenticated
using (exists(select 1 from public.room_members m where m.room_id=messages.room_id and m.user_id=auth.uid()));
create policy "members can send messages" on public.messages for insert to authenticated
with check (sender_id=auth.uid() and exists(select 1 from public.room_members m where m.room_id=messages.room_id and m.user_id=auth.uid()) and exists(select 1 from public.rooms r where r.id=room_id and (r.room_type <> 'channel' or r.created_by=auth.uid() or exists(select 1 from public.room_members m where m.room_id=r.id and m.user_id=auth.uid() and m.role in ('owner','admin')))));

-- Create a profile automatically for new accounts.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id, coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1),'Nexo user'))
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Enable Realtime delivery for messages.
alter table public.messages replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when others then
  raise notice 'If Realtime is not enabled, add public.messages to supabase_realtime publication in Dashboard.';
end $$;
