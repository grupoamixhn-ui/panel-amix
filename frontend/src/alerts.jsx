import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import api from "./api";

const AlertsContext = createContext({ alerts: [], unread: 0, ack: () => {}, dismiss: () => {} });

// Tiny embedded beep — generated via Web Audio API; no asset needed.
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch { /* ignore */ }
}

export function AlertsProvider({ children, enabled }) {
  const [alerts, setAlerts] = useState([]);
  const [toast, setToast] = useState(null);
  const seenRef = useRef(new Set());
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/alerts");
      const data = r.data || [];
      // detect new ones
      const ids = new Set(data.map((a) => a.stream));
      if (initializedRef.current) {
        const fresh = data.filter((a) => !seenRef.current.has(a.stream));
        if (fresh.length > 0) {
          beep();
          setToast({ items: fresh, ts: Date.now() });
          setTimeout(() => setToast(null), 6000);
        }
      }
      seenRef.current = ids;
      initializedRef.current = true;
      setAlerts(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [enabled, load]);

  const ack = useCallback(async (name) => {
    try { await api.post(`/alerts/${name}/ack`); load(); } catch { /* ignore */ }
  }, [load]);

  const dismiss = useCallback(async (name) => {
    try { await api.delete(`/alerts/${name}`); load(); } catch { /* ignore */ }
  }, [load]);

  const unread = alerts.filter((a) => !a.acked).length;

  return (
    <AlertsContext.Provider value={{ alerts, unread, ack, dismiss }}>
      {children}
      {toast && (
        <div className="fixed top-6 right-6 z-[60] w-80 cell shadow-[var(--shadow-lg)] border-l-4 border-l-[var(--error)] p-4" data-testid="alert-toast">
          <div className="flex items-start gap-2">
            <span className="dot dot-error mt-1.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {toast.items.length === 1 ? "Stream alert" : `${toast.items.length} streams down`}
              </div>
              <div className="text-xs text-[var(--muted)] mt-0.5">
                {toast.items.slice(0, 3).map((a) => a.stream).join(", ")}
                {toast.items.length > 3 && ` +${toast.items.length - 3} more`}
              </div>
            </div>
          </div>
        </div>
      )}
    </AlertsContext.Provider>
  );
}

export const useAlerts = () => useContext(AlertsContext);
