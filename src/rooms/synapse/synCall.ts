// Synapse W6 — the call. A SECOND WebRTC PeerConnection (media only), signalled over SynChannel
// with a "call" tag so it never collides with the data-channel RTC. Fetches ephemeral TURN creds
// (W2), captures mic/optional camera/screen, and uses perfect-negotiation so host+guest converge.
// Media failure is isolated: if getUserMedia is denied the call fails gracefully and the data-plane
// collaboration is unaffected. No auto-recording; joining is the consent act.

import type { SynChannel } from "./synChannel";

export type CallState = "idle" | "joining" | "connected" | "failed" | "left";
export type CallEvents = {
  onState?: (s: CallState, detail?: string) => void;
  onLocalStream?: (s: MediaStream | null) => void;
  onRemoteStream?: (s: MediaStream) => void;
};

const CALL = "call"; // channel tag separating media SDP/ICE from the data-channel RTC signaling

export class SynCall {
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  state: CallState = "idle";

  constructor(
    private channel: SynChannel,
    private sessionId: string,
    private polite: boolean, // guest = polite, host = impolite
    private ev: CallEvents = {},
  ) {}

  private setState(s: CallState, detail?: string) { this.state = s; this.ev.onState?.(s, detail); }

  private async iceServers(): Promise<RTCIceServer[]> {
    const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    try {
      const turn = await fetch(`/api/coop-symbiote/session/${encodeURIComponent(this.sessionId)}/turn-credentials`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }).then((r) => r.json());
      for (const u of turn?.urls || []) {
        if (String(u).startsWith("turn")) servers.push({ urls: u, username: turn.username, credential: turn.credential });
        else if (String(u).startsWith("stun")) servers.push({ urls: u });
      }
    } catch { /* STUN-only fallback */ }
    return servers;
  }

  private setupPc(iceServers: RTCIceServer[]) {
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    pc.ontrack = (e) => { if (e.streams[0]) this.ev.onRemoteStream?.(e.streams[0]); };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.channel.send({ type: "signal", channel: CALL, kind: "ice", candidate }); };
    pc.onnegotiationneeded = async () => {
      try { this.makingOffer = true; await pc.setLocalDescription(); this.channel.send({ type: "signal", channel: CALL, kind: "desc", desc: pc.localDescription }); }
      catch { /* transient */ } finally { this.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") this.setState("connected");
      else if (st === "failed" || st === "disconnected") this.setState("failed", st);
    };
  }

  // Route call-tagged signaling here (the room dispatches channel messages with channel==="call").
  async onSignal(m: any) {
    if (m.channel !== CALL || !this.pc) return;
    try {
      if (m.kind === "desc" && m.desc) {
        const collision = m.desc.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(m.desc);
        if (m.desc.type === "offer") { await this.pc.setLocalDescription(); this.channel.send({ type: "signal", channel: CALL, kind: "desc", desc: this.pc.localDescription }); }
      } else if (m.kind === "ice" && m.candidate) {
        try { await this.pc.addIceCandidate(m.candidate); } catch { if (!this.ignoreOffer) throw new Error("ice"); }
      }
    } catch { /* ignore transient negotiation errors */ }
  }

  async join({ video = false }: { video?: boolean } = {}) {
    this.setState("joining");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch (e: any) {
      // Media capture denied/unavailable → call fails, collaboration (data plane) is unaffected.
      this.setState("failed", `Microphone/camera unavailable (${e?.name || e}).`);
      return;
    }
    this.local = stream;
    this.ev.onLocalStream?.(stream);
    this.setupPc(await this.iceServers());
    for (const track of stream.getTracks()) this.pc!.addTrack(track, stream); // triggers negotiation
  }

  setMicEnabled(on: boolean) { this.local?.getAudioTracks().forEach((t) => (t.enabled = on)); }

  async shareScreen(): Promise<boolean> {
    if (!this.pc) return false;
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = screen.getVideoTracks()[0];
      const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track); else this.pc.addTrack(track, this.local || screen);
      track.onended = () => { const s = this.pc?.getSenders().find((x) => x.track === track); if (s) s.replaceTrack(this.local?.getVideoTracks()[0] || null); };
      return true;
    } catch { return false; }
  }

  leave() {
    this.local?.getTracks().forEach((t) => t.stop());
    try { this.pc?.close(); } catch { /* noop */ }
    this.channel.send({ type: "signal", channel: CALL, kind: "leave" });
    this.local = null; this.pc = null;
    this.ev.onLocalStream?.(null);
    this.setState("left");
  }
}
