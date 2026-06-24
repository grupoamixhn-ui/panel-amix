import { useEffect, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";
import { Zap, Cable } from "lucide-react";

export default function Settings() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.get("/server/info")
      .then((r) => setInfo(r.data))
      .catch((e) => console.error("settings load failed", e));
  }, []);

  return (
    <div data-testid="settings-page">
      <PageHeader title="Settings" subtitle="Server & integration" testId="settings-header" />

      <div className="p-8 space-y-6 max-w-3xl">
        <div className="cell p-6" data-testid="settings-connection">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
              <Cable className="w-4.5 h-4.5 text-[var(--primary)]" />
            </div>
            <div>
              <div className="font-semibold text-sm">Flussonic connection</div>
              <div className="text-xs text-[var(--muted)]">Switch between demo and live mode</div>
            </div>
          </div>

          <div className="space-y-0">
            <Row k="Mode" v={info?.mode === "demo" ? "DEMO · mock data" : "LIVE"} accent={info?.mode === "demo" ? "text-[var(--warn)]" : "text-[var(--live)]"} />
            <Row k="Version" v={info?.version || "—"} mono />
            <Row k="Backend env keys" v="DEMO_MODE · FLUSSONIC_URL · FLUSSONIC_USER · FLUSSONIC_PASS" mono />
          </div>

          <p className="mt-5 text-xs text-[var(--muted)] leading-relaxed">
            To connect a real Flussonic Media Server, edit <span className="mono text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">/app/backend/.env</span>,
            set <span className="mono text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">DEMO_MODE=&quot;false&quot;</span>, fill in <span className="mono text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">FLUSSONIC_URL</span>, <span className="mono text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">FLUSSONIC_USER</span> and <span className="mono text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">FLUSSONIC_PASS</span>,
            then restart the backend. The panel will proxy calls to <span className="mono text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">/streamer/api/v3</span>.
          </p>
        </div>

        <div className="cell p-6" data-testid="settings-api">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-[var(--primary-soft)] flex items-center justify-center">
              <Zap className="w-4.5 h-4.5 text-[var(--primary)]" />
            </div>
            <div>
              <div className="font-semibold text-sm">Supported API surface</div>
              <div className="text-xs text-[var(--muted)]">Flussonic v3 admin endpoints proxied by this panel</div>
            </div>
          </div>
          <ul className="space-y-1.5 mono text-xs">
            {[
              ["GET", "/streamer/api/v3/server"],
              ["GET", "/streamer/api/v3/streams"],
              ["PUT", "/streamer/api/v3/streams/{name}"],
              ["DELETE", "/streamer/api/v3/streams/{name}"],
              ["POST", "/streamer/api/v3/streams/{name}/restart"],
              ["GET", "/streamer/api/v3/sessions"],
            ].map(([m, p]) => (
              <li key={p} className="flex items-center gap-3 py-1.5 border-b border-[var(--border)] last:border-0">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${m === "GET" ? "bg-blue-50 text-blue-700" : m === "POST" ? "bg-emerald-50 text-emerald-700" : m === "PUT" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{m}</span>
                <span className="text-[var(--text-2)]">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, accent, mono }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] py-3 last:border-0">
      <span className="text-sm text-[var(--muted)]">{k}</span>
      <span className={`text-sm ${mono ? "mono" : ""} ${accent || "text-[var(--text)] font-medium"}`}>{v}</span>
    </div>
  );
}
