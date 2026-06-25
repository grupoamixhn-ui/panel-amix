import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useBranding } from "../branding";
import api from "../api";
import {
  Activity, LayoutDashboard, Radio, Users, BarChart3, LogOut, Settings, ShieldCheck, Gauge, Menu, X, ArrowUpCircle, Send,
} from "lucide-react";

const ALL_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, tid: "nav-dashboard", roles: ["admin", "reseller", "client"] },
  { to: "/streams", label: "Streams", icon: Radio, tid: "nav-streams", roles: ["admin", "reseller", "client"] },
  { to: "/pushes", label: "Social pushes", icon: Send, tid: "nav-pushes", roles: ["admin", "reseller", "client"] },
  { to: "/sessions", label: "Sessions", icon: Users, tid: "nav-sessions", roles: ["admin", "reseller", "client"] },
  { to: "/monitor", label: "Monitor", icon: Gauge, tid: "nav-monitor", roles: ["admin", "reseller"] },
  { to: "/stats", label: "Statistics", icon: BarChart3, tid: "nav-stats", roles: ["admin", "reseller", "client"] },
  { to: "/resellers", label: "Resellers", icon: ShieldCheck, tid: "nav-resellers", roles: ["admin", "reseller"] },
  { to: "/settings", label: "Settings", icon: Settings, tid: "nav-settings", roles: ["admin"] },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { logo_data_uri, brand_name, tagline } = useBranding();
  const nav = useNavigate();
  const location = useLocation();
  const displayBrand = brand_name || "Flussonic";
  const displayTagline = tagline || "NOC Console";
  const [info, setInfo] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const load = () => api.get("/server/info").then((r) => setInfo(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  // Poll update status (admin only). Light-weight: ~once every 5 min.
  useEffect(() => {
    if (user?.role !== "admin") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await api.get("/updates/status");
        if (!cancelled) setUpdateAvailable(!!r.data?.update_available);
      } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.role]);

  // Close mobile drawer on route change + lock body scroll while open
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const connected = !!info?.streams_total || info?.mode === "live";
  const navItems = ALL_NAV.filter((n) => n.roles.includes(user?.role || "admin"));
  const currentTitle = navItems.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label || "Dashboard";

  const SidebarBody = (
    <>
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[var(--border)]">
        {logo_data_uri ? (
          <img src={logo_data_uri} alt={displayBrand} className="h-10 max-w-[180px] object-contain" data-testid="sidebar-logo" />
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
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto md:hidden p-1.5 rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
          data-testid="mobile-drawer-close"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-3 pt-4 pb-2 label">Workspace</div>
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon, end, tid }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            data-testid={tid}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-all duration-150 ${
                isActive
                  ? "bg-[var(--primary-soft)] text-[var(--primary)] font-medium"
                  : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"
              }`
            }
          >
            <Icon className="w-4 h-4" strokeWidth={2} />
            <span className="flex-1">{label}</span>
            {to === "/settings" && updateAvailable && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--primary)] text-white text-[9px] font-bold uppercase tracking-wider"
                title="Panel update available"
                data-testid="nav-update-badge"
              >
                <ArrowUpCircle className="w-2.5 h-2.5" />
                NEW
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={`m-3 mt-2 p-3 rounded-xl border ${
        connected
          ? "border-[#BBF7D0] bg-gradient-to-br from-[var(--live-soft)] to-white"
          : "border-[var(--border)] bg-gradient-to-br from-[var(--primary-soft)] to-white"
      }`}>
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`dot ${connected ? "dot-live" : "dot-warn"}`} />
          <div className="text-xs font-semibold text-[var(--text)]">
            {connected ? "Live · connected" : "Not connected"}
          </div>
        </div>
        <div className="text-[11px] text-[var(--muted)] leading-snug">
          {connected
            ? `${info?.streams_live ?? 0}/${info?.streams_total ?? 0} streams · ${info?.clients ?? 0} viewers`
            : "Connect a real Flussonic server in Settings."}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="px-2 py-1.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--primary)] to-[#7C3AED] flex items-center justify-center text-white text-xs font-semibold shrink-0">
            {(user?.email || "A").slice(0,1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{user?.email}</div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">{user?.role}</div>
          </div>
          <button
            data-testid="logout-button"
            onClick={async () => { await logout(); nav("/login"); }}
            className="text-[var(--muted)] hover:text-[var(--error)] transition-colors p-1"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex relative z-10">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 border-r border-[var(--border)] bg-[var(--surface)] flex-col">
        {SidebarBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          data-testid="mobile-drawer-overlay"
        />
      )}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        data-testid="mobile-drawer"
        aria-hidden={!mobileOpen}
      >
        {SidebarBody}
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden bg-[var(--bg)]">
        {/* Mobile top bar with hamburger */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-[var(--surface)]/95 backdrop-blur-md border-b border-[var(--border)]">
          <button
            onClick={() => setMobileOpen(true)}
            data-testid="mobile-menu-btn"
            className="p-2 -ml-1 rounded-lg text-[var(--text-2)] hover:bg-[var(--surface-2)] active:scale-95 transition"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          {logo_data_uri ? (
            <img src={logo_data_uri} alt={displayBrand} className="h-7 max-w-[120px] object-contain" />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-[var(--primary)] flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{currentTitle}</div>
          </div>
          <span className={`dot ${connected ? "dot-live" : "dot-warn"}`} />
        </div>
        {children}
      </main>
    </div>
  );
}
