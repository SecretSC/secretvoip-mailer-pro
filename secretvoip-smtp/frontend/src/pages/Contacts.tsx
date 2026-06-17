import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface List { id: string; name: string; description?: string; count: string }
interface Contact { id: string; email: string; first_name?: string; last_name?: string; company?: string; list_id?: string }

export default function Contacts() {
  const [lists, setLists] = useState<List[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [active, setActive] = useState<string>('');
  const [newList, setNewList] = useState('');
  const [search, setSearch] = useState('');

  async function loadLists() { const r = await api<{ lists: List[] }>('/contacts/lists'); setLists(r.lists); }
  async function loadContacts() {
    const r = await api<{ contacts: Contact[] }>('/contacts', { query: { list_id: active || undefined, search } });
    setContacts(r.contacts);
  }
  useEffect(() => { loadLists(); }, []);
  useEffect(() => { loadContacts(); }, [active, search]);

  async function createList() {
    if (!newList.trim()) return;
    await api('/contacts/lists', { method: 'POST', body: { name: newList.trim() } });
    setNewList(''); await loadLists();
  }
  async function deleteList(id: string) {
    if (!confirm('Delete list and all its contacts?')) return;
    await api(`/contacts/lists/${id}`, { method: 'DELETE' });
    if (active === id) setActive('');
    await loadLists(); await loadContacts();
  }
  async function deleteContact(id: string) {
    await api(`/contacts/${id}`, { method: 'DELETE' }); await loadContacts();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="text-sm text-slate-400">Organize recipients into lists for campaign sending.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-3">
          <div className="card space-y-2">
            <div className="font-semibold">Lists</div>
            <button onClick={() => setActive('')} className={`w-full text-left px-2 py-1.5 rounded-lg text-sm ${active === '' ? 'bg-crimson-500/10 text-white' : 'text-slate-300 hover:bg-white/5'}`}>All contacts</button>
            {lists.map(l => (
              <div key={l.id} className="flex items-center gap-1">
                <button onClick={() => setActive(l.id)} className={`flex-1 text-left px-2 py-1.5 rounded-lg text-sm ${active === l.id ? 'bg-crimson-500/10 text-white' : 'text-slate-300 hover:bg-white/5'}`}>
                  {l.name} <span className="text-slate-500 text-xs">({l.count})</span>
                </button>
                <button className="text-slate-500 hover:text-crimson-400 text-xs px-2" onClick={() => deleteList(l.id)}>✕</button>
              </div>
            ))}
            <div className="pt-3 flex gap-2">
              <input className="input" placeholder="New list…" value={newList} onChange={e => setNewList(e.target.value)} />
              <button className="btn-primary" onClick={createList}>＋</button>
            </div>
          </div>
        </div>

        <div className="md:col-span-3 space-y-3">
          <input className="input" placeholder="Search by email…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-slate-400 uppercase tracking-wider text-xs">
                <tr>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Company</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {contacts.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500 p-6">No contacts. Import a CSV to get started.</td></tr>}
                {contacts.map(c => (
                  <tr key={c.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2">{c.email}</td>
                    <td className="px-4 py-2 text-slate-300">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-4 py-2 text-slate-300">{c.company ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button className="text-slate-500 hover:text-crimson-400 text-xs" onClick={() => deleteContact(c.id)}>delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
