import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface List { id: string; name: string; count: string }
interface Smtp { id: string; name: string; from_email: string; status: string }

export default function CampaignEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('<p>Hello {{first_name}},</p>');
  const [text, setText] = useState('');
  const [listId, setListId] = useState<string>('');
  const [smtpIds, setSmtpIds] = useState<string[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [smtps, setSmtps] = useState<Smtp[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ lists: List[] }>('/contacts/lists').then(r => setLists(r.lists));
    api<{ smtps: Smtp[] }>('/smtp').then(r => setSmtps(r.smtps.filter(s => s.status === 'active')));
    if (id) {
      api<{ campaign: any }>(`/campaigns/${id}`).then(r => {
        const c = r.campaign;
        setName(c.name); setSubject(c.subject); setHtml(c.html); setText(c.text);
        setListId(c.list_id ?? ''); setSmtpIds(c.smtp_ids ?? []);
      });
    }
  }, [id]);

  async function save(start: boolean) {
    setErr(null); setSaving(true);
    try {
      const body = { name, subject, html, text, list_id: listId || undefined, smtp_ids: smtpIds };
      let cid = id;
      if (cid) await api(`/campaigns/${cid}`, { method: 'PATCH', body });
      else { const r = await api<{ id: string }>('/campaigns', { method: 'POST', body }); cid = r.id; }
      if (start && cid) await api(`/campaigns/${cid}/start`, { method: 'POST' });
      nav(cid ? `/campaigns/${cid}` : '/campaigns');
    } catch (e: any) {
      setErr(e?.message ?? 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{id ? 'Edit campaign' : 'New campaign'}</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card space-y-4">
            <div><label className="label">Campaign name</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label className="label">Subject</label><input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Welcome {{first_name}}!" /></div>
            <div><label className="label">HTML content</label><textarea className="input font-mono text-xs h-72" value={html} onChange={e => setHtml(e.target.value)} /></div>
            <div><label className="label">Plain text (fallback)</label><textarea className="input font-mono text-xs h-32" value={text} onChange={e => setText(e.target.value)} /></div>
            <div className="text-xs text-slate-500">Available variables: <code>{'{{first_name}}'}</code> <code>{'{{last_name}}'}</code> <code>{'{{email}}'}</code> <code>{'{{company}}'}</code></div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <label className="label">Recipient list</label>
            <select className="input" value={listId} onChange={e => setListId(e.target.value)}>
              <option value="">— choose a list —</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
            </select>
          </div>

          <div className="card space-y-3">
            <label className="label">SMTP servers (rotate)</label>
            <div className="space-y-2 max-h-64 overflow-auto">
              {smtps.length === 0 && <div className="text-xs text-slate-500">No active SMTP servers. Add one in SMTP Servers.</div>}
              {smtps.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={smtpIds.includes(s.id)}
                    onChange={e => setSmtpIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id))} />
                  <span className="text-slate-200">{s.name}</span>
                  <span className="text-slate-500 text-xs">{s.from_email}</span>
                </label>
              ))}
            </div>
          </div>

          {err && <div className="card text-sm text-crimson-400">{err}</div>}

          <div className="flex gap-2">
            <button className="btn-ghost flex-1" disabled={saving} onClick={() => save(false)}>Save draft</button>
            <button className="btn-primary flex-1" disabled={saving} onClick={() => save(true)}>Save & start</button>
          </div>
        </div>
      </div>
    </div>
  );
}
