import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface C {
  id: string; name: string; subject: string; status: string;
  total: number; sent: number; delivered: number; failed: number; bounced: number; invalid: number;
  started_at?: string; completed_at?: string; created_at: string;
}
interface Breakdown { queued: number; processing: number; delivered: number; failed: number; bounced: number; invalid: number; delayed: number; cancelled: number }

const statusBadge: Record<string, string> = {
  draft: 'badge-muted', queued: 'badge-warn', processing: 'badge-warn',
  paused: 'badge-warn', completed: 'badge-ok', cancelled: 'badge-err', failed: 'badge-err',
};

function Stat({ label, value, tone = '' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function CampaignDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<C | null>(null);
  const [b, setB] = useState<Breakdown | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    try {
      const r = await api<{ campaign: C; breakdown: Breakdown }>(`/campaigns/${id}`);
      setC(r.campaign); setB(r.breakdown);
    } catch {}
  }
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, [id]);

  async function action(name: 'start' | 'pause' | 'resume' | 'cancel') {
    if (!id) return;
    setBusy(true);
    try { await api(`/campaigns/${id}/${name}`, { method: 'POST' }); await load(); }
    finally { setBusy(false); }
  }

  if (!c || !b) return <div className="text-slate-400">Loading…</div>;
  const processed = c.delivered + c.failed + c.bounced + c.invalid;
  const pct = c.total ? Math.round((processed / c.total) * 100) : 0;

  const canStart = ['draft', 'paused'].includes(c.status);
  const canPause = ['queued', 'processing'].includes(c.status);
  const canCancel = ['draft', 'queued', 'processing', 'paused'].includes(c.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/campaigns" className="text-xs text-slate-400 hover:text-white">← back to campaigns</Link>
          <h1 className="text-2xl font-semibold mt-1">{c.name}</h1>
          <div className="text-sm text-slate-400">{c.subject}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={statusBadge[c.status] ?? 'badge-muted'}>{c.status}</span>
          <Link to={`/campaigns/${c.id}/edit`} className="btn-ghost">Edit</Link>
          {canStart && <button className="btn-primary" disabled={busy} onClick={() => action('start')}>{c.status === 'paused' ? 'Resume' : 'Start'}</button>}
          {canPause && <button className="btn-ghost" disabled={busy} onClick={() => action('pause')}>Pause</button>}
          {c.status === 'paused' && <button className="btn-primary" disabled={busy} onClick={() => action('resume')}>Resume</button>}
          {canCancel && <button className="btn-danger" disabled={busy} onClick={() => action('cancel')}>Cancel</button>}
          {!canCancel && <button className="btn-danger" disabled={busy} onClick={async () => { await api(`/campaigns/${id}`, { method: 'DELETE' }); nav('/campaigns'); }}>Delete</button>}
        </div>
      </div>

      <div className="card">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-slate-400">Progress</span>
          <span className="text-slate-200 font-medium">{processed.toLocaleString()} / {c.total.toLocaleString()} ({pct}%)</span>
        </div>
        <div className="mt-3 h-3 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-crimson-500 to-crimson-700 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label="Total" value={c.total} />
        <Stat label="Queued" value={b.queued} tone="text-amber-300" />
        <Stat label="Processing" value={b.processing} tone="text-amber-300" />
        <Stat label="Delivered" value={c.delivered} tone="text-emerald-300" />
        <Stat label="Failed" value={c.failed} tone="text-crimson-400" />
        <Stat label="Bounced" value={c.bounced} tone="text-crimson-400" />
        <Stat label="Invalid" value={c.invalid} tone="text-crimson-400" />
        <Stat label="Delayed" value={b.delayed} tone="text-amber-300" />
      </div>

      <div className="card text-xs text-slate-400">
        <div>Created {new Date(c.created_at).toLocaleString()}</div>
        {c.started_at && <div>Started {new Date(c.started_at).toLocaleString()}</div>}
        {c.completed_at && <div>Completed {new Date(c.completed_at).toLocaleString()}</div>}
      </div>
    </div>
  );
}
