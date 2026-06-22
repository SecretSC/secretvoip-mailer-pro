import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import GlobalQuotaCard from '../components/GlobalQuotaCard';

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

function formatEta(sec: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60); const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60); const rm = m % 60;
  return `${h}h ${rm}m`;

interface PerfInfo {
  worker_concurrency: number; emails_per_second: number;
  max_smtp_connections: number; queue_batch_size: number;
}

export default function CampaignDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<C | null>(null);
  const [b, setB] = useState<Breakdown | null>(null);
  const [busy, setBusy] = useState(false);
  const [perf, setPerf] = useState<PerfInfo | null>(null);
  const [worker, setWorker] = useState<{ factor: number; effConc: number; effEps: number; baseConc: number; baseEps: number; hits: number } | null>(null);
  // Speed sampling: rolling samples of (timestamp, accepted, failed)
  const samples = useRef<Array<{ t: number; acc: number; fail: number }>>([]);
  const [speed, setSpeed] = useState({ acceptedPerMin: 0, failedPerMin: 0, etaSec: 0 });

  async function load() {
    if (!id) return;
    try {
      const r = await api<{ campaign: C; breakdown: Breakdown }>(`/campaigns/${id}`);
      setC(r.campaign); setB(r.breakdown);
      const acc = (r.campaign.accepted ?? r.campaign.delivered ?? 0);
      const fail = r.campaign.failed + r.campaign.bounced;
      const now = Date.now();
      const arr = samples.current;
      arr.push({ t: now, acc, fail });
      // keep last 60s
      while (arr.length > 1 && now - arr[0].t > 60_000) arr.shift();
      if (arr.length >= 2) {
        const first = arr[0]; const last = arr[arr.length - 1];
        const dtMin = Math.max(0.001, (last.t - first.t) / 60_000);
        const acceptedPerMin = Math.round((last.acc - first.acc) / dtMin);
        const failedPerMin   = Math.round((last.fail - first.fail) / dtMin);
        const remaining = Math.max(0, (r.campaign.total ?? 0) - (last.acc + last.fail + r.campaign.invalid));
        const ratePerSec = (last.acc - first.acc) / Math.max(0.001, (last.t - first.t) / 1000);
        const etaSec = ratePerSec > 0 ? Math.round(remaining / ratePerSec) : 0;
        setSpeed({ acceptedPerMin, failedPerMin, etaSec });
      }
    } catch {}
  }
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [id]);
  useEffect(() => {
    api<{ settings: PerfInfo }>('/settings').then(r => setPerf({
      worker_concurrency:   r.settings.worker_concurrency   ?? 50,
      emails_per_second:    r.settings.emails_per_second    ?? 100,
      max_smtp_connections: r.settings.max_smtp_connections ?? 50,
      queue_batch_size:     r.settings.queue_batch_size     ?? 500,
    })).catch(() => {});
  }, []);
  useEffect(() => {
    async function pollWorker() {
      try {
        const r = await api<{ worker_effective: any }>('/settings/worker');
        if (r.worker_effective) setWorker(r.worker_effective);
      } catch {}
    }
    pollWorker(); const t = setInterval(pollWorker, 5000); return () => clearInterval(t);
  }, []);

  async function action(name: 'start' | 'pause' | 'resume' | 'stop') {
    if (!id) return;
    if (name === 'stop' && !confirm('Stop this campaign? In-flight recipients will be cancelled.')) return;
    setBusy(true);
    try { await api(`/campaigns/${id}/${name}`, { method: 'POST' }); await load(); }
    catch (e: any) {
      const code = e?.code;
      const m = e?.message;
      const map: Record<string, string> = {
        no_smtp: 'Select at least one SMTP server.',
        no_active_smtp: 'No active SMTP server matches this campaign.',
        no_recipients: 'Add at least one recipient before sending.',
        quota_exhausted: 'Global SMTP quota exhausted.',
        worker_unavailable: 'Worker unavailable — try again or contact admin.',
        service_unavailable: 'Backend temporarily unreachable. Try again.',
      };
      alert(map[code] ?? m ?? 'Action failed');
    }
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

      <GlobalQuotaCard />

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

      <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <Counter label="Total" value={c.total} />
        <Counter label="Accepted" value={accepted} tone="text-emerald-300" />
        <Counter label="Failed" value={c.failed} tone="text-crimson-400" />
        <Counter label="Bounced" value={c.bounced} tone="text-crimson-400" />
        <Counter label="Delayed / Throttled" value={b.delayed} tone="text-sky-300" />
        <Counter label="Queued" value={b.queued} tone="text-amber-300" />
        <Counter label="Processing" value={b.processing} tone="text-amber-300" />
      </div>

      <div className="card">
        <div className="text-sm font-semibold mb-3">Live Throughput</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Counter label="Speed (emails/min)" value={speed.acceptedPerMin} tone="text-emerald-300" />
          <Counter label="Failed/min" value={speed.failedPerMin} tone="text-crimson-400" />
          <div className="glass rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">ETA</div>
            <div className="text-2xl font-semibold tabular-nums text-white">{formatEta(speed.etaSec)}</div>
          </div>
          <Counter label="Active connections" value={Math.min(b.processing, perf?.max_smtp_connections ?? 0) || b.processing} tone="text-sky-300" />
          <Counter
            label={worker && worker.factor < 1 ? `Effective EPS (throttled ${Math.round(worker.factor * 100)}%)` : 'Rate limit (eps)'}
            value={worker?.effEps ?? perf?.emails_per_second ?? 0}
            tone={worker && worker.factor < 1 ? 'text-amber-300' : 'text-slate-300'}
          />
        </div>
        {worker && worker.factor < 1 && (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
            SMTP throttling detected ({worker.hits} hits/60s). Send rate temporarily reduced to
            {' '}{worker.effEps}/s · concurrency {worker.effConc} (base {worker.baseEps}/s · {worker.baseConc}). Will gradually restore when throttling subsides.
          </div>
        )}
        {perf && (
          <div className="text-[11px] text-slate-500 mt-3">
            Worker concurrency {worker?.effConc ?? perf.worker_concurrency}{worker && worker.factor < 1 ? ` of ${perf.worker_concurrency}` : ''} · Max SMTP connections {perf.max_smtp_connections} · Batch {perf.queue_batch_size}
          </div>
        )}
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
