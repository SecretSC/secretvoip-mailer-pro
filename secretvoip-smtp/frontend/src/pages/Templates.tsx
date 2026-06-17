import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface Template {
  id: string;
  name: string;
  subject: string;
  html: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export default function Templates() {
  const [items, setItems] = useState<Template[]>([]);
  const [sel, setSel] = useState<Template | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', subject: '', html: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api<{ templates: Template[] }>('/templates');
    setItems(r.templates);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setSel(null); setEditing(true);
    setForm({ name: '', subject: '', html: '<p>Hello {{first_name}},</p>', text: '' });
  }
  function openEdit(t: Template) {
    setSel(t); setEditing(true);
    setForm({ name: t.name, subject: t.subject, html: t.html, text: t.text });
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      if (sel) await api(`/templates/${sel.id}`, { method: 'PATCH', body: form });
      else await api('/templates', { method: 'POST', body: form });
      setEditing(false); setSel(null); await load();
    } catch (e: any) {
      setErr(e?.message === 'name_taken' ? 'A template with that name already exists.' : (e?.message ?? 'Save failed'));
    } finally { setBusy(false); }
  }

  async function remove(t: Template) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    await api(`/templates/${t.id}`, { method: 'DELETE' });
    if (sel?.id === t.id) { setSel(null); setEditing(false); }
    await load();
  }

  async function rename(t: Template) {
    const name = prompt('New name', t.name)?.trim();
    if (!name || name === t.name) return;
    try {
      await api(`/templates/${t.id}`, { method: 'PATCH', body: { name } });
      await load();
    } catch (e: any) {
      alert(e?.message === 'name_taken' ? 'Name already in use.' : (e?.message ?? 'Rename failed'));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Email Templates</h1>
          <p className="text-sm text-slate-400">Reusable subject, HTML and plain-text bodies for your campaigns.</p>
        </div>
        <button className="btn-primary" onClick={startNew}>＋ New template</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card p-0 overflow-hidden lg:col-span-1">
          {items.length === 0 && <div className="p-6 text-sm text-slate-500">No templates yet.</div>}
          <ul className="divide-y divide-white/5">
            {items.map(t => (
              <li key={t.id} className={`p-3 hover:bg-white/[0.03] ${sel?.id === t.id ? 'bg-white/[0.04]' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <button className="text-left flex-1 min-w-0" onClick={() => openEdit(t)}>
                    <div className="font-medium truncate">{t.name}</div>
                    <div className="text-xs text-slate-500 truncate">{t.subject || '— no subject —'}</div>
                  </button>
                  <div className="flex flex-col gap-1">
                    <button className="text-xs text-slate-400 hover:text-white" onClick={() => rename(t)}>rename</button>
                    <button className="text-xs text-crimson-400 hover:text-crimson-300" onClick={() => remove(t)}>delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-2 space-y-3">
          {!editing && <div className="card text-sm text-slate-500">Select a template to edit, or create a new one.</div>}
          {editing && (
            <div className="card space-y-3">
              <div className="font-semibold text-lg">{sel ? 'Edit template' : 'New template'}</div>
              <div><label className="label">Name</label>
                <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="label">Subject</label>
                <input className="input" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
              <div><label className="label">HTML</label>
                <textarea className="input font-mono text-xs h-64" value={form.html} onChange={e => setForm({ ...form, html: e.target.value })} /></div>
              <div><label className="label">Plain text</label>
                <textarea className="input font-mono text-xs h-32" value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></div>
              {err && <div className="text-crimson-400 text-sm">{err}</div>}
              <div className="flex gap-2 justify-end">
                <button className="btn-ghost" onClick={() => { setEditing(false); setSel(null); }}>Cancel</button>
                <button className="btn-primary" disabled={busy || !form.name.trim()} onClick={save}>{sel ? 'Save changes' : 'Create template'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
