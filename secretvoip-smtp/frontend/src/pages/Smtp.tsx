import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Smtp {
  id: string; name: string; host: string; port: number; username: string;
  secure: boolean; starttls: boolean; from_name: string; from_email: string;
  status: string; last_test_status?: string; last_test_error?: string;
}

const empty = { name: '', host: '', port: 587, username: '', password: '', secure: false, starttls: true, from_name: '', from_email: '' };

export default function SmtpPage() {
  const [rows, setRows] = useState<Smtp[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() { const r = await api<{ smtps: Smtp[] }>('/smtp'); setRows(r.smtps); }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const body: any = { ...form, port: Number(form.port) };
      if (editing) {
        if (!body.password) delete body.password;
        await api(`/smtp/${editing}`, { method: 'PATCH', body });
      } else {
        await api('/smtp', { method: 'POST', body });
      }
      setForm(empty); setEditing(null); await load();
    } catch (e: any) { setErr(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  }

  async function test(id: string) {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; error?: string; rt_ms?: number; host?: string; port?: number; tls?: string }>(
        `/smtp/${id}/test`, { method: 'POST' }
      );
      if (r.ok) {
        alert(
          `✅ SMTP test succeeded\n\n` +
          `Connection: OK\nAuthentication: OK\n` +
          `Endpoint: ${r.host}:${r.port}\nTLS: ${r.tls?.toUpperCase()}\n` +
          `Round-trip: ${r.rt_ms} ms`
        );
      } else {
        alert(
          `❌ SMTP test failed\n\n` +
          `Endpoint: ${r.host}:${r.port}\nTLS: ${r.tls?.toUpperCase()}\n` +
          `Round-trip: ${r.rt_ms} ms\n\nError: ${r.error}`
        );
      }
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this SMTP server?')) return;
    await api(`/smtp/${id}`, { method: 'DELETE' }); await load();
  }

  function edit(s: Smtp) {
    setEditing(s.id);
    setForm({ name: s.name, host: s.host, port: s.port, username: s.username, password: '', secure: s.secure, starttls: s.starttls, from_name: s.from_name, from_email: s.from_email });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SMTP Servers</h1>
        <p className="text-sm text-slate-400">Manage outbound SMTP credentials. Passwords are encrypted at rest with AES-256-GCM.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={save} className="card space-y-3 lg:col-span-1">
          <div className="font-semibold">{editing ? 'Edit SMTP' : 'Add SMTP'}</div>
          <div><label className="label">Name</label><input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><label className="label">Host</label><input className="input" required value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} /></div>
            <div><label className="label">Port</label><input type="number" className="input" required value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} /></div>
          </div>
          <div><label className="label">Username</label><input className="input" required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
          <div><label className="label">Password{editing && <span className="text-slate-500 normal-case"> — leave blank to keep current</span>}</label>
            <input type="password" className="input" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">From name</label><input className="input" required value={form.from_name} onChange={e => setForm({ ...form, from_name: e.target.value })} /></div>
            <div><label className="label">From email</label><input className="input" type="email" required value={form.from_email} onChange={e => setForm({ ...form, from_email: e.target.value })} /></div>
          </div>
          <div className="flex items-center gap-4 text-sm pt-1">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.secure} onChange={e => setForm({ ...form, secure: e.target.checked })} />SSL (implicit)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.starttls} onChange={e => setForm({ ...form, starttls: e.target.checked })} />STARTTLS</label>
          </div>
          {err && <div className="text-crimson-400 text-sm">{err}</div>}
          <div className="flex gap-2 pt-2">
            <button className="btn-primary flex-1" disabled={busy}>{editing ? 'Update' : 'Add SMTP'}</button>
            {editing && <button type="button" className="btn-ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
          </div>
        </form>

        <div className="lg:col-span-2 space-y-3">
          {rows.length === 0 && <div className="card text-sm text-slate-500">No SMTP servers configured yet.</div>}
          {rows.map(s => (
            <div key={s.id} className="card flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="font-semibold">{s.name} <span className="text-slate-500 font-normal text-xs ml-2">{s.host}:{s.port}</span></div>
                <div className="text-xs text-slate-400">{s.from_name} &lt;{s.from_email}&gt;</div>
                {s.last_test_status && (
                  <div className="text-xs mt-1">
                    Last test: <span className={s.last_test_status === 'ok' ? 'text-emerald-300' : 'text-crimson-400'}>{s.last_test_status}</span>
                    {s.last_test_error && <span className="text-slate-500"> — {s.last_test_error}</span>}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" disabled={busy} onClick={() => test(s.id)}>Test</button>
                <button className="btn-ghost" onClick={() => edit(s)}>Edit</button>
                <button className="btn-danger" onClick={() => remove(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
