import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface Details {
  user: { id: string; username: string; role: string; status: string; created_at: string; notes?: string | null };
  smtps: any[];
  campaigns: any[];
  templates: any[];
  logs: any[];
  activity: any[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-3">
      <div className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</div>
      {children}
    </div>
  );
}

export default function AdminClientDetails() {
  const { id } = useParams();
  const [d, setD] = useState<Details | null>(null);
  useEffect(() => { if (id) api<Details>(`/users/${id}/details`).then(setD).catch(() => {}); }, [id]);

  if (!d) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/users" className="text-xs text-slate-400 hover:text-white">← back to users</Link>
        <h1 className="text-2xl font-semibold mt-1">{d.user.username}</h1>
        <div className="text-sm text-slate-400 capitalize">{d.user.role} · {d.user.status} · joined {new Date(d.user.created_at).toLocaleDateString()}</div>
      </div>

      <Section title="SMTP Servers">
        {d.smtps.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs uppercase"><tr>
                <th className="text-left py-2">Host</th><th className="text-right">Port</th><th className="text-left">Username</th>
                <th className="text-center">TLS</th><th className="text-right">Created</th><th className="text-right">Last Test</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.smtps.map((s: any) => (
                  <tr key={s.id}>
                    <td className="py-2">{s.host}</td><td className="text-right">{s.port}</td>
                    <td>{s.username}</td>
                    <td className="text-center">{s.secure ? 'SSL' : s.starttls ? 'STARTTLS' : '—'}</td>
                    <td className="text-right text-xs text-slate-500">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="text-right text-xs text-slate-500">{s.last_test_at ? new Date(s.last_test_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Campaigns">
        {d.campaigns.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase"><tr>
              <th className="text-left py-2">Name</th><th>Status</th><th className="text-right">Recipients</th>
              <th className="text-right">Accepted</th><th className="text-right">Failed</th><th className="text-right">Created</th>
            </tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.campaigns.map((c: any) => (
                <tr key={c.id}>
                  <td className="py-2">{c.name}</td><td className="capitalize">{c.status}</td>
                  <td className="text-right">{c.total?.toLocaleString()}</td>
                  <td className="text-right text-emerald-300">{(c.accepted ?? 0).toLocaleString()}</td>
                  <td className="text-right text-crimson-400">{c.failed?.toLocaleString()}</td>
                  <td className="text-right text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Templates">
        {d.templates.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase"><tr>
              <th className="text-left py-2">Name</th><th>Subject</th><th className="text-right">Created</th><th className="text-right">Modified</th>
            </tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.templates.map((t: any) => (
                <tr key={t.id}>
                  <td className="py-2">{t.name}</td><td className="text-slate-400 truncate">{t.subject}</td>
                  <td className="text-right text-xs text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="text-right text-xs text-slate-500">{new Date(t.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Transmission Logs (last 200)">
        {d.logs.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
          <div className="overflow-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase"><tr>
                <th className="text-left py-1">Time</th><th>Recipient</th><th>Status</th><th>Message ID</th><th>Response</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.logs.map((l: any) => (
                  <tr key={l.id}>
                    <td className="py-1 whitespace-nowrap text-slate-500">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="truncate max-w-[200px]">{l.recipient}</td>
                    <td className={l.status === 'delivered' ? 'text-emerald-300' : 'text-crimson-400'}>{l.status}</td>
                    <td className="truncate max-w-[200px] text-slate-500">{l.message_id ?? '—'}</td>
                    <td className="truncate max-w-[300px] text-slate-500">{l.smtp_response ?? l.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Activity Log (last 200)">
        {d.activity.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
          <div className="overflow-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase"><tr>
                <th className="text-left py-1">Time</th><th>Action</th><th>Target</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.activity.map((a: any) => (
                  <tr key={a.id}>
                    <td className="py-1 whitespace-nowrap text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                    <td>{a.action}</td>
                    <td className="text-slate-500 truncate max-w-[300px]">{a.target ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
