import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Status = 'green' | 'yellow' | 'red';
interface Health { status: Status; message: string; detail?: any }
interface Diag {
  api: Health;
  database: Health;
  redis: Health;
  queue: Health;
  queue_events: Health;
  worker: Health;
  smtp: Health;
  last_queue_insert: null | { at: number; campaignId: string; count: number };
  ts: number;
}

const dot: Record<Status, string> = {
  green:  'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]',
  yellow: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]',
  red:    'bg-crimson-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]',
};
const label: Record<Status, string> = { green: 'Healthy', yellow: 'Warning', red: 'Offline' };

function fmtAgo(ts?: number) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

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
      <div className="text-sm text-slate-200 break-words">{h.message}</div>
      {h.detail && (
        <pre className="text-[11px] text-slate-500 bg-ink-950 border border-white/5 rounded-lg p-2 overflow-auto max-h-40">
          {JSON.stringify(h.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

function YesNo({ v }: { v: boolean }) {
  return (
    <span className={v ? 'text-emerald-400 font-semibold' : 'text-crimson-400 font-semibold'}>
      {v ? 'YES' : 'NO'}
    </span>
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

  const counts = (d?.worker?.detail ?? {}) as any;
  const hb = (counts.heartbeat ?? null) as null | {
    pid: number; startedAt: number; lastJobId?: string;
    lastJobAt?: number; lastJobStatus?: string;
    lastError?: string; lastErrorAt?: number;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System Diagnostics</h1>
        <p className="text-sm text-slate-400">Live status of every component required to send mail. Refreshes every 5s.</p>
      </div>

      {err && <div className="card text-crimson-400 text-sm">{err}</div>}

      {!d ? <div className="text-slate-400">Loading…</div> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card name="API" h={d.api} />
            <Card name="Database" h={d.database} />
            <Card name="Redis" h={d.redis} />
            <Card name="Queue" h={d.queue} />
            <Card name="Queue Events" h={d.queue_events} />
            <Card name="Worker" h={d.worker} />
            <Card name="SMTP" h={d.smtp} />
          </div>

          <div className="card space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wider text-slate-300">Queue Status</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-slate-500">Redis Connected</div><YesNo v={d.redis.status === 'green'} /></div>
              <div><div className="text-xs text-slate-500">Queue Connected</div><YesNo v={d.queue.status === 'green'} /></div>
              <div><div className="text-xs text-slate-500">Worker Connected</div><YesNo v={d.worker.status === 'green'} /></div>
              <div><div className="text-xs text-slate-500">QueueEvents Connected</div><YesNo v={d.queue_events.status === 'green'} /></div>
              <div><div className="text-xs text-slate-500">Waiting Jobs</div><div className="font-mono">{counts.waiting ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Active Jobs</div><div className="font-mono">{counts.active ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Delayed Jobs</div><div className="font-mono">{counts.delayed ?? '—'}</div></div>
              <div><div className="text-xs text-slate-500">Failed Jobs</div><div className="font-mono">{counts.failed ?? '—'}</div></div>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="text-sm font-semibold uppercase tracking-wider text-slate-300">Worker Details</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Worker PID</div>
                <div className="font-mono">{hb?.pid ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Worker Online</div>
                <YesNo v={!!hb && (counts.bull_workers_connected ?? 0) > 0} />
              </div>
              <div>
                <div className="text-xs text-slate-500">Started</div>
                <div>{fmtAgo(hb?.startedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Last Job Processed</div>
                <div>{hb?.lastJobId ? `${hb.lastJobId} (${hb.lastJobStatus ?? '—'}, ${fmtAgo(hb.lastJobAt)})` : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Last Error</div>
                <div className="text-crimson-400 break-words">{hb?.lastError ? `${hb.lastError} (${fmtAgo(hb.lastErrorAt)})` : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Last Queue Insert</div>
                <div>
                  {d.last_queue_insert
                    ? `${d.last_queue_insert.count} jobs · campaign ${d.last_queue_insert.campaignId.slice(0, 8)}… · ${fmtAgo(d.last_queue_insert.at)}`
                    : '—'}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="text-xs text-slate-500">
        Green = healthy · Yellow = warning · Red = offline.
        If campaigns fail to queue, check Redis → Queue → Worker → QueueEvents in order.
      </div>
    </div>
  );
}
