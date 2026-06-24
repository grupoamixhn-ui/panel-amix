import { useEffect, useState } from "react";
import api from "../api";
import PageHeader from "../components/PageHeader";

export default function Settings() {
  const [info, setInfo] = useState(null);
  useEffect(() => { api.get("/server/info").then((r) => setInfo(r.data)); }, []);

  return (
    <div data-testid="settings-page">
      <PageHeader title="Settings" subtitle="SERVER & INTEGRATION" testId="settings-header" />

      <div className="p-8 space-y-6 max-w-3xl">
        <div className="cell p-6">
          <div className="label mb-3">Flussonic Connection</div>
          <div className="space-y-3 mono text-sm">
            <Row k="Mode" v={info?.mode === "demo" ? "DEMO (mock data)" : "LIVE"} accent={info?.mode === "demo" ? "text-[var(--warn)]" : "text-[var(--live)]"} />
            <Row k="Version" v={info?.version || "—"} />
            <Row k="Backend env" v="DEMO_MODE / FLUSSONIC_URL / FLUSSONIC_USER / FLUSSONIC_PASS" />
          </div>
          <p className="mt-4 text-xs text-[var(--muted)] leading-relaxed">
            To connect a real Flussonic Media Server, edit <span className="mono text-white">/app/backend/.env</span>,
            set <span className="mono text-white">DEMO_MODE=&quot;false&quot;</span>, <span className="mono text-white">FLUSSONIC_URL</span>,
            <span className="mono text-white"> FLUSSONIC_USER</span> and <span className="mono text-white">FLUSSONIC_PASS</span>,
            then restart the backend service. The panel will proxy live calls to <span className="mono text-white">/streamer/api/v3</span>.
          </p>
        </div>

        <div className="cell p-6">
          <div className="label mb-3">Supported API surface</div>
          <ul className="space-y-2 mono text-xs text-[var(--muted)]">
            <li><span className="text-white">GET</span> /streamer/api/v3/server</li>
            <li><span className="text-white">GET</span> /streamer/api/v3/streams</li>
            <li><span className="text-white">PUT</span> /streamer/api/v3/streams/&#123;name&#125;</li>
            <li><span className="text-white">DELETE</span> /streamer/api/v3/streams/&#123;name&#125;</li>
            <li><span className="text-white">POST</span> /streamer/api/v3/streams/&#123;name&#125;/restart</li>
            <li><span className="text-white">GET</span> /streamer/api/v3/sessions</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, accent }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] pb-3 last:border-0">
      <span className="text-[var(--muted)]">{k}</span>
      <span className={accent || "text-white"}>{v}</span>
    </div>
  );
}
