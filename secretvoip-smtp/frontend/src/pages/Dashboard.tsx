import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import GlobalQuotaCard from '../components/GlobalQuotaCard';
import UserQuotaCard from '../components/UserQuotaCard';

interface Dash {
  stats: { sent: number; failed: number; active_campaigns: number; smtp_servers: number; success_rate: number };
  daily: Array<{ day: string; sent_count: number }>;
}

function Card({ title, value, sub }: { title: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-slate-400">{title}</div>
      <div className="text-3xl font-bold mt-2">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { api<Dash>('/dashboard').then(setD).catch(() => {}); }, []);
  if (!d) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-400">Operational overview of your sending infrastructure.</p>
      </div>

      <GlobalQuotaCard />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Emails Sent" value={d.stats.sent.toLocaleString()} />
        <Card title="Emails Failed" value={d.stats.failed.toLocaleString()} />
        <Card title="Active Campaigns" value={d.stats.active_campaigns} />
        <Card title="SMTP Servers" value={d.stats.smtp_servers} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Delivery rate</div>
          <div className="text-3xl font-bold text-crimson-400">{d.stats.success_rate}%</div>
        </div>
        <div className="text-xs text-slate-500 mb-3">Across all-time email logs.</div>
      </div>

      <div className="card">
        <div className="text-sm font-semibold mb-3">Last 30 days</div>
        <div className="grid grid-cols-15 sm:grid-cols-30 gap-1 h-32 items-end">
          {(() => {
            const max = Math.max(1, ...d.daily.map(x => x.sent_count));
            return d.daily.map(x => (
              <div key={x.day} title={`${x.day}: ${x.sent_count}`}
                   className="bg-gradient-to-t from-crimson-700 to-crimson-400 rounded-sm"
                   style={{ height: `${(x.sent_count / max) * 100}%`, minHeight: '2px' }} />
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
