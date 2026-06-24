import { useState } from "react";
import { useAuth } from "../auth";
import { Activity } from "lucide-react";

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
    <div className="min-h-screen flex" data-testid="login-page">
      {/* Left visual */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden border-r border-[var(--border)]">
        <img
          src="https://images.pexels.com/photos/17323801/pexels-photo-17323801.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1200"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black via-black/40 to-transparent" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-[var(--primary)]" />
            <span className="mono text-sm tracking-widest">FLUSSONIC // NOC</span>
          </div>
          <div>
            <div className="label mb-3">Control Console</div>
            <h1 className="text-5xl font-bold leading-tight tracking-tight">
              Stream operations,<br/>
              <span className="text-[var(--primary)]">precisely</span> orchestrated.
            </h1>
            <p className="mt-6 text-[var(--muted)] max-w-md">
              Real-time visibility into every stream, session, byte and event flowing through your Flussonic Media Server.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6 mono text-xs text-[var(--muted)]">
            <div><div className="label">Region</div><div className="text-white mt-1">us-east-1</div></div>
            <div><div className="label">API</div><div className="text-white mt-1">v3.admin</div></div>
            <div><div className="label">Build</div><div className="text-white mt-1">24.03.demo</div></div>
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <Activity className="w-5 h-5 text-[var(--primary)]" />
            <span className="mono text-sm tracking-widest">FLUSSONIC // NOC</span>
          </div>
          <div className="label mb-2">Authenticate</div>
          <h2 className="text-2xl font-semibold mb-8">Sign in to your console</h2>

          <label className="label block">Email</label>
          <input
            data-testid="login-email-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-2 mb-5 px-3 py-2.5 bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--primary)] mono text-sm"
            required
          />
          <label className="label block">Password</label>
          <input
            data-testid="login-password-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-2 mb-6 px-3 py-2.5 bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--primary)] mono text-sm"
            required
          />

          {error && (
            <div data-testid="login-error" className="mb-4 px-3 py-2 border border-[var(--error)] text-[var(--error)] text-xs mono">
              {error}
            </div>
          )}

          <button
            data-testid="login-submit-button"
            disabled={busy}
            className="w-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white py-2.5 font-medium tracking-wide transition-colors duration-150"
          >
            {busy ? "Authenticating…" : "Sign In →"}
          </button>

          <div className="mt-10 pt-6 border-t border-[var(--border)] text-xs text-[var(--muted)] mono">
            <div>default: admin@flussonic.io / admin123</div>
          </div>
        </form>
      </div>
    </div>
  );
}
