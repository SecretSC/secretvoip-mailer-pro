import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface Row {
  id: string; name: string; subject: string; status: string;
  total: number; sent: number; delivered: number; failed: number;
  created_at: string;
}

const statusBadge: Record<string, string> = {
  draft: 'badge-muted', queued: 'badge-warn', processing: 'badge-warn',
  paused: 'badge-warn', completed: 'badge-ok', cancelled: 'badge-err',
  failed: 'badge-err',
};

export default function Campaigns() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { const r = await api<{ campaigns: Row[] }>('/campaigns'); setRows(r.campaigns); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="text-sm text-slate-400">Plan, send and monitor your email campaigns.</p>
        </div>
        <Link to="/campaigns/new" className="btn-primary">＋ New campaign</Link>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Progress</th>
              <th className="text-right px-4 py-3">Delivered / Total</th>
              <th className="text-right px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && !rows.length && <tr><td colSpan={5} className="p-6 text-slate-500 text-center">Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={5} className="p-6 text-slate-500 text-center">No campaigns yet.</td></tr>}
            {rows.map(r => {
              const pct = r.total ? Math.round(((r.delivered + r.failed) / r.total) * 100) : 0;
              return (
                <tr key={r.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link to={`/campaigns/${r.id}`} className="font-medium hover:text-crimson-400">{r.name}</Link>
                    <div className="text-xs text-slate-500 truncate max-w-md">{r.subject}</div>
                  </td>
                  <td className="px-4 py-3"><span className={statusBadge[r.status] ?? 'badge-muted'}>{r.status}</span></td>
                  <td className="px-4 py-3 text-right w-48">
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-crimson-500 to-crimson-700" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{pct}%</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">{r.delivered.toLocaleString()} / {r.total.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
