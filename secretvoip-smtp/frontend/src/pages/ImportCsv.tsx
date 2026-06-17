import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface List { id: string; name: string }

export default function ImportCsv() {
  const [lists, setLists] = useState<List[]>([]);
  const [listId, setListId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ lists: List[] }>('/contacts/lists').then(r => setLists(r.lists)); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (listId) form.append('list_id', listId);
      const r = await api<{ imported: number; skipped: number; total: number }>('/contacts/import', { method: 'POST', form });
      setResult(r);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Import CSV</h1>
        <p className="text-sm text-slate-400">CSV must include an <code>email</code> column. Optional: <code>first_name</code>, <code>last_name</code>, <code>company</code>.</p>
      </div>

      <form className="card space-y-4" onSubmit={submit}>
        <div>
          <label className="label">Target list</label>
          <select className="input" value={listId} onChange={e => setListId(e.target.value)}>
            <option value="">— no list (unassigned) —</option>
            {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">CSV file</label>
          <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block text-sm text-slate-300" />
        </div>
        <button className="btn-primary" disabled={!file || busy}>{busy ? 'Importing…' : 'Import'}</button>
        {result && (
          <div className="text-sm">
            <span className="text-emerald-300">Imported: {result.imported}</span>
            <span className="text-slate-400 mx-3">Skipped: {result.skipped}</span>
            <span className="text-slate-500">Total rows: {result.total}</span>
          </div>
        )}
      </form>
    </div>
  );
}
