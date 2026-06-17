import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Row { id: string; action: string; target?: string; ip?: string; created_at: string; meta?: any; username?: string }

export default function AuditLogs() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { api<{ logs: Row[] }>('/logs/audit').then(r => setRows(r.logs)); }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Logs</h1>
        <p className="text-sm text-slate-400">All security-relevant actions across the platform.</p>
      </div>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
            <tr>
              <th className="text-left px-4 py-3">Time</th>
              <th className="text-left px-4 py-3">User</th>
              <th className="text-left px-4 py-3">Action</th>
              <th className="text-left px-4 py-3">Target</th>
              <th className="text-left px-4 py-3">IP</th>
              <th className="text-left px-4 py-3">Meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">{r.username ?? '—'}</td>
                <td className="px-4 py-2"><code className="text-crimson-300">{r.action}</code></td>
                <td className="px-4 py-2 text-slate-300 text-xs">{r.target ?? '—'}</td>
                <td className="px-4 py-2 text-slate-500 text-xs">{r.ip ?? '—'}</td>
                <td className="px-4 py-2 text-slate-500 text-xs max-w-md truncate">{r.meta ? JSON.stringify(r.meta) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
