import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface C {
  id: string; name: string; subject: string; status: string;
  total: number; sent: number; accepted: number; delivered: number;
  failed: number; bounced: number; invalid: number;
  started_at?: string; completed_at?: string; created_at: string;
  from_name?: string | null;
}
interface Breakdown {
  queued: number; processing: number; delivered: number; accepted: number;
  failed: number; bounced: number; invalid: number; delayed: number; cancelled: number;
}

const statusBadge: Record<string, string> = {
  draft: 'badge-muted', queued: 'badge-warn', processing: 'badge-warn',
  paused: 'badge-warn', completed: 'badge-ok', cancelled: 'badge-err', failed: 'badge-err',
};

function Counter({ label, value, tone = 'text-slate-200' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString()}</div>
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
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [id]);

  async function action(name: 'start' | 'pause' | 'resume' | 'stop') {
    if (!id) return;
    if (name === 'stop' && !confirm('Stop this campaign? In-flight recipients will be cancelled.')) return;
    setBusy(true);
    try { await api(`/campaigns/${id}/${name}`, { method: 'POST' }); await load(); }
    catch (e: any) { alert(e?.message ?? 'Action failed'); }
    finally { setBusy(false); }
  }

  if (!c || !b) return <div className="text-slate-400">Loading…</div>;
  const accepted = c.accepted ?? c.delivered ?? 0;
  const processed = accepted + c.failed + c.bounced + c.invalid;
  const pct = c.total ? Math.min(100, Math.round((processed / c.total) * 100)) : 0;

  const canStart = ['draft', 'paused'].includes(c.status);
  const canPause = ['queued', 'processing'].includes(c.status);
  const canStop  = ['draft', 'queued', 'processing', 'paused'].includes(c.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link to="/campaigns" className="text-xs text-slate-400 hover:text-white">← back to campaigns</Link>
          <h1 className="text-2xl font-semibold mt-1 truncate">{c.name}</h1>
          <div className="text-sm text-slate-400 truncate">{c.subject}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={statusBadge[c.status] ?? 'badge-muted'}>{c.status}</span>
          <Link to={`/campaigns/${c.id}/edit`} className="btn-ghost">Edit</Link>
          {canStart && c.status === 'draft' && <button className="btn-primary" disabled={busy} onClick={() => action('start')}>Start</button>}
          {c.status === 'paused' && <button className="btn-primary" disabled={busy} onClick={() => action('resume')}>Resume</button>}
          {canPause && <button className="btn-ghost" disabled={busy} onClick={() => action('pause')}>Pause</button>}
          {canStop && <button className="btn-danger" disabled={busy} onClick={() => action('stop')}>Stop</button>}
          {!canStop && <button className="btn-danger" disabled={busy} onClick={async () => { await api(`/campaigns/${id}`, { method: 'DELETE' }); nav('/campaigns'); }}>Delete</button>}
        </div>
      </div>

      <div className="card">
        <div className="flex items-baseline justify-between text-sm mb-3">
          <span className="text-slate-400">Progress</span>
          <span className="text-3xl font-bold tabular-nums text-white">{pct}%</span>
        </div>
        <div className="h-6 rounded-full bg-white/5 overflow-hidden border border-white/10">
          <div className="h-full bg-gradient-to-r from-crimson-500 to-crimson-700 transition-all duration-500 shadow-glow"
               style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-slate-500 mt-2 text-right tabular-nums">
          {processed.toLocaleString()} processed of {c.total.toLocaleString()}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Counter label="Total" value={c.total} />
        <Counter label="Accepted" value={accepted} tone="text-emerald-300" />
        <Counter label="Failed" value={c.failed + c.bounced} tone="text-crimson-400" />
        <Counter label="Queued" value={b.queued} tone="text-amber-300" />
        <Counter label="Processing" value={b.processing} tone="text-amber-300" />
        <Counter label="Cancelled" value={b.cancelled} tone="text-slate-400" />
      </div>

      <div className="card text-xs text-slate-400 space-y-1">
        <div>Created {new Date(c.created_at).toLocaleString()}</div>
        {c.started_at && <div>Started {new Date(c.started_at).toLocaleString()}</div>}
        {c.completed_at && <div>Completed {new Date(c.completed_at).toLocaleString()}</div>}
        <div className="text-slate-500 pt-2">
          Note: "Accepted" means the recipient SMTP server accepted the message. Actual inbox delivery
          can only be confirmed by future provider webhooks.
        </div>
      </div>
    </div>
  );
}
