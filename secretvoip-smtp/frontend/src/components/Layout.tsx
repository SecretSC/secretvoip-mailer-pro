import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

function Item({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
          isActive
            ? 'bg-crimson-500/15 text-white border border-crimson-500/30'
            : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
        }`
      }
    >
      <span className="w-5 text-center text-base">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex w-64 flex-col gap-1 p-4 border-r border-white/5 bg-ink-900/60 backdrop-blur-xl">
        <div className="px-2 py-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-crimson-500 to-crimson-700 shadow-glow flex items-center justify-center font-bold">S</div>
            <div>
              <div className="font-semibold leading-tight">SecretVoIP</div>
              <div className="text-[10px] uppercase tracking-widest text-crimson-400">SMTP Platform</div>
            </div>
          </div>
        </div>

        <Item to="/dashboard" label="Dashboard" icon="◆" />
        <Item to="/campaigns" label="Campaigns" icon="✦" />
        <Item to="/templates" label="Templates" icon="❐" />
        <Item to="/transmission" label="Transmission Log" icon="≡" />
        <Item to="/smtp" label="SMTP Servers" icon="✉" />
        <Item to="/settings" label="Settings" icon="⚙" />
        <Item to="/profile" label="Profile" icon="◉" />
        {user?.role === 'admin' && (
          <>
            <div className="mt-3 mb-1 px-3 text-[10px] uppercase tracking-widest text-slate-500">Admin</div>
            <Item to="/admin/users" label="User Management" icon="◈" />
            <Item to="/admin/diagnostics" label="Diagnostics" icon="◐" />
            <Item to="/admin/audit" label="Audit Logs" icon="❒" />
          </>
        )}

        <div className="mt-auto pt-4">
          <div className="px-3 py-2 text-xs text-slate-400">
            <div className="font-medium text-slate-200">{user?.username}</div>
            <div className="capitalize">{user?.role}</div>
          </div>
          <button className="btn-ghost w-full" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between p-4 border-b border-white/5">
          <div className="font-semibold">SecretVoIP SMTP</div>
          <button className="btn-ghost text-xs" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
        </div>
        <div className="p-4 md:p-8 max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
