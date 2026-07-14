import { useCallback, useEffect, useRef, useState } from "react";
import type { SynChannel } from "./synChannel";
import { SynCall, type CallState } from "./synCall";

// Synapse W6 — the call panel (Zone D). Voice by default, optional camera + screen-share. Media
// runs over a second WebRTC PeerConnection; if capture is denied it fails gracefully and the rest
// of the room keeps working. Push-to-talk: hold Space while connected.

export function CallPanel({ channelRef, callRef, sessionId, polite, onActive }: {
  channelRef: React.MutableRefObject<SynChannel | null>;
  callRef: React.MutableRefObject<SynCall | null>;
  sessionId: string;
  polite: boolean;
  onActive?: (active: boolean) => void;
}) {
  const [state, setState] = useState<CallState>("idle");
  const [detail, setDetail] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [ptt, setPtt] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  const join = useCallback(async (video: boolean) => {
    if (!channelRef.current) { setState("failed"); setDetail("No live channel."); return; }
    const call = new SynCall(channelRef.current, sessionId, polite, {
      onState: (s, d) => { setState(s); if (d) setDetail(d); onActive?.(s === "connected"); },
      onLocalStream: (s) => { if (localRef.current) localRef.current.srcObject = s; },
      onRemoteStream: (s) => { if (remoteRef.current) remoteRef.current.srcObject = s; setHasRemote(true); },
    });
    callRef.current = call;
    await call.join({ video });
  }, [channelRef, callRef, sessionId, polite]);

  const leave = useCallback(() => { callRef.current?.leave(); callRef.current = null; setState("idle"); setHasRemote(false); setDetail(""); onActive?.(false); }, [callRef, onActive]);

  // Push-to-talk: mic muted unless explicitly on or Space held (only while connected).
  useEffect(() => {
    if (state !== "connected") return;
    callRef.current?.setMicEnabled(micOn || ptt);
  }, [state, micOn, ptt, callRef]);
  useEffect(() => {
    if (state !== "connected") return;
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !(e.target as HTMLElement)?.matches?.("input,textarea")) { e.preventDefault(); setPtt(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setPtt(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [state]);

  const active = state === "joining" || state === "connected";

  return (
    <section className={`syn-panel syn-call ${state === "connected" ? "is-oncall" : ""}`}>
      <header><span className="lbl">Call</span><strong>{state === "connected" ? "on air" : state === "joining" ? "connecting…" : "voice · video · screen"}</strong></header>
      <div className="syn-scroll">
        {!active && (
          <>
            <div className="syn-avatar jarvis" style={{ width: 46, height: 46, fontSize: 18 }}>◆</div>
            {state === "failed" && <div className="syn-soon" style={{ borderColor: "var(--syn-danger)" }}>{detail || "Call failed."}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="syn-btn primary sm" onClick={() => join(false)}>Join (voice)</button>
              <button className="syn-btn sm" onClick={() => join(true)}>+ video</button>
            </div>
            <div className="syn-soon" style={{ fontSize: 10 }}>Both parties join to connect · no recording</div>
          </>
        )}
        {active && (
          <>
            <div className="syn-call-grid">
              <div className="syn-tile"><video ref={localRef} autoPlay playsInline muted /><span className="syn-tile-lbl">You{ptt ? " · PTT" : micOn ? "" : " · muted"}</span></div>
              <div className="syn-tile"><video ref={remoteRef} autoPlay playsInline />{!hasRemote && <div className="syn-tile-wait">waiting for peer…</div>}<span className="syn-tile-lbl">Collaborator</span></div>
            </div>
            <div className="syn-call-bar">
              <button className={`syn-btn sm ${micOn ? "" : "danger"}`} onClick={() => setMicOn((v) => !v)} title="Toggle mic (or hold Space for push-to-talk)">{micOn ? "🎙" : "🔇"}</button>
              <button className="syn-btn sm" onClick={() => callRef.current?.shareScreen()} title="Share screen">🖥</button>
              <button className="syn-btn danger sm" onClick={leave} title="Leave call">Leave</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
