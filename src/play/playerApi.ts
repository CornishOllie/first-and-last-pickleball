// What a player can do: sign in by emailed link, see their own numbers and the leaderboard, and opt out.
// Everything goes through database functions that apply the privacy rules, never straight to the tables.
import { supabase } from './auth.ts';

export interface MyRecord { id: string; name: string; show_stats: boolean; is_junior: boolean; guardian_ok: boolean }
export interface MyStats {
  games: { games: number; won: number; lost: number; drawn: number; points_for: number; points_against: number };
  attendance: { attended: number; no_shows: number; cancelled: number };
  partners: { name: string; games: number; won: number }[];
  recent: { date: string; name: string; games: number; won: number }[];
}
export interface BoardRow { name: string; games: number; won: number; lost: number; win_pct: number; diff: number; sessions: number; is_me: boolean }

export const playerBackendOn = () => supabase !== null;

export async function sessionInfo(): Promise<{ email: string } | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const u = data.session?.user;
  return u ? { email: u.email ?? '' } : null;
}

/** Ask for a sign-in link. Always looks the same to the person, whether or not the email is on the club list. */
export async function requestLink(email: string): Promise<'sent' | 'too-many' | 'error'> {
  if (!supabase) return 'error';
  const clean = email.trim().toLowerCase();
  try {
    const res = await fetch('/api/player-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: clean }) });
    if (res.status === 429) return 'too-many';
    if (!res.ok) return 'error';
    // errors from here are ignored on purpose: an unknown email must look the same as a known one
    await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/me` } });
    return 'sent';
  } catch {
    return 'error';
  }
}

export async function linkMe(): Promise<MyRecord | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('play_link_me');
  if (error) throw error;
  return ((data as MyRecord[]) ?? [])[0] ?? null;
}

export async function myStats(since: string | null): Promise<MyStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('play_my_stats', { p_since: since });
  if (error) throw error;
  return (data as MyStats | null) ?? null;
}

export async function leaderboard(since: string | null): Promise<BoardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('play_leaderboard', { p_since: since, p_min_games: 6 });
  if (error) throw error;
  return (data as BoardRow[]) ?? [];
}

export async function setVisibility(show: boolean) {
  if (!supabase) return;
  const { error } = await supabase.rpc('play_set_visibility', { p_show: show });
  if (error) throw error;
}

export async function playerSignOut() {
  if (supabase) await supabase.auth.signOut();
}

/** YYYY-MM-DD for N days ago. */
export const daysAgo = (n: number, now = new Date()): string => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
