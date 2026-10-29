-- Club play night tool: hosts, members, sessions and ratings.
-- Run once in the Supabase SQL editor. Only people listed in play_hosts can read or write anything.

create table if not exists play_hosts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists play_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender text not null default '' check (gender in ('', 'M', 'F')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists play_members_name_idx on play_members (lower(name));

create table if not exists play_sessions (
  id uuid primary key,
  name text not null,
  session_date date not null,
  ended boolean not null default false,
  state jsonb not null,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists play_ratings (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references play_members (id) on delete cascade,
  session_id uuid references play_sessions (id) on delete set null,
  level int not null check (level between 1 and 5),
  note text not null default '',
  rated_by uuid default auth.uid(),
  rated_at timestamptz not null default now()
);
create index if not exists play_ratings_member_idx on play_ratings (member_id, rated_at desc);

-- Row level security: hosts only.
alter table play_hosts enable row level security;
alter table play_members enable row level security;
alter table play_sessions enable row level security;
alter table play_ratings enable row level security;

create or replace function is_play_host() returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from play_hosts where user_id = auth.uid());
$$;

drop policy if exists "host reads own row" on play_hosts;
create policy "host reads own row" on play_hosts for select to authenticated using (user_id = auth.uid());

drop policy if exists "hosts manage members" on play_members;
create policy "hosts manage members" on play_members for all to authenticated
  using (is_play_host()) with check (is_play_host());

drop policy if exists "hosts manage sessions" on play_sessions;
create policy "hosts manage sessions" on play_sessions for all to authenticated
  using (is_play_host()) with check (is_play_host());

drop policy if exists "hosts manage ratings" on play_ratings;
create policy "hosts manage ratings" on play_ratings for all to authenticated
  using (is_play_host()) with check (is_play_host());
