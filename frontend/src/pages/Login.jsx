import { useState } from "react";
import { useAuth } from "../auth";
import { Activity, ArrowRight } from "lucide-react";

export default function Login() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("admin@flussonic.io");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await login(email, password);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex relative z-10" data-testid="login-page">
      {/* Right form (primary, light) */}
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--bg)] order-2 lg:order-1">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="flex items-center gap-2.5 mb-12">
            <div className="w-9 h-9 rounded-xl bg-[var(--primary)] flex items-center justify-center shadow-md">
              <Activity className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Flussonic</div>
              <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">NOC Console</div>
            </div>
          </div>

          <h2 className="text-3xl font-semibold tracking-tight mb-1">Welcome back</h2>
          <p className="text-sm text-[var(--muted)] mb-10">Sign in to your media operations console.</p>

          <label className="text-xs font-medium text-[var(--text-2)] block mb-1.5">Email</label>
          <input
            data-testid="login-email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm mb-5"
            required
          />

          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-[var(--text-2)]">Password</label>
            <a className="text-xs text-[var(--primary)] hover:underline cursor-pointer">Forgot?</a>
          </div>
          <input
            data-testid="login-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm mb-6"
            required
          />

          {error && (
            <div data-testid="login-error" className="mb-4 px-3 py-2 rounded-lg bg-[var(--error-soft)] border border-[#FECACA] text-[var(--error)] text-xs">
              {error}
            </div>
          )}

          <button
            data-testid="login-submit-button"
            disabled={busy}
            className="btn btn-primary w-full justify-center py-2.5 text-sm"
          >
            {busy ? "Authenticating…" : (<>Sign in <ArrowRight className="w-4 h-4" /></>)}
          </button>

          <div className="mt-10 pt-5 border-t border-[var(--border)] text-xs text-[var(--muted)] mono">
            Demo · admin@flussonic.io / admin123
          </div>
        </form>
      </div>

      {/* Left visual (dark accent) */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden order-1 lg:order-2 bg-[#0B0F19]">
        <img
          src="https://images.pexels.com/photos/17323801/pexels-photo-17323801.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1200"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0B0F19]/95 via-[#0B0F19]/60 to-transparent" />
        <div className="relative z-10 flex flex-col justify-between p-14 w-full text-white">
          <div className="flex items-center gap-2 mono text-xs tracking-[0.25em] text-white/70">
            <span className="dot dot-live" /> v24.03 · STREAMER API
          </div>

          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur text-[11px] mono uppercase tracking-wider mb-6">
              Control Console
            </div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
              Stream operations,<br/>
              <span className="bg-gradient-to-r from-blue-300 to-cyan-200 bg-clip-text text-transparent">orchestrated precisely.</span>
            </h1>
            <p className="mt-6 text-white/70 max-w-md text-sm leading-relaxed">
              Real-time visibility into every stream, session, byte and event flowing through your Flussonic Media Server.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-6 mono text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/50">Region</div>
              <div className="mt-1.5">us-east-1</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/50">API</div>
              <div className="mt-1.5">v3.admin</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/50">Build</div>
              <div className="mt-1.5">24.03.demo</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
