import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import GlobalQuotaCard from '../components/GlobalQuotaCard';

interface S { site_name: string; tagline: string; support_telegram: string; maintenance_mode: boolean }

export default function SettingsPage() {
  const { user } = useAuth();
  const [s, setS] = useState<S | null>(null);
  const [quotaInput, setQuotaInput] = useState<string>('');
  const [ok, setOk] = useState(false);

  async function load() {
    const r = await api<{ settings: S & { global_quota_total: number } }>('/settings');
    setS(r.settings);
    setQuotaInput(String(r.settings.global_quota_total ?? 0));
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    await api('/settings', { method: 'PATCH', body: s });
    setOk(true); setTimeout(() => setOk(false), 2000);
  }

  async function saveQuota(e: React.FormEvent) {
    e.preventDefault();
    const total = Math.max(0, parseInt(quotaInput || '0', 10));
    await api('/settings/quota', { method: 'POST', body: { total } });
    await load();
  }
  async function resetQuota() {
    if (!confirm('Reset used counter back to zero?')) return;
    await api('/settings/quota/reset', { method: 'POST' });
    await load();
  }

  if (!s) return <div className="text-slate-400">Loading…</div>;
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Platform Settings</h1>
        <p className="text-sm text-slate-400">{isAdmin ? 'Changes apply across the platform immediately.' : 'View-only — only admins can change platform settings.'}</p>
      </div>

      <GlobalQuotaCard />

      {isAdmin && (
        <form className="card space-y-4" onSubmit={saveQuota}>
          <div className="font-semibold">Global SMTP Quota</div>
          <p className="text-xs text-slate-500">
            Total emails that can be sent across all clients combined. Set to <code>0</code> for unlimited.
            Increase, decrease, or reset at any time.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Total quota</label>
              <input type="number" min={0} className="input" value={quotaInput} onChange={e => setQuotaInput(e.target.value)} />
            </div>
            <button className="btn-primary" type="submit">Save quota</button>
            <button type="button" className="btn-ghost" onClick={resetQuota}>Reset used → 0</button>
          </div>
        </form>
      )}

      <form className="card space-y-4" onSubmit={save}>
        <div className="font-semibold">General</div>
        <div><label className="label">Site name</label><input className="input" disabled={!isAdmin} value={s.site_name} onChange={e => setS({ ...s, site_name: e.target.value })} /></div>
        <div><label className="label">Tagline</label><input className="input" disabled={!isAdmin} value={s.tagline} onChange={e => setS({ ...s, tagline: e.target.value })} /></div>
        <div><label className="label">Support Telegram</label><input className="input" disabled={!isAdmin} value={s.support_telegram} onChange={e => setS({ ...s, support_telegram: e.target.value })} placeholder="@secretvoip" /></div>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" disabled={!isAdmin} checked={s.maintenance_mode} onChange={e => setS({ ...s, maintenance_mode: e.target.checked })} />
          Maintenance mode
        </label>
        {isAdmin && <button className="btn-primary">Save settings</button>}
        {ok && <div className="text-sm text-emerald-300">Saved.</div>}
      </form>
    </div>
  );
}
