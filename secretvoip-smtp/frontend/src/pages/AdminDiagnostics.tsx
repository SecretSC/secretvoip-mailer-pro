import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Status = 'green' | 'yellow' | 'red';
interface Health { status: Status; message: string; detail?: any }
interface Diag {
  api: Health; database: Health; redis: Health; worker: Health; smtp: Health; ts: number;
}

const dot: Record<Status, string> = {
  green:  'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]',
  yellow: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]',
  red:    'bg-crimson-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]',
};
const label: Record<Status, string> = { green: 'Healthy', yellow: 'Warning', red: 'Offline' };

function Card({ name, h }: { name: string; h: Health }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-300">{name}</div>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-3 w-3 rounded-full ${dot[h.status]}`} />
          <span className="text-xs text-slate-400">{label[h.status]}</span>
        </div>
      </div>
      <div className="text-sm text-slate-200">{h.message}</div>
      {h.detail && (
        <pre className="text-[11px] text-slate-500 bg-ink-950 border border-white/5 rounded-lg p-2 overflow-auto max-h-32">
          {JSON.stringify(h.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AdminDiagnostics() {
  const [d, setD] = useState<Diag | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { const r = await api<Diag>('/diagnostics'); setD(r); setErr(null); }
    catch (e: any) { setErr(e?.message ?? 'Failed to load diagnostics'); }
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System Diagnostics</h1>
        <p className="text-sm text-slate-400">Live status of every component required to send mail. Refreshes every 5s.</p>
      </div>

      {err && <div className="card text-crimson-400 text-sm">{err}</div>}
      {!d ? <div className="text-slate-400">Loading…</div> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card name="API" h={d.api} />
          <Card name="Database" h={d.database} />
          <Card name="Redis" h={d.redis} />
          <Card name="Worker" h={d.worker} />
          <Card name="SMTP" h={d.smtp} />
        </div>
      )}

      <div className="text-xs text-slate-500">
        Green = healthy · Yellow = warning · Red = offline.
        If campaigns return "Worker unavailable" check the Worker and Redis cards here first.
      </div>
    </div>
  );
}
