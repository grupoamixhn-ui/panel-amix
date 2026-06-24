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
      <aside className="w-60 border-r border-[var(--border)] bg-[var(--bg)] flex flex-col">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-[var(--border)]">
          <Activity className="w-5 h-5 text-[var(--primary)]" />
          <div>
            <div className="mono text-xs tracking-widest">FLUSSONIC</div>
            <div className="text-[10px] text-[var(--muted)] mono tracking-wider">NOC CONSOLE</div>
          </div>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end, tid }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={tid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-150 border-l-2 ${
                  isActive
                    ? "bg-[var(--surface)] text-white border-[var(--primary)]"
                    : "text-[var(--muted)] hover:text-white hover:bg-[var(--surface)] border-transparent"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <div className="px-2 py-2 flex items-center gap-3">
            <div className="w-8 h-8 bg-[var(--primary)] flex items-center justify-center mono text-xs font-semibold">
              {(user?.email || "A").slice(0,1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate">{user?.email}</div>
              <div className="text-[10px] text-[var(--muted)] mono tracking-wider uppercase">{user?.role}</div>
            </div>
            <button
              data-testid="logout-button"
              onClick={async () => { await logout(); nav("/login"); }}
              className="text-[var(--muted)] hover:text-[var(--error)] transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
