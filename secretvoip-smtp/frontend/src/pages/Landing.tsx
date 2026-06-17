import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-crimson-500 to-crimson-700 shadow-glow flex items-center justify-center font-bold">S</div>
          <div>
            <div className="font-bold leading-tight">SecretVoIP SMTP</div>
            <div className="text-xs text-crimson-400 uppercase tracking-widest">Premium Email Infrastructure</div>
          </div>
        </div>
        <Link to="/login" className="btn-primary">Sign in</Link>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-7xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12 items-center w-full">
          <div>
            <div className="inline-block px-3 py-1 rounded-full bg-crimson-500/10 text-crimson-300 text-xs uppercase tracking-widest border border-crimson-500/30 mb-6">
              Enterprise SMTP Platform
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold leading-tight">
              Premium <span className="bg-gradient-to-r from-crimson-400 to-crimson-600 bg-clip-text text-transparent">Email Infrastructure</span>
            </h1>
            <p className="mt-6 text-lg text-slate-400 max-w-lg">
              Multi-account SMTP rotation, real-time campaign progress, deliverability monitoring and quota control — engineered for scale.
            </p>
            <div className="mt-8 flex gap-3">
              <Link to="/login" className="btn-primary px-6 py-3 text-base">Launch Console</Link>
              <a href="#features" className="btn-ghost px-6 py-3 text-base">Learn more</a>
            </div>
          </div>
          <div className="card p-8 shadow-glow">
            <div className="grid grid-cols-2 gap-4 text-center">
              {[
                ['99.9%','Uptime'],
                ['M+','Emails/day'],
                ['Real-time','Progress'],
                ['Zero','Logout drops'],
              ].map(([v,l]) => (
                <div key={l} className="glass p-4 rounded-xl">
                  <div className="text-2xl font-bold text-crimson-400">{v}</div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 py-6 border-t border-white/5">
        © {new Date().getFullYear()} SecretVoIP — Premium Email Infrastructure
      </footer>
    </div>
  );
}
