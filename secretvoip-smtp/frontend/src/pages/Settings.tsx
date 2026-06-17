import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface S { site_name: string; tagline: string; support_telegram: string; maintenance_mode: boolean }

export default function SettingsPage() {
  const { user } = useAuth();
  const [s, setS] = useState<S | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => { api<{ settings: S }>('/settings').then(r => setS(r.settings)); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    await api('/settings', { method: 'PATCH', body: s });
    setOk(true); setTimeout(() => setOk(false), 2000);
  }

  if (!s) return <div className="text-slate-400">Loading…</div>;
  const readOnly = user?.role !== 'admin';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Platform Settings</h1>
        <p className="text-sm text-slate-400">{readOnly ? 'View-only — only admins can change platform settings.' : 'Changes apply across the platform immediately.'}</p>
      </div>
      <form className="card space-y-4" onSubmit={save}>
        <div><label className="label">Site name</label><input className="input" disabled={readOnly} value={s.site_name} onChange={e => setS({ ...s, site_name: e.target.value })} /></div>
        <div><label className="label">Tagline</label><input className="input" disabled={readOnly} value={s.tagline} onChange={e => setS({ ...s, tagline: e.target.value })} /></div>
        <div><label className="label">Support Telegram</label><input className="input" disabled={readOnly} value={s.support_telegram} onChange={e => setS({ ...s, support_telegram: e.target.value })} placeholder="@secretvoip" /></div>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" disabled={readOnly} checked={s.maintenance_mode} onChange={e => setS({ ...s, maintenance_mode: e.target.checked })} />
          Maintenance mode
        </label>
        {!readOnly && <button className="btn-primary">Save settings</button>}
        {ok && <div className="text-sm text-emerald-300">Saved.</div>}
      </form>
    </div>
  );
}
