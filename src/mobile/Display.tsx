import React, { useEffect, useRef, useState } from "react";
import { api, post } from "../api";
import { WhepPlayer } from "./whep";

// DISPLAY — this screen is a Jarvis-controlled surface. Main Jarvis (the PC brain) decides what to
// show and casts it here; the phone just renders it full-bleed and stays live. Two cast kinds for
// v1: a web page Jarvis builds/sends (interactive — you can touch it), or a live stream (the PC
// screen, reusing the Takeover pipe). Nothing here is faked: with no cast it waits.

type Cast =
  | { kind: "web"; url?: string; html?: string; title?: string; at?: number }
  | { kind: "stream"; quality?: string; title?: string; at?: number }
  | { kind: "clear" }
  | null;

export function Display({ active }: { active: boolean }) {
  const [cast, setCast] = useState<Cast>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => new Date());
  const lastKey = useRef("");

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  const clock = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // subscribe to what Jarvis is casting (poll; SSE can layer on later)
  useEffect(() => {
    if (!active) return; let alive = true;
    const pull = async () => {
      try {
        const r = await api<{ cast: Cast }>("/api/display/current");
        if (!alive) return;
        const c = r.cast && (r.cast as any).kind && (r.cast as any).kind !== "clear" ? r.cast : null;
        const key = c ? JSON.stringify(c) : "";
        if (key !== lastKey.current) { lastKey.current = key; setCast(c); }
        setErr("");
      } catch { if (alive) setErr("offline"); }
    };
    void pull(); const t = window.setInterval(pull, 2000);
    return () => { alive = false; window.clearInterval(t); };
  }, [active]);

  const showing = cast && cast.kind !== "clear";

  return (
    <div className={`disp ${showing ? "live" : "idle"}`}>
      {!showing ? (
        <div className="disp-standby">
          <div className="ds-head">
            <div className="ds-head-l"><b>DISPLAY</b><i />Second screen</div>
            <div className={`ds-pill ${err ? "off" : ""}`}><span className={`dp-dot ${err ? "bad" : "ok"}`} />{err ? "Offline" : "Ready"}</div>
          </div>

          <div className="ds-stage">
            <span className="ds-corner tl" /><span className="ds-corner tr" /><span className="ds-corner bl" /><span className="ds-corner br" />
            <div className="ds-stage-top"><span className="ds-tag">STANDBY</span><span className="ds-clock">{clock}</span></div>
            <div className="ds-stage-mid">
              <svg className="ds-mark" viewBox="0 0 24 24" aria-hidden><rect x="3" y="5.5" width="18" height="11" rx="1.4" /><path d="M8.5 20h7M12 16.5V20" /></svg>
              <div className="ds-ready">Ready to receive</div>
              <div className="ds-sub">{err ? "Reconnecting to your PC" : "Jarvis will cast here"}</div>
            </div>
            <span className="ds-scan" />
          </div>

          <div className="ds-foot">
            <div className="ds-foot-l"><small>SOURCE</small><b>Main Jarvis</b></div>
            <div className="ds-foot-r"><span className={`dp-dot ${err ? "bad" : "ok"}`} />{err ? "link down" : "linked"}</div>
          </div>
        </div>
      ) : cast!.kind === "web" ? (
        <WebCast cast={cast as Extract<Cast, { kind: "web" }>} />
      ) : cast!.kind === "stream" ? (
        <StreamCast cast={cast as Extract<Cast, { kind: "stream" }>} />
      ) : null}
    </div>
  );
}

function WebCast({ cast }: { cast: { url?: string; html?: string; title?: string } }) {
  return (
    <div className="disp-web">
      <div className="disp-bar"><span className="disp-bar-dot" /><b>{cast.title || (cast.url ? new URL(cast.url).hostname.replace(/^www\./, "") : "Jarvis")}</b><small>cast by Jarvis</small></div>
      <iframe
        className="disp-frame"
        {...(cast.html ? { srcDoc: cast.html } : { src: cast.url })}
        title={cast.title || "Jarvis cast"}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      />
    </div>
  );
}

function StreamCast({ cast }: { cast: { quality?: string; title?: string } }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState("Connecting video…");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true; let player: WhepPlayer | null = null;
    (async () => {
      try {
        const r = await post<{ ok: boolean; stream: { error?: string }; whep: string }>("/api/device-mesh/stream/start", { quality: cast.quality || "auto" });
        if (!alive) return;
        if (!r.ok || !r.whep) throw new Error(r.stream?.error || "Stream unavailable");
        setMsg("Connecting video…");
        player = new WhepPlayer(videoRef.current!, r.whep, () => {}, (state) => {
          if (!alive) return;
          if (state === "connected" || state === "playing") { setReady(true); setMsg(""); }
        });
      } catch (e) { if (alive) setMsg(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; try { player?.stop?.(); } catch { /* ignore */ } };
  }, [cast.quality]);

  return (
    <div className="disp-stream">
      <video ref={videoRef} className="disp-video" autoPlay playsInline muted />
      {!ready ? <div className="disp-stream-msg">{msg}</div> : null}
      <div className="disp-bar over"><span className="disp-bar-dot live" /><b>{cast.title || "Live from your PC"}</b><small>cast by Jarvis</small></div>
    </div>
  );
}
