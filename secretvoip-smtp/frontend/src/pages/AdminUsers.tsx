import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface U {
  id: string; username: string; role: string; status: string;
  notes?: string; created_at: string;
  quota_total?: number; quota_used?: number; quota_remaining?: number;
}
interface Quota {
  total: number; used: number; remaining: number;
  active: boolean; exhausted: boolean; updated_at: string | null;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<U[]>([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', initial_quota: '' });
  const [created, setCreated] = useState<{ username: string; password: string; quota_total?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quotaUser, setQuotaUser] = useState<U | null>(null);

  async function load() { const r = await api<{ users: U[] }>('/users', { query: { search } }); setUsers(r.users); }
  useEffect(() => { load(); }, [search]);

  function resetForm() { setForm({ username: '', password: '', initial_quota: '' }); setErr(null); }

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      const body: any = { username: form.username, password: form.password };
      const iq = form.initial_quota.trim();
      if (iq !== '') {
        const n = parseInt(iq, 10);
        if (!Number.isFinite(n) || n < 0) { setErr('Initial quota must be a non-negative number.'); return; }
        body.initial_quota = n;
      }
      const r = await api<{ id: string; username: string; password: string; quota_total?: number }>(
        '/users', { method: 'POST', body }
      );
      setCreated({ username: r.username, password: r.password, quota_total: r.quota_total });
      resetForm(); setCreating(false); await load();
    } catch (e: any) {
      setErr(e?.message === 'username_taken' ? 'That username is already taken.' : (e?.message ?? 'Create failed'));
    }
  }

  async function reset(id: string) {
    const r = await api<{ password: string }>(`/users/${id}/reset-password`, { method: 'POST', body: {} });
    alert(`New temporary password: ${r.password}\nUser must change it at next login.`);
  }
  async function toggle(u: U) {
    await api(`/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } });
    await load();
  }
  async function remove(id: string) {
    if (!confirm('Delete this user and all their data?')) return;
    await api(`/users/${id}`, { method: 'DELETE' }); await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">User Management</h1>
          <p className="text-sm text-slate-400">Each client has an independent sending quota. Use <strong>Manage Quota</strong> to set, add, or reset it.</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setCreating(true); }}>＋ New client</button>
      </div>

      <input className="input max-w-md" placeholder="Search by username…" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-4 py-3">Username</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Quota</th>
              <th className="text-right px-4 py-3">Used</th>
              <th className="text-right px-4 py-3">Remaining</th>
              <th className="text-right px-4 py-3">Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map(u => {
              const total = Number(u.quota_total ?? 0);
              const used = Number(u.quota_used ?? 0);
              const remaining = Number(u.quota_remaining ?? (total > 0 ? Math.max(0, total - used) : 0));
              return (
                <tr key={u.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2 font-medium">
                    {u.role === 'client'
                      ? <Link to={`/admin/users/${u.id}`} className="hover:text-crimson-300">{u.username}</Link>
                      : u.username}
                  </td>
                  <td className="px-4 py-2 capitalize text-slate-300">{u.role}</td>
                  <td className="px-4 py-2"><span className={u.status === 'active' ? 'badge-ok' : 'badge-err'}>{u.status}</span></td>
                  <td className="px-4 py-2 text-right">{total > 0 ? total.toLocaleString() : <span className="text-slate-500">—</span>}</td>
                  <td className="px-4 py-2 text-right">{used.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    {total > 0
                      ? <span className={remaining === 0 ? 'text-crimson-400' : 'text-emerald-300'}>{remaining.toLocaleString()}</span>
                      : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                    {u.role !== 'admin' && <button className="text-xs text-crimson-300 hover:text-crimson-200" onClick={() => setQuotaUser(u)}>manage quota</button>}
                    <button className="text-xs text-slate-300 hover:text-white" onClick={() => reset(u.id)}>reset pw</button>
                    {u.role !== 'admin' && <button className="text-xs text-slate-300 hover:text-amber-300" onClick={() => toggle(u)}>{u.status === 'active' ? 'suspend' : 'activate'}</button>}
                    {u.role !== 'admin' && <button className="text-xs text-crimson-400 hover:text-crimson-300" onClick={() => remove(u.id)}>delete</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreating(false)}>
          <form className="card max-w-md w-full space-y-3" onSubmit={create} onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-lg">Create client</div>
            <div><label className="label">Username</label>
              <input className="input" required minLength={3} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
            <div><label className="label">Password</label>
              <input className="input" required minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div><label className="label">Initial Quota (optional)</label>
              <input className="input" type="number" min={0} placeholder="e.g. 20000"
                value={form.initial_quota} onChange={e => setForm({ ...form, initial_quota: e.target.value })} />
              <p className="text-xs text-slate-500 mt-1">Number of accepted emails the client may send. Leave empty for 0 (sending disabled until you set a quota).</p>
            </div>
            {err && <div className="text-crimson-400 text-sm">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary">Create</button>
            </div>
          </form>
        </div>
      )}

      {created && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreated(null)}>
          <div className="card max-w-md w-full space-y-3" onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-lg">Client created</div>
            <p className="text-sm text-slate-400">Credentials are shown once — copy them now.</p>
            <pre className="bg-ink-950 border border-white/10 rounded-lg p-3 text-sm">
              Username: {created.username}{'\n'}Password: {created.password}{'\n'}Quota: {(created.quota_total ?? 0).toLocaleString()}
            </pre>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(`Username: ${created.username}\nPassword: ${created.password}`)}>Copy</button>
              <button className="btn-primary" onClick={() => setCreated(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {quotaUser && (
        <ManageQuotaModal user={quotaUser} onClose={() => { setQuotaUser(null); load(); }} />
      )}
    </div>
  );
}

function ManageQuotaModal({ user, onClose }: { user: U; onClose: () => void }) {
  const [q, setQ] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [setTotal, setSetTotal] = useState('');
  const [addVal, setAddVal] = useState('');
  const [setUsed, setSetUsed] = useState('');

  async function load() {
    try { const r = await api<{ quota: Quota }>(`/users/${user.id}/quota`); setQ(r.quota); }
    catch (e: any) { setErr(e?.message ?? 'Failed to load quota'); }
  }
  useEffect(() => { load(); }, [user.id]);

  async function act(action: string, value?: number) {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ quota: Quota }>(`/users/${user.id}/quota`, { method: 'POST', body: { action, value } });
      setQ(r.quota);
      setSetTotal(''); setAddVal(''); setSetUsed('');
    } catch (e: any) {
      setErr(e?.message ?? 'Update failed');
    } finally { setBusy(false); }
  }

  function num(s: string): number | null {
    const t = s.trim(); if (t === '') return null;
    const n = parseInt(t, 10);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card max-w-lg w-full space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Manage Quota</div>
          <div className="text-lg font-semibold">{user.username}</div>
        </div>
        {!q ? <div className="text-slate-400 text-sm">Loading…</div> : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Total</div>
                <div className="text-lg font-semibold">{q.total.toLocaleString()}</div>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Used</div>
                <div className="text-lg font-semibold">{q.used.toLocaleString()}</div>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Remaining</div>
                <div className={`text-lg font-semibold ${q.exhausted ? 'text-crimson-400' : 'text-emerald-300'}`}>
                  {q.remaining.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="label">Set total quota</label>
                  <input className="input" type="number" min={0} placeholder="e.g. 20000" value={setTotal} onChange={e => setSetTotal(e.target.value)} />
                </div>
                <button className="btn-primary" disabled={busy || num(setTotal) === null}
                  onClick={() => act('set_total', num(setTotal)!)}>Set</button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="label">Add quota</label>
                  <input className="input" type="number" min={1} placeholder="e.g. 5000" value={addVal} onChange={e => setAddVal(e.target.value)} />
                </div>
                <button className="btn-ghost" disabled={busy || !num(addVal) || num(addVal)! <= 0}
                  onClick={() => act('add', num(addVal)!)}>Add</button>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="label">Set used to</label>
                  <input className="input" type="number" min={0} placeholder="e.g. 0" value={setUsed} onChange={e => setSetUsed(e.target.value)} />
                </div>
                <button className="btn-ghost" disabled={busy || num(setUsed) === null}
                  onClick={() => act('set_used', num(setUsed)!)}>Apply</button>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                <button className="btn-ghost text-xs" disabled={busy} onClick={() => act('reset_used')}>Reset used to 0</button>
                <button className="btn-ghost text-xs text-crimson-300" disabled={busy} onClick={() => act('set_total', 0)}>Disable sending (set total = 0)</button>
              </div>
            </div>
          </>
        )}
        {err && <div className="text-crimson-400 text-sm">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
