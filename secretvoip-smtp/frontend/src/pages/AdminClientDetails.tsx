import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface Smtp {
  id: string; name: string; host: string; port: number; username: string;
  password?: string | null; secure: boolean; starttls: boolean;
  from_name: string; from_email: string; status: string;
  created_at: string; updated_at: string;
  last_test_at?: string | null; last_test_status?: string | null; last_test_error?: string | null;
  last_success_at?: string | null; last_failed_at?: string | null; last_failed_error?: string | null;
}
interface LogRow {
  id: number; recipient: string; status: string; message_id?: string | null;
  smtp_response?: string | null; error?: string | null; created_at: string;
  smtp_name?: string | null; smtp_host?: string | null; smtp_port?: number | null;
  smtp_username?: string | null; campaign_name?: string | null; rt_ms?: number | null;
}
interface Details {
  user: {
    id: string; username: string; role: string; status: string; created_at: string;
    notes?: string | null; last_login_at?: string | null; last_login_ip?: string | null;
    last_active_at?: string | null; password_visible?: boolean;
  };
  quota?: {
    total: number; used: number; remaining: number;
    active: boolean; exhausted: boolean; updated_at: string | null;
  };
  smtps: Smtp[];
  campaigns: any[];
  templates: any[];
  logs: LogRow[];
  activity: any[];
  logins: any[];
  metrics: {
    last_login_at?: string | null; last_login_ip?: string | null; last_active_at?: string | null;
    last_campaign_at?: string | null; last_template_at?: string | null;
    last_smtp_test_at?: string | null; last_smtp_edit_at?: string | null;
    last_audit_at?: string | null;
  };
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function fmt(d?: string | null) { return d ? new Date(d).toLocaleString() : '—'; }

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm text-slate-200 mt-1 break-all">{value}</div>
    </div>
  );
}

export default function AdminClientDetails() {
  const { id } = useParams();
  const [d, setD] = useState<Details | null>(null);
  const [pw, setPw] = useState<{ available: boolean; password: string | null; message?: string } | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showSmtpPw, setShowSmtpPw] = useState<Record<string, boolean>>({});

  async function load() {
    if (!id) return;
    try { const r = await api<Details>(`/users/${id}/details`); setD(r); } catch {}
  }
  useEffect(() => { load(); }, [id]);

  async function loadPw() {
    if (!id) return;
    if (pw) { setShowPw(s => !s); return; }
    try {
      const r = await api<{ available: boolean; password: string | null; message?: string }>(`/users/${id}/password`);
      setPw(r); setShowPw(true);
    } catch (e: any) { alert(e?.message ?? 'Failed to load password'); }
  }

  async function resetPw() {
    if (!id) return;
    if (!confirm('Reset this user\u2019s password? They will be required to change it on next login.')) return;
    const r = await api<{ password: string }>(`/users/${id}/reset-password`, { method: 'POST', body: {} });
    setPw({ available: true, password: r.password }); setShowPw(true);
    await load();
    alert(`New password: ${r.password}`);
  }

  if (!d) return <div className="text-slate-400">Loading…</div>;
  const m = d.metrics || {};

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/admin/users" className="text-xs text-slate-400 hover:text-white">← back to users</Link>
          <h1 className="text-2xl font-semibold mt-1">{d.user.username}</h1>
          <div className="text-sm text-slate-400 capitalize">
            {d.user.role} · {d.user.status} · joined {new Date(d.user.created_at).toLocaleDateString()}
          </div>
        </div>
        <Link to="/admin/diagnostics" className="btn-ghost text-xs">Open Diagnostics →</Link>
      </div>

      <Section title="Account Information" actions={
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={loadPw}>{showPw && pw ? 'Hide password' : 'Show password'}</button>
          <button className="btn-ghost text-xs" onClick={resetPw}>Reset password</button>
        </div>
      }>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Stat label="Username" value={d.user.username} />
          <Stat label="Current Password" value={
            showPw && pw
              ? (pw.available
                  ? <code className="text-emerald-300">{pw.password}</code>
                  : <span className="text-amber-300 text-xs">{pw.message ?? 'Not available'}</span>)
              : <span className="text-slate-500">••••••••</span>
          } />
          <Stat label="Status" value={<span className={d.user.status === 'active' ? 'badge-ok' : 'badge-err'}>{d.user.status}</span>} />
          <Stat label="Created" value={fmt(d.user.created_at)} />
          <Stat label="Last Login" value={fmt(m.last_login_at)} />
          <Stat label="Last Login IP" value={m.last_login_ip || '—'} />
          <Stat label="Last Active" value={fmt(m.last_active_at)} />
          <Stat label="Last Campaign Created" value={fmt(m.last_campaign_at)} />
          <Stat label="Last SMTP Test" value={fmt(m.last_smtp_test_at)} />
          <Stat label="Last SMTP Edit" value={fmt(m.last_smtp_edit_at)} />
          <Stat label="Last Template Saved" value={fmt(m.last_template_at)} />
          <Stat label="Last Audit Event" value={fmt(m.last_audit_at)} />
        </div>
      </Section>

      <Section title="SMTP Servers (full configuration)">
        {d.smtps.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
          <div className="space-y-3">
            {d.smtps.map(s => (
              <div key={s.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-semibold">{s.name}</div>
                  <span className={s.status === 'active' ? 'badge-ok' : 'badge-err'}>{s.status}</span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                  <Stat label="Host" value={s.host} />
                  <Stat label="Port" value={s.port} />
                  <Stat label="Username" value={s.username} />
                  <Stat label="Password" value={
                    showSmtpPw[s.id]
                      ? (s.password
                          ? <code className="text-emerald-300">{s.password}</code>
                          : <span className="text-amber-300">unavailable</span>)
                      : (
                        <button className="text-slate-400 hover:text-white text-xs underline"
                                onClick={() => setShowSmtpPw(p => ({ ...p, [s.id]: true }))}>
                          ••••••••  (reveal)
                        </button>
                      )
                  } />
                  <Stat label="From Name" value={s.from_name} />
                  <Stat label="From Email" value={s.from_email} />
                  <Stat label="SSL (secure)" value={s.secure ? 'Yes' : 'No'} />
                  <Stat label="STARTTLS" value={s.starttls ? 'Yes' : 'No'} />
                  <Stat label="Created" value={fmt(s.created_at)} />
                  <Stat label="Last Tested" value={`${fmt(s.last_test_at)}${s.last_test_status ? ' · ' + s.last_test_status : ''}`} />
                  <Stat label="Last Successful Send" value={fmt(s.last_success_at)} />
                  <Stat label="Last Failed Send" value={
                    <>
                      <div>{fmt(s.last_failed_at)}</div>
                      {s.last_failed_error && <div className="text-crimson-400 text-[11px] truncate">{s.last_failed_error}</div>}
                    </>
                  } />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent Login History">
        {d.logins.length === 0 ? <div className="text-xs text-slate-500">No logins recorded yet.</div> : (
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase"><tr>
                <th className="text-left py-1">Time</th><th>IP</th><th>Result</th><th className="text-left">User-Agent</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.logins.map(l => (
                  <tr key={l.id}>
                    <td className="py-1 whitespace-nowrap text-slate-500">{fmt(l.created_at)}</td>
                    <td className="font-mono">{l.ip ?? '—'}</td>
                    <td className={l.success ? 'text-emerald-300' : 'text-crimson-400'}>{l.success ? 'success' : 'failed'}</td>
                    <td className="text-slate-500 truncate max-w-[400px]">{l.user_agent ?? '—'}</td>
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
          <div className="overflow-auto max-h-[28rem]">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase"><tr>
                <th className="text-left py-1">Time</th><th>Recipient</th><th>Campaign</th>
                <th>SMTP</th><th>Host:Port</th><th>Username</th>
                <th>Status</th><th>Message ID</th><th>Response / Error</th>
              </tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.logs.map(l => (
                  <tr key={l.id}>
                    <td className="py-1 whitespace-nowrap text-slate-500">{fmt(l.created_at)}</td>
                    <td className="truncate max-w-[180px]">{l.recipient}</td>
                    <td className="truncate max-w-[150px] text-slate-400">{l.campaign_name ?? '—'}</td>
                    <td className="text-slate-300">{l.smtp_name ?? '—'}</td>
                    <td className="font-mono text-slate-500">{l.smtp_host ? `${l.smtp_host}:${l.smtp_port}` : '—'}</td>
                    <td className="text-slate-500">{l.smtp_username ?? '—'}</td>
                    <td className={l.status === 'delivered' ? 'text-emerald-300' : 'text-crimson-400'}>{l.status}</td>
                    <td className="truncate max-w-[180px] text-slate-500">{l.message_id ?? '—'}</td>
                    <td className="truncate max-w-[280px] text-slate-500">{l.smtp_response ?? l.error ?? '—'}</td>
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
                    <td className="py-1 whitespace-nowrap text-slate-500">{fmt(a.created_at)}</td>
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
