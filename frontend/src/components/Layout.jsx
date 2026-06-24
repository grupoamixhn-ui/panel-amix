import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import {
  Activity, LayoutDashboard, Radio, Users, BarChart3, Terminal, LogOut, Settings,
} from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, tid: "nav-dashboard" },
  { to: "/streams", label: "Streams", icon: Radio, tid: "nav-streams" },
  { to: "/sessions", label: "Sessions", icon: Users, tid: "nav-sessions" },
  { to: "/stats", label: "Statistics", icon: BarChart3, tid: "nav-stats" },
  { to: "/logs", label: "Logs", icon: Terminal, tid: "nav-logs" },
  { to: "/settings", label: "Settings", icon: Settings, tid: "nav-settings" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex relative z-10">
      <aside className="w-64 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-xl bg-[var(--primary)] flex items-center justify-center shadow-md">
            <Activity className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">Flussonic</div>
            <div className="text-[10px] mono uppercase tracking-widest text-[var(--muted)]">NOC Console</div>
          </div>
        </div>

        <div className="px-3 pt-4 pb-2 label">Workspace</div>
        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end, tid }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={tid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-all duration-150 ${
                  isActive
                    ? "bg-[var(--primary-soft)] text-[var(--primary)] font-medium"
                    : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                }`
              }
            >
              <Icon className="w-4 h-4" strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="m-3 mt-2 p-3 rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--primary-soft)] to-white">
          <div className="text-xs font-semibold text-[var(--text)] mb-0.5">Demo mode active</div>
          <div className="text-[11px] text-[var(--muted)] leading-snug">Connect a real Flussonic server in Settings.</div>
        </div>

        <div className="border-t border-[var(--border)] p-3">
          <div className="px-2 py-1.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--primary)] to-[#7C3AED] flex items-center justify-center text-white text-xs font-semibold">
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
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden bg-[var(--bg)]">{children}</main>
    </div>
  );
}
