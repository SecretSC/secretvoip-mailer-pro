import { useState } from 'react';
import { api, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Profile() {
  const { user, refresh } = useAuth();
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (n1.length < 8) return setMsg('Password must be at least 8 characters.');
    if (n1 !== n2) return setMsg('Passwords do not match.');
    setBusy(true);
    try {
      const r = await api<{ token: string }>('/auth/change-password', { method: 'POST', body: { current_password: cur, new_password: n1 } });
      setToken(r.token); await refresh();
      setMsg('Password updated.'); setCur(''); setN1(''); setN2('');
    } catch (e: any) {
      setMsg(e?.code === 'invalid_credentials' ? 'Current password is wrong.' : 'Failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="card">
        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div><div className="text-slate-500 text-xs uppercase tracking-wider">Username</div><div className="font-medium">{user?.username}</div></div>
          <div><div className="text-slate-500 text-xs uppercase tracking-wider">Role</div><div className="font-medium capitalize">{user?.role}</div></div>
          <div><div className="text-slate-500 text-xs uppercase tracking-wider">Daily limit</div><div className="font-medium">{user?.daily_limit.toLocaleString()}</div></div>
        </div>
      </div>
      <form className="card space-y-3" onSubmit={submit}>
        <div className="font-semibold">Change password</div>
        <div><label className="label">Current password</label><input type="password" className="input" value={cur} onChange={e => setCur(e.target.value)} required /></div>
        <div><label className="label">New password</label><input type="password" className="input" value={n1} onChange={e => setN1(e.target.value)} required /></div>
        <div><label className="label">Confirm new password</label><input type="password" className="input" value={n2} onChange={e => setN2(e.target.value)} required /></div>
        {msg && <div className="text-sm text-slate-300">{msg}</div>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </div>
  );
}
