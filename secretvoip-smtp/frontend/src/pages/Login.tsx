import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    try {
      await login(u.trim(), p);
      nav('/dashboard');
    } catch (e: any) {
      setErr(e?.code === 'suspended' ? 'Account suspended.' : 'Invalid username or password.');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 shadow-glow">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-crimson-500 to-crimson-700 shadow-glow flex items-center justify-center font-bold">S</div>
          <div>
            <div className="font-bold">SecretVoIP SMTP</div>
            <div className="text-xs text-crimson-400 uppercase tracking-widest">Console Login</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Username</label>
            <input className="input" value={u} onChange={e => setU(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" value={p} onChange={e => setP(e.target.value)} required />
          </div>
          {err && <div className="text-sm text-crimson-400 bg-crimson-500/10 border border-crimson-500/30 rounded-lg p-2.5">{err}</div>}
          <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
