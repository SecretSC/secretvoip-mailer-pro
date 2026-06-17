import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function ForcePassword() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (n1.length < 8) return setErr('New password must be at least 8 characters.');
    if (n1 !== n2) return setErr('Passwords do not match.');
    setLoading(true);
    try {
      const r = await api<{ token: string }>('/auth/change-password', {
        method: 'POST', body: { current_password: cur, new_password: n1 },
      });
      setToken(r.token);
      await refresh();
      nav('/dashboard');
    } catch (e: any) {
      setErr(e?.code === 'invalid_credentials' ? 'Current password is incorrect.' : 'Could not change password.');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-xl font-semibold mb-1">Change your password</h1>
        <p className="text-sm text-slate-400 mb-6">For security, you must set a new password before continuing.</p>
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label">Current password</label><input type="password" className="input" value={cur} onChange={e => setCur(e.target.value)} required /></div>
          <div><label className="label">New password</label><input type="password" className="input" value={n1} onChange={e => setN1(e.target.value)} required /></div>
          <div><label className="label">Confirm new password</label><input type="password" className="input" value={n2} onChange={e => setN2(e.target.value)} required /></div>
          {err && <div className="text-sm text-crimson-400">{err}</div>}
          <button className="btn-primary w-full" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button>
        </form>
      </div>
    </div>
  );
}
