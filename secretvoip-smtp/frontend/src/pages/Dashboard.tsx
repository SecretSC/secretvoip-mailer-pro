import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Dash {
  quota: { daily_limit: number; monthly_limit: number; daily_used: number; monthly_used: number; daily_remaining: number; monthly_remaining: number };
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

function Bar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-crimson-500 to-crimson-700" style={{ width: `${pct}%` }} />
      </div>
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

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Emails Sent" value={d.stats.sent.toLocaleString()} />
        <Card title="Emails Failed" value={d.stats.failed.toLocaleString()} />
        <Card title="Active Campaigns" value={d.stats.active_campaigns} />
        <Card title="SMTP Servers" value={d.stats.smtp_servers} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-4">
          <div className="text-sm font-semibold">Quota usage</div>
          <Bar used={d.quota.daily_used} limit={d.quota.daily_limit} label="Daily" />
          <Bar used={d.quota.monthly_used} limit={d.quota.monthly_limit} label="Monthly" />
        </div>
        <div className="card">
          <div className="text-sm font-semibold mb-3">Delivery rate</div>
          <div className="text-5xl font-bold text-crimson-400">{d.stats.success_rate}%</div>
          <div className="text-xs text-slate-500 mt-1">across all-time email logs</div>
        </div>
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
