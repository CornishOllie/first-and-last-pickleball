// Optional cloud sign-in for hosts (Supabase email links). Only active when PUBLIC_PLAY_CLOUD=on.
// Without it the tool runs on this device only.
import { createClient } from '@supabase/supabase-js';
import { CLUB } from '../club.ts';

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
// Cloud sign-in is optional and off by default. The tool normally runs on the device behind the door code.
const cloudOn = import.meta.env.PUBLIC_PLAY_CLOUD === 'on';

export const supabase =
  cloudOn && url && key
    ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

export interface HostInfo {
  email: string;
}

/** The signed-in host, or null if signed out, or { notHost: true } if signed in but not allowed. */
export async function currentHost(): Promise<HostInfo | 'not-host' | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  // A host or admin of this site's club. Being a host at another club does not count here.
  const { data: rows, error } = await supabase.from('club_roles').select('role').eq('club_id', CLUB.id).eq('user_id', user.id);
  if (error || !rows || rows.length === 0) return 'not-host';
  return { email: user.email ?? '' };
}

export async function sendLoginLink(email: string): Promise<string | null> {
  if (!supabase) return 'Sign-in is not set up yet.';
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/host` },
  });
  return error ? error.message : null;
}

/** Sign in with the 6-digit code from the email. Needed on iPhone when the site is installed on the
 *  Home Screen: a tapped link opens Safari, which has separate storage, so the installed app stays signed out. */
export async function verifyCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'Sign-in is not set up yet.';
  const token = code.replace(/\D/g, '');
  if (token.length !== 6) return 'The code is 6 digits.';
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
  return error ? 'That code is not right, or it has expired. Ask for a new one.' : null;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}
