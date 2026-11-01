-- Play night tool, version 2: player records, attendance, games, and player-facing stats.
-- Run after play-schema.sql. Safe to run again.
--
-- Privacy rules live here, not just on screen:
--   * Only hosts can read or write the tables directly.
--   * Players use the play_* functions, which only ever return their own numbers plus a leaderboard.
--   * The leaderboard never shows attendance or no-shows, only games played.
--   * Someone who has switched stats off is not on the leaderboard, and does not see it either.
--   * Under 18s are not on the leaderboard unless a host has recorded a parent's OK (guardian_ok).
--   * Only finished sessions (or sessions from a past day) count.

-- ---------- players ----------
alter table play_members add column if not exists email text;
alter table play_members add column if not exists is_junior boolean not null default false;
alter table play_members add column if not exists guardian_ok boolean not null default false;
alter table play_members add column if not exists show_stats boolean not null default true;
alter table play_members add column if not exists user_id uuid references auth.users (id) on delete set null;
create unique index if not exists play_members_email_idx on play_members (lower(email)) where email is not null and email <> '';
create unique index if not exists play_members_user_idx on play_members (user_id) where user_id is not null;

-- ---------- attendance and games ----------
create table if not exists play_attendance (
  session_id uuid not null references play_sessions (id) on delete cascade,
  member_id uuid not null references play_members (id) on delete cascade,
  status text not null check (status in ('attended', 'walk_in', 'no_show', 'cancelled')),
  primary key (session_id, member_id)
);
create index if not exists play_attendance_member_idx on play_attendance (member_id);

-- Players are set to null (not deleted) if a member is erased, so other players' games survive.
create table if not exists play_games (
  id bigint generated always as identity primary key,
  session_id uuid not null references play_sessions (id) on delete cascade,
  round_no int not null,
  court int not null,
  a1 uuid references play_members (id) on delete set null,
  a2 uuid references play_members (id) on delete set null,
  b1 uuid references play_members (id) on delete set null,
  b2 uuid references play_members (id) on delete set null,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0)
);
create index if not exists play_games_session_idx on play_games (session_id);

alter table play_attendance enable row level security;
alter table play_games enable row level security;

drop policy if exists "hosts manage attendance" on play_attendance;
create policy "hosts manage attendance" on play_attendance for all to authenticated
  using (is_play_host()) with check (is_play_host());
drop policy if exists "hosts manage games" on play_games;
create policy "hosts manage games" on play_games for all to authenticated
  using (is_play_host()) with check (is_play_host());

-- ---------- host: publish a session's facts ----------
-- p_players: [{key, name, gender, member_id?, status}]   status: attended | walk_in | no_show | cancelled
-- p_games:   [{round, court, a:[key,key], b:[key,key], score_a, score_b}]
-- Finds or creates a member for each name, replaces this session's rows, and returns {key: member_id}.
create or replace function play_publish_facts(p_session uuid, p_players jsonb, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  g jsonb;
  mid uuid;
  map jsonb := '{}'::jsonb;
begin
  if not is_play_host() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from play_sessions where id = p_session) then raise exception 'unknown session'; end if;

  for rec in select * from jsonb_array_elements(coalesce(p_players, '[]'::jsonb)) loop
    mid := null;
    if nullif(rec->>'member_id', '') is not null then
      select id into mid from play_members where id = (rec->>'member_id')::uuid;
    end if;
    if mid is null then
      select id into mid from play_members where lower(name) = lower(trim(rec->>'name'));
    end if;
    if mid is null then
      insert into play_members (name, gender)
      values (trim(rec->>'name'), case when rec->>'gender' in ('M', 'F') then rec->>'gender' else '' end)
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

-- ---------- host: summary per member (turnout and no-shows are host-only) ----------
create or replace function play_host_summary(p_since date default null)
returns table (member_id uuid, attended int, no_shows int, cancelled int, games int, won int)
language plpgsql security definer set search_path = public stable as $$
begin
  if not is_play_host() then raise exception 'not allowed' using errcode = '42501'; end if;
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
    where (s.ended or s.session_date < current_date) and (p_since is null or s.session_date >= p_since)
    group by pa.member_id
  ) a on a.member_id = m.id
  left join (
    select x.m, count(*) games, count(*) filter (where x.pf > x.pa) won from play_sides(p_since) x group by x.m
  ) g on g.m = m.id;
end $$;

-- ---------- host: merge a duplicate into the right person ----------
create or replace function play_merge_members(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d_email text;
  d_user uuid;
begin
  if not is_play_host() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_keep = p_drop then return; end if;
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

-- ---------- players: link their sign-in to their record ----------
create or replace function play_link_me()
returns table (id uuid, name text, show_stats boolean, is_junior boolean, guardian_ok boolean)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update play_members m set user_id = auth.uid()
    where m.user_id is null and m.active and m.email is not null and m.email <> ''
      and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and not exists (select 1 from play_members x where x.user_id = auth.uid());
  return query
    select m.id, m.name, m.show_stats, m.is_junior, m.guardian_ok
    from play_members m where m.user_id = auth.uid() and m.active;
end $$;

create or replace function play_set_visibility(p_show boolean)
returns void language sql security definer set search_path = public as $$
  update play_members set show_stats = p_show where user_id = auth.uid() and active;
$$;

-- ---------- shared: every player's games, one row per player per game ----------
create or replace function play_sides(p_since date)
returns table (m uuid, partner uuid, pf int, pa int, session_id uuid, session_date date)
language sql security definer set search_path = public stable as $$
  with g as (
    select pg.*, s.session_date as sdate
    from play_games pg join play_sessions s on s.id = pg.session_id
    where (s.ended or s.session_date < current_date) and (p_since is null or s.session_date >= p_since)
  )
  select a1, a2, score_a, score_b, session_id, sdate from g where a1 is not null
  union all select a2, a1, score_a, score_b, session_id, sdate from g where a2 is not null
  union all select b1, b2, score_b, score_a, session_id, sdate from g where b1 is not null
  union all select b2, b1, score_b, score_a, session_id, sdate from g where b2 is not null;
$$;

-- ---------- players: my own numbers ----------
create or replace function play_my_stats(p_since date default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  me uuid;
  games_j jsonb;
  att_j jsonb;
  partners_j jsonb;
  recent_j jsonb;
begin
  select id into me from play_members where user_id = auth.uid() and active;
  if me is null then return null; end if;

  select jsonb_build_object(
    'games', count(*),
    'won', count(*) filter (where pf > pa),
    'lost', count(*) filter (where pf < pa),
    'drawn', count(*) filter (where pf = pa),
    'points_for', coalesce(sum(pf), 0),
    'points_against', coalesce(sum(pa), 0)
  ) into games_j from play_sides(p_since) where m = me;

  select jsonb_build_object(
    'attended', count(*) filter (where a.status in ('attended', 'walk_in')),
    'no_shows', count(*) filter (where a.status = 'no_show'),
    'cancelled', count(*) filter (where a.status = 'cancelled')
  ) into att_j
  from play_attendance a join play_sessions s on s.id = a.session_id
  where a.member_id = me and (s.ended or s.session_date < current_date) and (p_since is null or s.session_date >= p_since);

  select coalesce(jsonb_agg(t order by t.games desc, t.won desc), '[]'::jsonb) into partners_j from (
    select case when pm.show_stats and (not pm.is_junior or pm.guardian_ok) then pm.name else 'Another player' end as name,
      count(*) as games, count(*) filter (where x.pf > x.pa) as won
    from play_sides(p_since) x join play_members pm on pm.id = x.partner
    where x.m = me
    group by pm.id, pm.name, pm.show_stats, pm.is_junior, pm.guardian_ok
    order by count(*) desc, count(*) filter (where x.pf > x.pa) desc
    limit 3
  ) t;

  select coalesce(jsonb_agg(t order by t.date desc), '[]'::jsonb) into recent_j from (
    select x.session_date as date, s.name, count(*) as games, count(*) filter (where x.pf > x.pa) as won
    from play_sides(p_since) x join play_sessions s on s.id = x.session_id
    where x.m = me
    group by x.session_id, x.session_date, s.name
    order by x.session_date desc
    limit 8
  ) t;

  return jsonb_build_object('games', games_j, 'attendance', att_j, 'partners', partners_j, 'recent', recent_j);
end $$;

-- ---------- players: leaderboard (games only, never attendance) ----------
create or replace function play_leaderboard(p_since date default null, p_min_games int default 6)
returns table (name text, games int, won int, lost int, win_pct numeric, diff int, sessions int, is_me boolean)
language plpgsql security definer set search_path = public stable as $$
#variable_conflict use_column
declare
  me uuid;
  me_show boolean;
begin
  select m.id, m.show_stats into me, me_show from play_members m where m.user_id = auth.uid() and m.active;
  if me is null or not me_show then return; end if;
  return query
  with s as (
    select x.m as mid, count(*) as g, count(*) filter (where x.pf > x.pa) as w, count(*) filter (where x.pf < x.pa) as l,
      sum(x.pf - x.pa) as d, count(distinct x.session_id) as n
    from play_sides(p_since) x group by x.m
  )
  select pm.name, s.g::int, s.w::int, s.l::int, round(100.0 * s.w / s.g, 1), s.d::int, s.n::int, (pm.id = me)
  from s join play_members pm on pm.id = s.mid
  where pm.active and pm.show_stats and (not pm.is_junior or pm.guardian_ok) and s.g >= p_min_games
  order by round(100.0 * s.w / s.g, 1) desc, s.d desc, s.g desc, pm.name;
end $$;

-- ---------- who may call what ----------
revoke all on function play_publish_facts(uuid, jsonb, jsonb) from public, anon;
revoke all on function play_host_summary(date) from public, anon;
revoke all on function play_merge_members(uuid, uuid) from public, anon;
revoke all on function play_link_me() from public, anon;
revoke all on function play_set_visibility(boolean) from public, anon;
revoke all on function play_sides(date) from public, anon, authenticated;
revoke all on function play_my_stats(date) from public, anon;
revoke all on function play_leaderboard(date, int) from public, anon;
grant execute on function play_publish_facts(uuid, jsonb, jsonb) to authenticated;
grant execute on function play_host_summary(date) to authenticated;
grant execute on function play_merge_members(uuid, uuid) to authenticated;
grant execute on function play_link_me() to authenticated;
grant execute on function play_set_visibility(boolean) to authenticated;
grant execute on function play_my_stats(date) to authenticated;
grant execute on function play_leaderboard(date, int) to authenticated;

-- ---------- sign-in gate: is this email on a member record? (server use only) ----------
create or replace function play_email_known(p_email text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from play_members
    where active and email is not null and email <> '' and lower(email) = lower(trim(p_email))
  );
$$;
revoke all on function play_email_known(text) from public, anon, authenticated;
grant execute on function play_email_known(text) to service_role;
