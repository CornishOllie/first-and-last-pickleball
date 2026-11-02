import { useState } from 'preact/hooks';
import { verifyCode } from './auth.ts';

/** After the email is sent: type the 6-digit code, or tap the link in the email. */
export default function CodeEntry({ email, onDone, onRestart, known = true }: { email: string; onDone: () => void; onRestart: () => void; known?: boolean }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await verifyCode(email, code);
        setBusy(false);
        if (err) setMsg(err); else onDone();
      }}
    >
      <div class="note">
        {known ? 'We have emailed' : 'If that email is on the club list, we have emailed'} <strong>{email}</strong>. Type the 6-digit code from the email here, or tap the link in it. It can take a minute.
      </div>
      <div class="field">
        <label for="otp">Code</label>
        <input id="otp" type="text" class="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code}
          onInput={(e) => { setMsg(''); setCode((e.target as HTMLInputElement).value); }} />
      </div>
      {msg && <div class="error">{msg}</div>}
      <div class="row">
        <button class="b" disabled={busy || code.replace(/\D/g, '').length !== 6}>{busy ? 'Checking...' : 'Sign in'}</button>
        <button type="button" class="b ghost" onClick={onRestart}>Use a different email</button>
      </div>
    </form>
  );
}
