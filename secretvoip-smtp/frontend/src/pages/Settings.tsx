import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import GlobalQuotaCard from '../components/GlobalQuotaCard';

interface S {
  site_name: string; tagline: string; support_telegram: string; maintenance_mode: boolean;
  global_quota_total?: number;
  worker_concurrency?: number;
  emails_per_second?: number;
  max_smtp_connections?: number;
  queue_batch_size?: number;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [s, setS] = useState<S | null>(null);
  const [quotaInput, setQuotaInput] = useState<string>('');
  const [perf, setPerf] = useState({
    worker_concurrency: 50,
    emails_per_second: 100,
    max_smtp_connections: 50,
    queue_batch_size: 500,
  });
  const [ok, setOk] = useState(false);
  const [perfOk, setPerfOk] = useState(false);

  async function load() {
    const r = await api<{ settings: S }>('/settings');
    setS(r.settings);
    setQuotaInput(String(r.settings.global_quota_total ?? 0));
    setPerf({
      worker_concurrency:   r.settings.worker_concurrency   ?? 50,
      emails_per_second:    r.settings.emails_per_second    ?? 100,
      max_smtp_connections: r.settings.max_smtp_connections ?? 50,
      queue_batch_size:     r.settings.queue_batch_size     ?? 500,
    });
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    await api('/settings', { method: 'PATCH', body: {
      site_name: s.site_name, tagline: s.tagline,
      support_telegram: s.support_telegram, maintenance_mode: s.maintenance_mode,
    }});
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

  async function savePerf(e: React.FormEvent) {
    e.preventDefault();
    await api('/settings', { method: 'PATCH', body: {
      worker_concurrency:   perf.worker_concurrency,
      emails_per_second:    perf.emails_per_second,
      max_smtp_connections: perf.max_smtp_connections,
      queue_batch_size:     perf.queue_batch_size,
    }});
    setPerfOk(true); setTimeout(() => setPerfOk(false), 2000);
    await load();
  }

  if (!s) return <div className="text-slate-400">Loading…</div>;
  const isAdmin = user?.role === 'admin';
  const num = (v: string, fb: number) => {
    const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : fb;
  };

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

      {isAdmin && (
        <form className="card space-y-4" onSubmit={savePerf}>
          <div className="font-semibold">Sending Performance</div>
          <p className="text-xs text-slate-500">
            Tune throughput. Concurrency applies live to the running worker; emails-per-second and
            max SMTP connections apply on the next worker restart. Batch size applies on the next campaign start.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Worker concurrency</label>
              <input type="number" min={1} max={2000} className="input"
                value={perf.worker_concurrency}
                onChange={e => setPerf({ ...perf, worker_concurrency: num(e.target.value, 50) })} />
              <p className="text-[11px] text-slate-500 mt-1">Parallel jobs the worker processes. Default 50.</p>
            </div>
            <div>
              <label className="label">Emails per second</label>
              <input type="number" min={1} max={10000} className="input"
                value={perf.emails_per_second}
                onChange={e => setPerf({ ...perf, emails_per_second: num(e.target.value, 100) })} />
              <p className="text-[11px] text-slate-500 mt-1">Queue rate cap. Default 100.</p>
            </div>
            <div>
              <label className="label">Max parallel SMTP connections</label>
              <input type="number" min={1} max={1000} className="input"
                value={perf.max_smtp_connections}
                onChange={e => setPerf({ ...perf, max_smtp_connections: num(e.target.value, 50) })} />
              <p className="text-[11px] text-slate-500 mt-1">Per SMTP server pool size. Default 50.</p>
            </div>
            <div>
              <label className="label">Batch size per queue insert</label>
              <input type="number" min={50} max={5000} className="input"
                value={perf.queue_batch_size}
                onChange={e => setPerf({ ...perf, queue_batch_size: num(e.target.value, 500) })} />
              <p className="text-[11px] text-slate-500 mt-1">Recipients queued per addBulk chunk. Default 500.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit">Save performance</button>
            {perfOk && <span className="text-sm text-emerald-300">Saved.</span>}
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
