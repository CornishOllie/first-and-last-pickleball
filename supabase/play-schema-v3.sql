-- Play night tool, version 3: many clubs on one database.
-- Run after play-schema.sql and play-schema-v2.sql. Safe to run again.
--
--   * Every member, session and rating belongs to a club. Attendance and games belong to their session's club.
--   * Hosts are per club (club_roles), replacing the old global play_hosts list.
--   * A host of one club can never read or change another club's rows.
--   * One person (one sign-in) can be a member of several clubs, with one member row in each.
--   * Names no longer have to be unique. Emails are unique within a club.

-- ---------- clubs ----------
create table if not exists clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  short_name text not null default '',
  contact_email text not null default '',
  timezone text not null default 'Europe/London',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table clubs enable row level security;
-- Club names are public (they are on each club's website). Nobody writes through the API: scripts use the service key.
drop policy if exists "anyone reads clubs" on clubs;
create policy "anyone reads clubs" on clubs for select to anon, authenticated using (true);

insert into clubs (id, slug, name, short_name, contact_email)
values ('8c272569-0e18-46a7-be5b-e9dbaef31b1a', 'first-and-last', 'First & Last Pickleball Club', 'F&L', 'hello@firstandlastpickleball.co.uk')
on conflict (id) do nothing;

-- ---------- roles ----------
create table if not exists club_roles (
  club_id uuid not null references clubs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'host')),
  name text not null default '',
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table club_roles enable row level security;
drop policy if exists "people read their own roles" on club_roles;
create policy "people read their own roles" on club_roles for select to authenticated using (user_id = auth.uid());

create or replace function is_club_host(p_club uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from club_roles where club_id = p_club and user_id = auth.uid());
$$;
create or replace function is_club_admin(p_club uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from club_roles where club_id = p_club and user_id = auth.uid() and role = 'admin');
$$;

-- Old global hosts become hosts of F&L.
do $$ begin
  if to_regclass('public.play_hosts') is not null then
    insert into club_roles (club_id, user_id, role, name)
    select '8c272569-0e18-46a7-be5b-e9dbaef31b1a', user_id, 'host', name from play_hosts
    on conflict do nothing;
  end if;
end $$;

-- ---------- club on every row ----------
alter table play_members add column if not exists club_id uuid references clubs (id);
alter table play_sessions add column if not exists club_id uuid references clubs (id);
alter table play_ratings add column if not exists club_id uuid references clubs (id);
update play_members set club_id = '8c272569-0e18-46a7-be5b-e9dbaef31b1a' where club_id is null;
update play_sessions set club_id = '8c272569-0e18-46a7-be5b-e9dbaef31b1a' where club_id is null;
update play_ratings set club_id = '8c272569-0e18-46a7-be5b-e9dbaef31b1a' where club_id is null;
alter table play_members alter column club_id set not null;
alter table play_sessions alter column club_id set not null;
alter table play_ratings alter column club_id set not null;
create index if not exists play_sessions_club_idx on play_sessions (club_id, session_date desc);
create index if not exists play_ratings_club_idx on play_ratings (club_id);

-- Names are not unique any more (two people can share a name). Emails and sign-ins are unique within a club.
drop index if exists play_members_name_idx;
drop index if exists play_members_email_idx;
drop index if exists play_members_user_idx;
create index if not exists play_members_club_name_idx on play_members (club_id, lower(name));
create unique index if not exists play_members_club_email_idx on play_members (club_id, lower(email)) where email is not null and email <> '';
create unique index if not exists play_members_club_user_idx on play_members (club_id, user_id) where user_id is not null;
create index if not exists play_members_user_any_idx on play_members (user_id) where user_id is not null;

-- ---------- helpers for the rules ----------
create or replace function play_session_club(p_session uuid) returns uuid
language sql security definer set search_path = public stable as $$
  select club_id from play_sessions where id = p_session;
$$;
create or replace function play_member_club(p_member uuid) returns uuid
language sql security definer set search_path = public stable as $$
  select club_id from play_members where id = p_member;
$$;
revoke all on function play_session_club(uuid) from public, anon;
revoke all on function play_member_club(uuid) from public, anon;
grant execute on function play_session_club(uuid) to authenticated;
grant execute on function play_member_club(uuid) to authenticated;
grant execute on function is_club_host(uuid) to authenticated;
grant execute on function is_club_admin(uuid) to authenticated;

-- ---------- row rules ----------
drop policy if exists "hosts manage members" on play_members;
create policy "hosts manage members" on play_members for all to authenticated
  using (is_club_host(club_id)) with check (is_club_host(club_id));

drop policy if exists "hosts manage sessions" on play_sessions;
create policy "hosts manage sessions" on play_sessions for all to authenticated
  using (is_club_host(club_id)) with check (is_club_host(club_id));

drop policy if exists "hosts manage ratings" on play_ratings;
create policy "hosts manage ratings" on play_ratings for all to authenticated
  using (is_club_host(club_id))
  with check (
    is_club_host(club_id)
    and play_member_club(member_id) = club_id
    and (session_id is null or play_session_club(session_id) = club_id)
  );

drop policy if exists "hosts manage attendance" on play_attendance;
create policy "hosts manage attendance" on play_attendance for all to authenticated
  using (is_club_host(play_session_club(session_id)))
  with check (is_club_host(play_session_club(session_id)) and play_member_club(member_id) = play_session_club(session_id));

drop policy if exists "hosts manage games" on play_games;
create policy "hosts manage games" on play_games for all to authenticated
  using (is_club_host(play_session_club(session_id)))
  with check (
    is_club_host(play_session_club(session_id))
    and (a1 is null or play_member_club(a1) = play_session_club(session_id))
    and (a2 is null or play_member_club(a2) = play_session_club(session_id))
    and (b1 is null or play_member_club(b1) = play_session_club(session_id))
    and (b2 is null or play_member_club(b2) = play_session_club(session_id))
  );

-- ---------- old versions of the functions (their signatures change, so drop them) ----------
drop function if exists play_host_summary(date);
drop function if exists play_set_visibility(boolean);
drop function if exists play_my_stats(date);
drop function if exists play_leaderboard(date, int);
drop function if exists play_sides(date);
drop function if exists play_link_me();

-- ---------- host: publish a session's facts ----------
-- The club comes from the session. A member id from another club is ignored, and names only match within the club.
create or replace function play_publish_facts(p_session uuid, p_players jsonb, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  g jsonb;
  mid uuid;
  club uuid;
  map jsonb := '{}'::jsonb;
begin
  select club_id into club from play_sessions where id = p_session;
  if club is null then raise exception 'unknown session'; end if;
  if not is_club_host(club) then raise exception 'not allowed' using errcode = '42501'; end if;

  for rec in select * from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) loop
    mid := null;
    if nullif(rec->>'member_id', '') is not null then
      select id into mid from play_members where id = (rec->>'member_id')::uuid and club_id = club;
    end if;
    if mid is null then
      select id into mid from play_members
        where club_id = club and lower(name) = lower(trim(rec->>'name'))
        order by created_at limit 1;
    end if;
    if mid is null then
      insert into play_members (club_id, name, gender)
      values (club, trim(rec->>'name'), case when rec->>'gender' in ('M', 'F') then rec->>'gender' else '' end)
      returning id into mid;
    end if;
    map := map || jsonb_build_object(rec->>'key', mid);
  end loop;

  delete from play_attendance where session_id = p_session;
  delete from play_games where session_id = p_session;

  for rec in select * from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) loop
    insert into play_attendance (session_id, member_id, status)
    values (p_session, (map->>(rec->>'key'))::uuid, rec->>'status')
    on conflict (session_id, member_id) do update set status = excluded.status;
  end loop;

  for g in select * from jsonb_array_elements(coalesce(p_games, '[]'::jsonb)) loop
    insert into play_games (session_id, round_no, court, a1, a2, b1, b2, score_a, score_b)
    values (
      p_session, (g->>'round')::int, (g->>'court')::int,
      (map->>(g->'a'->>0))::uuid, (map->>(g->'a'->>1))::uuid,
      (map->>(g->'b'->>0))::uuid, (map->>(g->'b'->>1))::uuid,
      (g->>'score_a')::int, (g->>'score_b')::int
    );
  end loop;

  return map;
end $$;

-- ---------- shared: every player's games in one club, one row per player per game ----------
create or replace function play_sides(p_club uuid, p_since date)
returns table (m uuid, partner uuid, pf int, pa int, session_id uuid, session_date date)
language sql security definer set search_path = public stable as $$
  with g as (
    select pg.*, s.session_date as sdate
    from play_games pg join play_sessions s on s.id = pg.session_id
    where s.club_id = p_club and (s.ended or s.session_date < current_date) and (p_since is null or s.session_date >= p_since)
  )
  select a1, a2, score_a, score_b, session_id, sdate from g where a1 is not null
  union all select a2, a1, score_a, score_b, session_id, sdate from g where a2 is not null
  union all select b1, b2, score_b, score_a, session_id, sdate from g where b1 is not null
  union all select b2, b1, score_b, score_a, session_id, sdate from g where b2 is not null;
$$;

-- ---------- host: summary per member (turnout and no-shows are host-only) ----------
create or replace function play_host_summary(p_club uuid, p_since date default null)
returns table (member_id uuid, attended int, no_shows int, cancelled int, games int, won int)
language plpgsql security definer set search_path = public stable as $$
begin
  if not is_club_host(p_club) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select m.id,
    coalesce(a.attended, 0)::int, coalesce(a.no_shows, 0)::int, coalesce(a.cancelled, 0)::int,
    coalesce(g.games, 0)::int, coalesce(g.won, 0)::int
  from play_members m
  left join (
    select pa.member_id,
      count(*) filter (where pa.status in ('attended', 'walk_in')) attended,
      count(*) filter (where pa.status = 'no_show') no_shows,
      count(*) filter (where pa.status = 'cancelled') cancelled
    from play_attendance pa join play_sessions s on s.id = pa.session_id
    where s.club_id = p_club and (s.ended or s.session_date < current_date) and (p_since is null or s.session_date >= p_since)
    group by pa.member_id
  ) a on a.member_id = m.id
  left join (
    select x.m, count(*) games, count(*) filter (where x.pf > x.pa) won from play_sides(p_club, p_since) x group by x.m
  ) g on g.m = m.id
  where m.club_id = p_club;
end $$;

-- ---------- host: merge a duplicate into the right person (same club only) ----------
create or replace function play_merge_members(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d_email text;
  d_user uuid;
  club uuid;
begin
  if p_keep = p_drop then return; end if;
  select club_id into club from play_members where id = p_keep;
  if club is null or play_member_club(p_drop) is distinct from club then raise exception 'not the same club' using errcode = '42501'; end if;
  if not is_club_host(club) then raise exception 'not allowed' using errcode = '42501'; end if;
  select email, user_id into d_email, d_user from play_members where id = p_drop;

  update play_attendance a set member_id = p_keep
    where a.member_id = p_drop
      and not exists (select 1 from play_attendance k where k.session_id = a.session_id and k.member_id = p_keep);
  delete from play_attendance where member_id = p_drop;
  update play_games set a1 = p_keep where a1 = p_drop;
  update play_games set a2 = p_keep where a2 = p_drop;
  update play_games set b1 = p_keep where b1 = p_drop;
  update play_games set b2 = p_keep where b2 = p_drop;
  update play_ratings set member_id = p_keep where member_id = p_drop;
  delete from play_members where id = p_drop;
  update play_members set email = coalesce(nullif(email, ''), d_email), user_id = coalesce(user_id, d_user) where id = p_keep;
end $$;

-- ---------- players: link their sign-in to their record in every club that has their email ----------
create or replace function play_link_me()
returns table (id uuid, name text, show_stats boolean, is_junior boolean, guardian_ok boolean, club_id uuid, club_slug text, club_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then return; end if;
  update play_members m set user_id = auth.uid()
    where m.user_id is null and m.active and m.email is not null and m.email <> ''
      and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and not exists (select 1 from play_members x where x.user_id = auth.uid() and x.club_id = m.club_id);
  return query
    select m.id, m.name, m.show_stats, m.is_junior, m.guardian_ok, c.id, c.slug, c.name
    from play_members m join clubs c on c.id = m.club_id
    where m.user_id = auth.uid() and m.active
    order by c.name;
end $$;

create or replace function play_set_visibility(p_club uuid, p_show boolean)
returns void language sql security definer set search_path = public as $$
  update play_members set show_stats = p_show where user_id = auth.uid() and club_id = p_club and active;
$$;

-- ---------- players: my own numbers in one club ----------
create or replace function play_my_stats(p_club uuid, p_since date default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  me uuid;
  games_j jsonb;
  att_j jsonb;
  partners_j jsonb;
  recent_j jsonb;
begin
  select id into me from play_members where user_id = auth.uid() and club_id = p_club and active;
  if me is null then return null; end if;

  select jsonb_build_object(
    'games', count(*),
    'won', count(*) filter (where pf > pa),
    'lost', count(*) filter (where pf < pa),
    'drawn', count(*) filter (where pf = pa),
    'points_for', coalesce(sum(pf), 0),
    'points_against', coalesce(sum(pa), 0)
  ) into games_j from play_sides(p_club, p_since) where m = me;

  select jsonb_build_object(
    'attended', count(*) filter (where a.status in ('attended', 'walk_in')),
    'no_shows', count(*) filter (where a.status = 'no_show'),
    'cancelled', count(*) filter (where a.status = 'cancelled')
  ) into att_j
  from play_attendance a join play_sessions s on s.id = a.session_id
  where a.member_id = me and s.club_id = p_club and (s.ended or s.session_date < current_date) and (p_since is null or s.session_date >= p_since);

  select coalesce(jsonb_agg(t order by t.games desc, t.won desc), '[]'::jsonb) into partners_j from (
    select case when pm.show_stats and (not pm.is_junior or pm.guardian_ok) then pm.name else 'Another player' end as name,
      count(*) as games, count(*) filter (where x.pf > x.pa) as won
    from play_sides(p_club, p_since) x join play_members pm on pm.id = x.partner
    where x.m = me
    group by pm.id, pm.name, pm.show_stats, pm.is_junior, pm.guardian_ok
    order by count(*) desc, count(*) filter (where x.pf > x.pa) desc
    limit 3
  ) t;

  select coalesce(jsonb_agg(t order by t.date desc), '[]'::jsonb) into recent_j from (
    select x.session_date as date, s.name, count(*) as games, count(*) filter (where x.pf > x.pa) as won
    from play_sides(p_club, p_since) x join play_sessions s on s.id = x.session_id
    where x.m = me
    group by x.session_id, x.session_date, s.name
    order by x.session_date desc
    limit 8
  ) t;

  return jsonb_build_object('games', games_j, 'attendance', att_j, 'partners', partners_j, 'recent', recent_j);
end $$;

-- ---------- players: one club's leaderboard (games only, never attendance) ----------
create or replace function play_leaderboard(p_club uuid, p_since date default null, p_min_games int default 6)
returns table (name text, games int, won int, lost int, win_pct numeric, diff int, sessions int, is_me boolean)
language plpgsql security definer set search_path = public stable as $$
#variable_conflict use_column
declare
  me uuid;
  me_show boolean;
begin
  select m.id, m.show_stats into me, me_show from play_members m where m.user_id = auth.uid() and m.club_id = p_club and m.active;
  if me is null or not me_show then return; end if;
  return query
  with s as (
    select x.m as mid, count(*) as g, count(*) filter (where x.pf > x.pa) as w, count(*) filter (where x.pf < x.pa) as l,
      sum(x.pf - x.pa) as d, count(distinct x.session_id) as n
    from play_sides(p_club, p_since) x group by x.m
  )
  select pm.name, s.g::int, s.w::int, s.l::int, round(100.0 * s.w / s.g, 1), s.d::int, s.n::int, (pm.id = me)
  from s join play_members pm on pm.id = s.mid
  where pm.club_id = p_club and pm.active and pm.show_stats and (not pm.is_junior or pm.guardian_ok) and s.g >= p_min_games
  order by round(100.0 * s.w / s.g, 1) desc, s.d desc, s.g desc, pm.name;
end $$;

-- ---------- who may call what ----------
revoke all on function play_publish_facts(uuid, jsonb, jsonb) from public, anon;
revoke all on function play_host_summary(uuid, date) from public, anon;
revoke all on function play_merge_members(uuid, uuid) from public, anon;
revoke all on function play_link_me() from public, anon;
revoke all on function play_set_visibility(uuid, boolean) from public, anon;
revoke all on function play_sides(uuid, date) from public, anon, authenticated;
revoke all on function play_my_stats(uuid, date) from public, anon;
revoke all on function play_leaderboard(uuid, date, int) from public, anon;
revoke all on function is_club_host(uuid) from public, anon;
revoke all on function is_club_admin(uuid) from public, anon;
grant execute on function play_publish_facts(uuid, jsonb, jsonb) to authenticated;
grant execute on function play_host_summary(uuid, date) to authenticated;
grant execute on function play_merge_members(uuid, uuid) to authenticated;
grant execute on function play_link_me() to authenticated;
grant execute on function play_set_visibility(uuid, boolean) to authenticated;
grant execute on function play_my_stats(uuid, date) to authenticated;
grant execute on function play_leaderboard(uuid, date, int) to authenticated;

-- ---------- the old global host list is no longer used ----------
drop table if exists play_hosts;
drop function if exists is_play_host();
