import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Play, AlertTriangle, Loader2, RotateCw, Volume2, VolumeX } from "lucide-react";

export default function HlsPlayer({ url, poster }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | loading | playing | error
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(true);
  const [token, setToken] = useState(0); // forces re-init on retry

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return undefined;
    setStatus("loading"); setError("");

    // Native HLS (Safari)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      const onPlaying = () => setStatus("playing");
      const onError = () => { setStatus("error"); setError("Native HLS playback failed (CORS or unreachable)"); };
      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);
      video.play().catch(() => { /* user gesture maybe needed */ });
      return () => {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        video.src = "";
      };
    }

    if (!Hls.isSupported()) {
      setStatus("error"); setError("HLS not supported in this browser");
      return undefined;
    }
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 8 });
    hlsRef.current = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => { /* ignore */ });
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data?.fatal) {
        setStatus("error");
        setError(`${data.type || "error"} · ${data.details || "fatal"}`);
        hls.destroy();
      }
    });
    const onPlaying = () => setStatus("playing");
    video.addEventListener("playing", onPlaying);

    return () => {
      video.removeEventListener("playing", onPlaying);
      try { hls.destroy(); } catch { /* ignore */ }
      hlsRef.current = null;
    };
  }, [url, token]);

  const retry = () => setToken((t) => t + 1);

  return (
    <div className="relative w-full bg-black rounded-xl overflow-hidden aspect-video" data-testid="hls-player">
      <video
        ref={videoRef}
        muted={muted}
        autoPlay
        playsInline
        poster={poster}
        className="w-full h-full object-contain bg-black"
      />

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="ml-2 text-xs mono">Loading stream…</span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-white p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
          <div className="text-sm font-semibold">Preview unavailable</div>
          <div className="text-[11px] mono opacity-70 mt-1 max-w-md break-words">{error}</div>
          <div className="text-[11px] text-white/50 mt-3 max-w-md leading-relaxed">
            Usually means the stream isn&apos;t live, or your Flussonic doesn&apos;t allow CORS on HLS for this origin.
            Copy the URL and open it in VLC / ffplay to verify.
          </div>
          <button onClick={retry} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs">
            <RotateCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* Controls overlay */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <span className={`pill ${status === "playing" ? "pill-live" : "pill-off"} backdrop-blur bg-black/40 border-white/20 text-white`}>
          {status === "playing" ? <><span className="dot dot-live" /> LIVE</> : status.toUpperCase()}
        </span>
      </div>
      <button
        onClick={() => setMuted((m) => !m)}
        className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur flex items-center justify-center text-white"
        title={muted ? "Unmute" : "Mute"}
        data-testid="hls-mute-toggle"
      >
        {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
