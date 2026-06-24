import { useAlerts } from "../alerts";
import PageHeader from "../components/PageHeader";
import { CheckCircle2, BellOff, BellRing } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function Alerts() {
  const { alerts, ack, dismiss } = useAlerts();
  const unacked = alerts.filter((a) => !a.acked);
  const acked = alerts.filter((a) => a.acked);

  return (
    <div data-testid="alerts-page">
      <PageHeader
        title="Active alerts"
        subtitle="Streams currently in error / idle state"
        testId="alerts-header"
        right={
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            alerts.length === 0
              ? "bg-[var(--live-soft)] border-[#BBF7D0] text-[#15803D]"
              : "bg-[var(--error-soft)] border-[#FECACA] text-[var(--error)]"
          }`}>
            {alerts.length === 0
              ? <><CheckCircle2 className="w-3.5 h-3.5" /><span className="text-xs font-semibold">All clear</span></>
              : <><BellRing className="w-3.5 h-3.5" /><span className="text-xs font-semibold">{alerts.length} active · {unacked.length} unread</span></>}
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {alerts.length === 0 && (
          <div className="cell p-14 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[var(--live)] opacity-70" />
            <h3 className="text-lg font-semibold mb-1">No active alerts</h3>
            <p className="text-sm text-[var(--muted)]">All your streams are healthy.</p>
          </div>
        )}

        {alerts.map((a) => (
          <div
            key={a.stream}
            data-testid={`alert-row-${a.stream}`}
            className={`cell p-5 border-l-4 ${a.acked ? "border-l-[var(--muted-2)] opacity-70" : "border-l-[var(--error)]"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <span className={`dot mt-1.5 ${a.acked ? "dot-warn" : "dot-error"}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">{a.stream}</span>
                    {a.title && a.title !== a.stream && (
                      <span className="text-xs text-[var(--muted)]">· {a.title}</span>
                    )}
                    <span className="pill pill-error">{a.status}</span>
                    {a.acked && <span className="pill pill-warn">acknowledged</span>}
                  </div>
                  <div className="text-xs text-[var(--text-2)] mt-1">{a.message}</div>
                  {a.source && (
                    <div className="text-[11px] text-[var(--muted)] mono mt-1 truncate" title={a.source}>{a.source}</div>
                  )}
                  <div className="text-[11px] text-[var(--muted)] mt-1.5">
                    Down for <span className="font-semibold text-[var(--text-2)]">{timeAgo(a.down_since)}</span> · since {new Date(a.down_since).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!a.acked && (
                  <button
                    onClick={() => ack(a.stream)}
                    className="btn btn-ghost"
                    data-testid={`alert-ack-${a.stream}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Acknowledge
                  </button>
                )}
                <button
                  onClick={() => dismiss(a.stream)}
                  className="btn-icon"
                  title="Dismiss (will reappear if still down)"
                  data-testid={`alert-dismiss-${a.stream}`}
                >
                  <BellOff className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
