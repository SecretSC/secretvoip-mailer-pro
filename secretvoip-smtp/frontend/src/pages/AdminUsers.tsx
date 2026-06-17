import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface U { id: string; username: string; role: string; status: string; daily_limit: number; monthly_limit: number; balance: number; notes?: string; created_at: string }

export default function AdminUsers() {
  const [users, setUsers] = useState<U[]>([]);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', daily_limit: 5000, monthly_limit: 100000, balance: 0, notes: '' });
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);

  async function load() { const r = await api<{ users: U[] }>('/users', { query: { search } }); setUsers(r.users); }
  useEffect(() => { load(); }, [search]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await api<{ id: string; username: string; password: string }>('/users', { method: 'POST', body: { ...form, notes: form.notes || undefined } });
    setCreated({ username: r.username, password: r.password });
    setForm({ username: '', password: '', daily_limit: 5000, monthly_limit: 100000, balance: 0, notes: '' });
    setCreating(false); await load();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">User Management</h1>
          <p className="text-sm text-slate-400">Create clients, set quotas and manage access.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>＋ New client</button>
      </div>

      <input className="input max-w-md" placeholder="Search by username…" value={search} onChange={e => setSearch(e.target.value)} />

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-4 py-3">Username</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Daily</th>
              <th className="text-right px-4 py-3">Monthly</th>
              <th className="text-right px-4 py-3">Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-2 font-medium">{u.username}</td>
                <td className="px-4 py-2 capitalize text-slate-300">{u.role}</td>
                <td className="px-4 py-2"><span className={u.status === 'active' ? 'badge-ok' : 'badge-err'}>{u.status}</span></td>
                <td className="px-4 py-2 text-right">{u.daily_limit.toLocaleString()}</td>
                <td className="px-4 py-2 text-right">{u.monthly_limit.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-xs text-slate-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                  <button className="text-xs text-slate-300 hover:text-white" onClick={() => reset(u.id)}>reset pw</button>
                  {u.role !== 'admin' && <button className="text-xs text-slate-300 hover:text-amber-300" onClick={() => toggle(u)}>{u.status === 'active' ? 'suspend' : 'activate'}</button>}
                  {u.role !== 'admin' && <button className="text-xs text-crimson-400 hover:text-crimson-300" onClick={() => remove(u.id)}>delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setCreating(false)}>
          <form className="card max-w-md w-full space-y-3" onSubmit={create} onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-lg">Create client</div>
            <div><label className="label">Username</label><input className="input" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
            <div><label className="label">Password</label><input className="input" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Daily limit</label><input type="number" className="input" value={form.daily_limit} onChange={e => setForm({ ...form, daily_limit: Number(e.target.value) })} /></div>
              <div><label className="label">Monthly limit</label><input type="number" className="input" value={form.monthly_limit} onChange={e => setForm({ ...form, monthly_limit: Number(e.target.value) })} /></div>
            </div>
            <div><label className="label">Starting balance</label><input type="number" className="input" value={form.balance} onChange={e => setForm({ ...form, balance: Number(e.target.value) })} /></div>
            <div><label className="label">Notes</label><textarea className="input h-20" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
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
            <pre className="bg-ink-950 border border-white/10 rounded-lg p-3 text-sm">Username: {created.username}{'\n'}Password: {created.password}</pre>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(`Username: ${created.username}\nPassword: ${created.password}`)}>Copy</button>
              <button className="btn-primary" onClick={() => setCreated(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
