import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Row {
  id: string; recipient: string; status: string; error?: string;
  created_at: string; smtp_name?: string; campaign_name?: string;
  smtp_id?: string; campaign_id?: string;
  message_id?: string; smtp_response?: string; rt_ms?: number;
  attempts?: number;
}
interface Summary {
  total: number; accepted: number; delivered: number; failed: number;
  bounced: number; invalid: number; queued: number; processing: number; rejected: number;
  delayed?: number;
}
interface CampaignLite { id: string; name: string }
interface SmtpLite { id: string; name: string }

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['delivered', 'Accepted'],
  ['failed', 'Failed'],
  ['bounced', 'Bounced'],
  ['delayed', 'Delayed / Throttled'],
  ['invalid', 'Invalid'],
];

function statusLabel(s: string) {
  if (s === 'delivered') return 'Accepted';
  if (s === 'delayed') return 'Delayed / Throttled';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function statusClass(s: string) {
  if (s === 'delivered') return 'badge-ok';
  if (s === 'failed' || s === 'bounced' || s === 'invalid' || s === 'rejected') return 'badge-err';
  if (s === 'queued' || s === 'processing' || s === 'delayed') return 'badge-warn';
  return 'badge-muted';
}

function Card({ label, value, tone = 'text-slate-200' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString()}</div>
    </div>
  );
}

export default function TransmissionLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [smtpId, setSmtpId] = useState('');
  const [search, setSearch] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [smtps, setSmtps] = useState<SmtpLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const q: Record<string, string | undefined> = {
        status: status || undefined,
        campaign_id: campaignId || undefined,
        smtp_id: smtpId || undefined,
        search: search || undefined,
        since: since ? new Date(since).toISOString() : undefined,
        until: until ? new Date(until).toISOString() : undefined,
      };
      const [logsR, sumR] = await Promise.all([
        api<{ logs: Row[] }>('/logs/transmission', { query: q }),
        api<{ summary: Summary }>('/logs/transmission/summary', {
          query: { campaign_id: campaignId || undefined },
        }),
      ]);
      setRows(logsR.logs); setSummary(sumR.summary);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    api<{ campaigns: { id: string; name: string }[] }>('/campaigns').then(r => setCampaigns(r.campaigns));
    api<{ smtps: { id: string; name: string }[] }>('/smtp').then(r => setSmtps(r.smtps));
  }, []);
  useEffect(() => { load(); }, [status, campaignId, smtpId, since, until]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, status, campaignId, smtpId, search, since, until]);

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
          <p className="text-sm text-slate-400">Every send attempt across your campaigns. Auto-refreshes every 5 seconds.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 flex items-center gap-2">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            auto-refresh
          </label>
          <button className="btn-ghost" onClick={load}>Refresh</button>
          <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <Card label="Total" value={summary?.total ?? 0} />
        <Card label="Accepted" value={summary?.accepted ?? 0} tone="text-emerald-300" />
        <Card label="Failed" value={summary?.failed ?? 0} tone="text-crimson-400" />
        <Card label="Bounced" value={summary?.bounced ?? 0} tone="text-crimson-400" />
        <Card label="Delayed" value={summary?.delayed ?? 0} tone="text-sky-300" />
        <Card label="Queued" value={summary?.queued ?? 0} tone="text-amber-300" />
        <Card label="Processing" value={summary?.processing ?? 0} tone="text-amber-300" />
      </div>

      <div className="card grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input" value={campaignId} onChange={e => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input" value={smtpId} onChange={e => setSmtpId(e.target.value)}>
          <option value="">All SMTP servers</option>
          {smtps.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className="input" type="date" value={since} onChange={e => setSince(e.target.value)} />
        <input className="input" type="date" value={until} onChange={e => setUntil(e.target.value)} />
        <form onSubmit={e => { e.preventDefault(); load(); }}>
          <input className="input" placeholder="Search recipient…" value={search} onChange={e => setSearch(e.target.value)} />
        </form>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
              <tr>
                <th className="text-left px-3 py-3 whitespace-nowrap">Time</th>
                <th className="text-left px-3 py-3">Recipient</th>
                <th className="text-left px-3 py-3">Campaign</th>
                <th className="text-left px-3 py-3">SMTP</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-left px-3 py-3">SMTP response</th>
                <th className="text-left px-3 py-3">Error</th>
                <th className="text-left px-3 py-3">Message ID</th>
                <th className="text-right px-3 py-3">Retry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && !rows.length && <tr><td colSpan={9} className="p-6 text-center text-slate-500">Loading…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={9} className="p-6 text-center text-slate-500">No log entries match your filters.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-white/[0.02] align-top">
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 break-all">{r.recipient}</td>
                  <td className="px-3 py-2 text-slate-300 truncate max-w-[12rem]">{r.campaign_name ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-300 truncate max-w-[10rem]">{r.smtp_name ?? '—'}</td>
                  <td className="px-3 py-2"><span className={statusClass(r.status)}>{statusLabel(r.status)}</span></td>
                  <td className="px-3 py-2 text-xs text-slate-400 max-w-[16rem] truncate" title={r.smtp_response ?? ''}>{r.smtp_response ?? ''}</td>
                  <td className="px-3 py-2 text-crimson-300 text-xs max-w-[16rem] truncate" title={r.error ?? ''}>{r.error ?? ''}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 max-w-[14rem] truncate" title={r.message_id ?? ''}>{r.message_id ?? ''}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-400">{r.attempts ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
