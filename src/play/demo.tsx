// Demo mode: only in the committee preview build (PUBLIC_DEMO_MODE=on). Lets someone tap "Try as Sam" instead
// of typing an email. The server only knows four made-up demo.invalid accounts and sends no email.
// In a normal build DEMO_ON is false, so every piece below renders nothing.
import { useState } from 'preact/hooks';
import { supabase, signOut } from './auth.ts';

export const DEMO_ON = import.meta.env.PUBLIC_DEMO_MODE === 'on';
export type DemoWho = 'host' | 'sam' | 'kit' | 'jo';

async function demoSignIn(who: DemoWho): Promise<string | null> {
  if (!supabase) return 'Sign-in is not set up.';
  try {
    const res = await fetch('/api/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ who }) });
    if (res.status === 429) return 'Too many tries. Wait a few minutes.';
    if (!res.ok) return 'Demo sign-in is not available.';
    const { token_hash } = await res.json();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
    return error ? 'Demo sign-in failed. Try again.' : null;
  } catch {
    return 'Demo sign-in failed. Try again.';
  }
}

export function DemoBanner() {
  if (!DEMO_ON) return null;
  return <div class="note" role="status" id="demo-banner" style="margin-bottom:1rem;font-weight:600">Demo with made-up people. Nothing here is real.</div>;
}

export function DemoCard({ people }: { people: { who: DemoWho; label: string; hint: string }[] }) {
  const [busy, setBusy] = useState<DemoWho | null>(null);
  const [msg, setMsg] = useState('');
  if (!DEMO_ON) return null;
  return (
    <div class="card" id="demo-card">
      <h2>Demo</h2>
      <p class="muted">No email needed. Tap a made-up person to try the app as them.</p>
      {people.map((p) => (
        <div key={p.who} style="margin:.5rem 0">
          <button class="b" style="width:100%" disabled={busy !== null} onClick={async () => {
            setBusy(p.who);
            const err = await demoSignIn(p.who);
            if (err) { setMsg(err); setBusy(null); } else location.reload();
          }}>{busy === p.who ? 'Signing in...' : p.label}</button>
          <div class="muted small">{p.hint}</div>
        </div>
      ))}
      {msg && <div class="error">{msg}</div>}
    </div>
  );
}

export function SwitchPerson() {
  if (!DEMO_ON) return null;
  return <button class="b small ghost" id="switch-person" onClick={() => signOut().then(() => location.reload())}>Switch person</button>;
}

export const PLAYER_DEMO = [
  { who: 'sam' as const, label: 'Try as Sam', hint: 'Plays at two clubs, so you see the club switcher.' },
  { who: 'kit' as const, label: 'Try as Kit', hint: 'Has switched stats off, so no leaderboard.' },
  { who: 'jo' as const, label: 'Try as Jo', hint: 'Under 18, so the parent note shows.' },
];
export const HOST_DEMO = [{ who: 'host' as const, label: 'Try as the host', hint: 'Run a night: players, draw, scores, big screen.' }];
