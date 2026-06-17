import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface GlobalQuota {
  total: number;
  used: number;
  remaining: number;
  active: boolean;
  exhausted: boolean;
  reset_at: string | null;
}

let cache: GlobalQuota | null = null;
const listeners = new Set<(q: GlobalQuota | null) => void>();

async function fetchQuota() {
  try {
    const r = await api<{ quota: GlobalQuota }>('/settings/quota');
    cache = r.quota;
    listeners.forEach(l => l(cache));
  } catch { /* silent */ }
}

export function useGlobalQuota(pollMs = 5000) {
  const [q, setQ] = useState<GlobalQuota | null>(cache);
  useEffect(() => {
    listeners.add(setQ);
    fetchQuota();
    const id = setInterval(fetchQuota, pollMs);
    return () => { listeners.delete(setQ); clearInterval(id); };
  }, [pollMs]);
  return q;
}

export default function GlobalQuotaCard({ compact = false }: { compact?: boolean }) {
  const q = useGlobalQuota();
  if (!q) {
    return (
      <div className="card">
        <div className="text-xs uppercase tracking-wider text-slate-400">Global SMTP Quota</div>
        <div className="text-sm text-slate-500 mt-2">Loading…</div>
      </div>
    );
  }
  const pct = q.total > 0 ? Math.min(100, Math.round((q.used / q.total) * 100)) : 0;
  const dot = !q.active
    ? 'bg-slate-500'
    : q.exhausted ? 'bg-crimson-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-400';
  const statusLabel = !q.active ? 'Unlimited' : q.exhausted ? 'Exhausted' : 'Active';
  const barColor = q.exhausted
    ? 'from-crimson-500 to-crimson-700'
    : pct > 80 ? 'from-amber-400 to-amber-600' : 'from-emerald-400 to-emerald-600';

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-slate-400">Global SMTP Quota</div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-slate-300">{statusLabel}</span>
        </div>
      </div>
      {q.active ? (
        <>
          <div className={`grid ${compact ? 'grid-cols-3' : 'grid-cols-3'} gap-3 mt-3`}>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Total</div>
              <div className="text-lg font-semibold">{q.total.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Used</div>
              <div className="text-lg font-semibold">{q.used.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Remaining</div>
              <div className="text-lg font-semibold">{q.remaining.toLocaleString()}</div>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full bg-gradient-to-r ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          {q.exhausted && (
            <div className="mt-3 text-xs text-crimson-300 bg-crimson-500/10 border border-crimson-500/30 rounded-md px-2 py-1.5">
              Global SMTP quota exhausted. Contact administrator.
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-slate-400 mt-2">No platform quota set — unlimited sending.</div>
      )}
    </div>
  );
}
