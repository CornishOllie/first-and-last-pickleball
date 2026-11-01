import { useEffect, useMemo, useState } from 'preact/hooks';
import { cloud } from './backend.ts';
import type { MemberRecord, MemberSummary } from './backend.ts';
import { parseMemberLines } from './engine.ts';
import type { Gender } from './engine.ts';

type Filter = 'all' | 'noemail' | 'juniors' | 'optedout';

const niceError = (e: unknown): string => {
  const m = (e as { message?: string; code?: string }) ?? {};
  if (m.code === '23505' || /duplicate key|unique/i.test(m.message ?? '')) return 'That email or name is already used by another member.';
  return m.message ?? 'Something went wrong.';
};

export default function Members() {
  const [rows, setRows] = useState<MemberRecord[]>([]);
  const [sum, setSum] = useState<Record<string, MemberSummary>>({});
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [bulk, setBulk] = useState('');
  const [loading, setLoading] = useState(true);
  // bumped after a failed save so every box goes back to what is really stored
  const [ver, setVer] = useState(0);

  const load = async (keepError = false) => {
    try {
      const [r, s] = await Promise.all([cloud.memberRecords(), cloud.memberSummary()]);
      setRows(r);
      setSum(Object.fromEntries(s.map((x) => [x.member_id, x])));
      if (!keepError) setErr('');
    } catch (e) {
      setErr(niceError(e));
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const save = async (id: string, patch: Parameters<typeof cloud.updateMember>[1]) => {
    setMsg('');
    try {
      await cloud.updateMember(id, patch);
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch, email: 'email' in patch ? String(patch.email ?? '').trim() : r.email } : r)));
      setErr('');
    } catch (e) {
      setErr(niceError(e));
      setVer((v) => v + 1);
      void load(true);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !r.name.toLowerCase().includes(needle) && !r.email.toLowerCase().includes(needle)) return false;
      if (filter === 'noemail') return !r.email;
      if (filter === 'juniors') return r.is_junior;
      if (filter === 'optedout') return !r.show_stats;
      return true;
    });
  }, [rows, q, filter]);

  const parsed = parseMemberLines(bulk);

  return (
    <div>
      <h2>Members</h2>
      <p class="muted">Everyone the club has played with. Add an email so a player can sign in and see their own stats. Only hosts can see this list.</p>
      {err && <div class="error">{err}</div>}
      {msg && <div class="note">{msg}</div>}

      <details class="card">
        <summary style="cursor:pointer;font-weight:600">Add many (paste names and emails)</summary>
        <div class="field" style="margin-top:.6rem">
          <textarea placeholder={'One per line:\nAnn Smith, ann@example.com\nBob Jones, bob@example.com'} value={bulk} onInput={(e) => setBulk((e.target as HTMLTextAreaElement).value)} />
        </div>
        <button class="b small" disabled={!parsed.length} onClick={async () => {
          try {
            const r = await cloud.addMembers(parsed);
            setMsg(`Added ${r.added} new and updated ${r.updated} existing.`);
            setBulk('');
            await load();
          } catch (e) { setErr(niceError(e)); }
        }}>
          Add {parsed.length || ''} {parsed.length === 1 ? 'person' : 'people'}
        </button>
      </details>

      <div class="row" style="margin:.8rem 0">
        <input type="text" placeholder="Search name or email" aria-label="Search members" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style="flex:1;min-width:10rem" />
        <select aria-label="Filter members" value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as Filter)}>
          <option value="all">Everyone ({rows.length})</option>
          <option value="noemail">No email yet ({rows.filter((r) => !r.email).length})</option>
          <option value="juniors">Under 18 ({rows.filter((r) => r.is_junior).length})</option>
          <option value="optedout">Stats switched off ({rows.filter((r) => !r.show_stats).length})</option>
        </select>
      </div>

      {loading && <p class="muted">Loading...</p>}
      {!loading && shown.length === 0 && <p class="muted">Nobody here yet. Members are added automatically when you save a session, or paste a list above.</p>}

      {shown.map((r) => {
        const t = sum[r.id];
        return (
          <div class="card mem" key={`${r.id}:${ver}`}>
            <div class="fields">
              <div><label for={`n-${r.id}`}>Name</label>
                <input id={`n-${r.id}`} type="text" defaultValue={r.name} onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v && v !== r.name) void save(r.id, { name: v }); }} /></div>
              <div><label for={`e-${r.id}`}>Email {r.linked && <span class="chip">signed in</span>}</label>
                <input id={`e-${r.id}`} type="email" defaultValue={r.email} placeholder="Add so they can see their stats" onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (v !== r.email) void save(r.id, { email: v }); }} /></div>
            </div>
            <div class="flags">
              <label class="check"><input type="checkbox" checked={r.is_junior} onChange={(e) => void save(r.id, { is_junior: (e.target as HTMLInputElement).checked, ...(!(e.target as HTMLInputElement).checked ? { guardian_ok: false } : {}) })} /><span>Under 18</span></label>
              {r.is_junior && (
                <label class="check"><input type="checkbox" checked={r.guardian_ok} onChange={(e) => void save(r.id, { guardian_ok: (e.target as HTMLInputElement).checked })} /><span>Parent or guardian says yes to the leaderboard</span></label>
              )}
              <label class="check"><input type="checkbox" checked={r.show_stats} onChange={(e) => void save(r.id, { show_stats: (e.target as HTMLInputElement).checked })} /><span>Stats on</span></label>
              <select aria-label={`Gender for ${r.name}`} value={r.gender} onChange={(e) => void save(r.id, { gender: (e.target as HTMLSelectElement).value as Gender })}>
                <option value="">M/F?</option><option value="M">M</option><option value="F">F</option>
              </select>
            </div>
            {t && (
              <p class="muted" style="margin:.4rem 0 0">
                Turned up {t.attended}, no-shows {t.no_shows}, cancelled {t.cancelled}, games {t.games} ({t.won} won). Only hosts see turnout.
              </p>
            )}
            <div class="row" style="margin-top:.6rem">
              <select aria-label={`Merge ${r.name} into`} value="" onChange={async (e) => {
                const keep = (e.target as HTMLSelectElement).value;
                const target = rows.find((x) => x.id === keep);
                (e.target as HTMLSelectElement).value = '';
                if (!target || !confirm(`Merge "${r.name}" into "${target.name}"? Their games and attendance move across, and "${r.name}" is removed.`)) return;
                try { await cloud.mergeMembers(keep, r.id); setMsg(`Merged ${r.name} into ${target.name}.`); await load(); } catch (er) { setErr(niceError(er)); }
              }}>
                <option value="">This is a duplicate of...</option>
                {rows.filter((x) => x.id !== r.id).map((x) => <option value={x.id}>{x.name}</option>)}
              </select>
              <button class="b small danger" onClick={async () => {
                if (!confirm(`Erase ${r.name}? Their attendance and ratings are deleted. Games they played stay for other players, without their name.`)) return;
                try { await cloud.deleteMember(r.id); setMsg(`Erased ${r.name}.`); await load(); } catch (er) { setErr(niceError(er)); }
              }}>Erase</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
