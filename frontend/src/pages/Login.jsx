import { useState } from "react";
import { useAuth } from "../auth";
import { useBranding } from "../branding";
import { Activity, ArrowRight } from "lucide-react";

export default function Login() {
  const { login, error } = useAuth();
  const { logo_data_uri, brand_name, tagline } = useBranding();
  const [email, setEmail] = useState("admin@flussonic.io");
  const [password, setPassword] = useState("admin123");
  const [busy, setBusy] = useState(false);

  const displayBrand = brand_name || "Flussonic";
  const displayTagline = tagline || "NOC Console";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await login(email, password);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex relative z-10" data-testid="login-page">
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--bg)] order-2 lg:order-1">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="flex items-center gap-3 mb-12">
            {logo_data_uri ? (
              <img src={logo_data_uri} alt={displayBrand} className="h-14 max-w-[200px] object-contain" data-testid="login-logo" />
            ) : (
              <>
                <div className="w-9 h-9 rounded-xl bg-[var(--primary)] flex items-center justify-center shadow-md">
                  <Activity className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-tight">{displayBrand}</div>
                  <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">{displayTagline}</div>
                </div>
              </>
            )}
          </div>

          <h2 className="text-3xl font-semibold tracking-tight mb-1" data-testid="login-title">{displayBrand}</h2>
          <p className="text-sm text-[var(--muted)] mb-10">{displayTagline}</p>

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
        </form>
      </div>

      <div className="hidden lg:flex flex-1 relative overflow-hidden order-1 lg:order-2 bg-[#0B0F19]">
        <img
          src="https://images.pexels.com/photos/17323801/pexels-photo-17323801.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1200"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
    </div>
  );
}
