import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import GlobalQuotaCard, { useGlobalQuota } from '../components/GlobalQuotaCard';

interface Smtp { id: string; name: string; from_email: string; from_name: string; status: string }
interface Template { id: string; name: string; subject: string; html: string; text: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseEmails(raw: string) {
  const lines = raw.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const e of lines) {
    if (seen.has(e)) { duplicates++; continue; }
    seen.add(e);
    if (EMAIL_RE.test(e)) valid.push(e); else invalid.push(e);
  }
  return { valid, invalid, duplicates };
}

function recommendation(n: number): { tone: 'ok' | 'warn' | 'danger'; text: string } {
  if (n === 0) return { tone: 'ok', text: 'Add recipients to send your campaign.' };
  if (n <= 1000) return { tone: 'ok', text: `Recommended size — ${n.toLocaleString()} recipients. Good deliverability.` };
  if (n <= 10000) return { tone: 'warn', text: `Large campaign (${n.toLocaleString()}). Sending in smaller batches improves reputation.` };
  return { tone: 'danger', text: `Very large campaign (${n.toLocaleString()}). Strongly recommend splitting into batches and warming up SMTP.` };
}

export default function CampaignEditor() {
  const { id } = useParams();
  const nav = useNavigate();

  const [name, setName] = useState('');
  const [fromName, setFromName] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('<p>Hello {{first_name}},</p>');
  const [text, setText] = useState('');
  const [smtpIds, setSmtpIds] = useState<string[]>([]);
  const [recipientsRaw, setRecipientsRaw] = useState('');

  const [smtps, setSmtps] = useState<Smtp[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const quota = useGlobalQuota();

  useEffect(() => {
    api<{ smtps: Smtp[] }>('/smtp').then(r => setSmtps(r.smtps.filter(s => s.status === 'active')));
    api<{ templates: Template[] }>('/templates').then(r => setTemplates(r.templates));
    if (id) {
      api<{ campaign: any }>(`/campaigns/${id}`).then(async (r) => {
        const c = r.campaign;
        setName(c.name); setSubject(c.subject); setHtml(c.html); setText(c.text);
        setFromName(c.from_name ?? '');
        setSmtpIds(c.smtp_ids ?? []);
        // Try to load existing recipients into the textarea for visibility
        try {
          const rr = await api<{ recipients: { email: string }[] }>(`/campaigns/${id}/recipients`);
          if (rr.recipients?.length) setRecipientsRaw(rr.recipients.map(x => x.email).join('\n'));
        } catch {}
      });
    }
  }, [id]);

  const parsed = useMemo(() => parseEmails(recipientsRaw), [recipientsRaw]);
  const rec = recommendation(parsed.valid.length);

  function loadTemplate(tid: string) {
    setSelectedTpl(tid);
    const t = templates.find(x => x.id === tid);
    if (!t) return;
    setSubject(t.subject); setHtml(t.html); setText(t.text);
  }

  async function saveAsTemplate() {
    const tplName = prompt('Save current email as template — name:')?.trim();
    if (!tplName) return;
    try {
      await api('/templates', { method: 'POST', body: { name: tplName, subject, html, text } });
      const r = await api<{ templates: Template[] }>('/templates'); setTemplates(r.templates);
      alert(`Template "${tplName}" saved.`);
    } catch (e: any) {
      alert(e?.message === 'name_taken' ? 'A template with that name already exists.' : (e?.message ?? 'Save failed'));
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const txt = await f.text();
    setRecipientsRaw(prev => (prev.trim() ? prev.trim() + '\n' : '') + txt);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function save(start: boolean) {
    setErr(null);
    const trimmedName = (name || '').trim();
    const trimmedSubject = (subject || '').trim();
    if (!trimmedName) {
      setErr('Campaign name is required.');
      return;
    }
    if (!trimmedSubject) {
      setErr('Subject is required.');
      return;
    }
    // Keep state in sync with what we send
    if (trimmedName !== name) setName(trimmedName);
    if (trimmedSubject !== subject) setSubject(trimmedSubject);
    setSaving(true);
    try {
      const body: any = {
        name: trimmedName, subject: trimmedSubject, from_name: fromName || null, html, text,
        smtp_ids: smtpIds,
        recipients: parsed.valid,
      };
      let cid = id;
      if (cid) await api(`/campaigns/${cid}`, { method: 'PATCH', body });
      else {
        const r = await api<{ id: string }>('/campaigns', { method: 'POST', body });
        cid = r.id;
      }
      if (start && cid) {
        await api(`/campaigns/${cid}/start`, { method: 'POST' });
      }
      nav(cid ? `/campaigns/${cid}` : '/campaigns');
    } catch (e: any) {
      const code = e?.code;
      const m = e?.message;
      const map: Record<string, string> = {
        no_smtp: 'Select at least one SMTP server.',
        no_active_smtp: 'The selected SMTP server is no longer active. Pick another in SMTP Servers.',
        no_recipients: 'Add at least one valid recipient.',
        quota_exhausted: 'Global SMTP quota exhausted. Contact administrator.',
        worker_unavailable: 'Worker unavailable — queue could not accept the campaign. Try again or contact admin.',
        service_unavailable: 'Backend temporarily unreachable. Try again in a moment.',
        bad_state: m || 'Campaign cannot be started in its current state.',
        database_error: m || 'Database error while preparing campaign.',
        validation_error: (() => {
          const issues = (e?.details?.issues || e?.issues) as Array<{ path: string; message: string }> | undefined;
          if (issues && issues.length) return issues.map(i => `${i.path}: ${i.message}`).join('; ');
          return 'Some fields are invalid. Check campaign name, subject and recipients.';
        })(),
      };
      setErr(map[code] ?? (m && m !== 'service_unavailable' ? m : 'Send failed — please retry.'));
    } finally { setSaving(false); }
  }

  const recTone =
    rec.tone === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
    : rec.tone === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
    : 'bg-crimson-500/10 border-crimson-500/30 text-crimson-300';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{id ? 'Edit campaign' : 'New campaign'}</h1>
          <p className="text-sm text-slate-400">Compose a message, paste recipients, pick SMTP servers and send.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-56" value={selectedTpl} onChange={e => loadTemplate(e.target.value)}>
            <option value="">— load template —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button type="button" className="btn-ghost" onClick={saveAsTemplate}>Save as template</button>
        </div>
      </div>

      <GlobalQuotaCard />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="label">Campaign name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="June Newsletter" /></div>
              <div><label className="label">From name</label>
                <input className="input" value={fromName} onChange={e => setFromName(e.target.value)} placeholder="(uses SMTP default if blank)" /></div>
            </div>
            <div><label className="label">Subject</label>
              <input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Welcome {{first_name}}!" /></div>
            <div>
              <label className="label">HTML content</label>
              <textarea className="input font-mono text-xs h-72" value={html} onChange={e => setHtml(e.target.value)} />
            </div>
            <div>
              <label className="label">Plain text (fallback)</label>
              <textarea className="input font-mono text-xs h-32" value={text} onChange={e => setText(e.target.value)} />
            </div>
            <div className="text-xs text-slate-500">
              Available variables: <code>{'{{first_name}}'}</code> <code>{'{{last_name}}'}</code> <code>{'{{email}}'}</code> <code>{'{{company}}'}</code>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="label !mb-0">Recipients</label>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost text-xs" onClick={() => fileRef.current?.click()}>Upload CSV / TXT</button>
                <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden ref={fileRef} onChange={onFile} />
                <button type="button" className="btn-ghost text-xs" onClick={() => setRecipientsRaw('')}>Clear</button>
              </div>
            </div>
            <textarea
              className="input font-mono text-xs h-48"
              placeholder={'one email per line\nemail1@example.com\nemail2@example.com'}
              value={recipientsRaw}
              onChange={e => setRecipientsRaw(e.target.value)}
            />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge-ok">{parsed.valid.length.toLocaleString()} valid</span>
              <span className="badge-err">{parsed.invalid.length.toLocaleString()} invalid</span>
              <span className="badge-muted">{parsed.duplicates.toLocaleString()} duplicates</span>
            </div>
            <div className={`text-xs rounded-lg border px-3 py-2 ${recTone}`}>{rec.text}</div>
            {parsed.invalid.length > 0 && (
              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer">Show invalid entries ({parsed.invalid.length})</summary>
                <pre className="mt-2 max-h-32 overflow-auto bg-ink-950 border border-white/10 rounded p-2">
                  {parsed.invalid.slice(0, 200).join('\n')}
                  {parsed.invalid.length > 200 && '\n…'}
                </pre>
              </details>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <label className="label">SMTP servers (rotated round-robin)</label>
            <div className="space-y-2 max-h-72 overflow-auto">
              {smtps.length === 0 && <div className="text-xs text-slate-500">No active SMTP servers. Add one in SMTP Servers.</div>}
              {smtps.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={smtpIds.includes(s.id)}
                    onChange={e => setSmtpIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(x => x !== s.id))} />
                  <span className="text-slate-200">{s.name}</span>
                  <span className="text-slate-500 text-xs truncate">{s.from_email}</span>
                </label>
              ))}
            </div>
          </div>

          {err && <div className="card text-sm text-crimson-400">{err}</div>}
          {quota?.exhausted && (
            <div className="card text-sm text-crimson-300 border-crimson-500/30">
              Global SMTP quota exhausted. Contact administrator.
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn-ghost flex-1" onClick={() => setPreviewOpen(true)}>Preview</button>
            <button className="btn-ghost flex-1" disabled={saving} onClick={() => save(false)}>Save draft</button>
            <button className="btn-primary w-full" disabled={saving || parsed.valid.length === 0 || smtpIds.length === 0 || quota?.exhausted}
              onClick={() => save(true)}>Send Campaign</button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewOpen(false)}>
          <div className="bg-ink-900 border border-white/10 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="font-semibold">Email preview</div>
              <button className="btn-ghost text-xs" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
            <div className="p-4 border-b border-white/10 text-sm space-y-1 bg-white/[0.02]">
              <div><span className="text-slate-500">From:</span> {fromName || smtps.find(s => smtpIds.includes(s.id))?.from_name || '(SMTP default)'} &lt;{smtps.find(s => smtpIds.includes(s.id))?.from_email ?? '—'}&gt;</div>
              <div><span className="text-slate-500">Subject:</span> {subject || '(no subject)'}</div>
              <div><span className="text-slate-500">SMTP:</span> {smtpIds.length ? smtpIds.map(id => smtps.find(s => s.id === id)?.name).filter(Boolean).join(', ') : '(none selected)'}</div>
              <div><span className="text-slate-500">Recipients:</span> {parsed.valid.length.toLocaleString()}</div>
            </div>
            <div className="flex-1 overflow-auto bg-white">
              <iframe title="preview" className="w-full h-[60vh]" srcDoc={html} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
