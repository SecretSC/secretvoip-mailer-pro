import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Row {
  id: string; recipient: string; status: string; error?: string;
  created_at: string; smtp_name?: string; campaign_name?: string;
}

const STATUSES = ['', 'delivered', 'failed', 'bounced', 'invalid', 'delayed'];

export default function TransmissionLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ logs: Row[] }>('/logs/transmission', { query: { status: status || undefined } });
      setRows(r.logs);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [status]);

  function exportCsv() {
    const tok = localStorage.getItem('svp_token');
    const url = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/logs/transmission.csv`;
    fetch(url, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
      .then(r => r.blob())
      .then(b => {
        const u = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = u; a.download = 'transmission.csv'; a.click();
        URL.revokeObjectURL(u);
      });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transmission Log</h1>
          <p className="text-sm text-slate-400">Every delivery attempt across your campaigns.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-40" value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-4 py-3">Time</th>
              <th className="text-left px-4 py-3">Recipient</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Campaign</th>
              <th className="text-left px-4 py-3">SMTP</th>
              <th className="text-left px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && !rows.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No log entries yet.</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">{r.recipient}</td>
                <td className="px-4 py-2"><span className={
                  r.status === 'delivered' ? 'badge-ok' :
                  r.status === 'delayed' ? 'badge-warn' : 'badge-err'
                }>{r.status}</span></td>
                <td className="px-4 py-2 text-slate-300">{r.campaign_name ?? '—'}</td>
                <td className="px-4 py-2 text-slate-300">{r.smtp_name ?? '—'}</td>
                <td className="px-4 py-2 text-crimson-300 text-xs max-w-md truncate">{r.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
