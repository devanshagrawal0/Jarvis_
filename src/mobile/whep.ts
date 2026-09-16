import { authHeaders } from "../api";

// WHEP receiver for the PC stream. Signalling goes through the backend (same origin, owner
// cookie); media arrives straight from MediaMTX over the tailnet. One POST carries the offer and
// brings back the answer with the server's candidates; a DELETE on the returned resource ends it.

export type StreamStats = { fps: number; width: number; height: number; kbps: number; bufferMs: number; lost: number };

export class WhepPlayer {
  private pc: RTCPeerConnection | null = null;
  private resource = "";
  private lastBytes = 0;
  private lastAt = 0;
  private lastBuf = { delay: 0, count: 0 };
  private timer = 0;
  stats: StreamStats = { fps: 0, width: 0, height: 0, kbps: 0, bufferMs: 0, lost: 0 };

  constructor(private video: HTMLVideoElement, private whepUrl: string, private onStats: (s: StreamStats) => void, private onState: (s: string) => void) {}

  async start() {
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (e) => { this.video.srcObject = e.streams[0]; void this.video.play().catch(() => {}); };
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") this.onState(pc.iceConnectionState); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // wait (briefly) for the phone's own candidates so the offer is complete in one shot
    await new Promise<void>((done) => {
      if (pc.iceGatheringState === "complete") return done();
      const t = window.setTimeout(done, 1200);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(t); done(); } };
    });
    const res = await fetch(this.whepUrl, { method: "POST", headers: { "content-type": "application/sdp", ...authHeaders() }, body: pc.localDescription?.sdp || "" });
    if (res.status === 404) throw new Error("The PC is not streaming yet.");
    if (res.status !== 201) throw new Error(`Stream handshake failed (${res.status}) ${(await res.text()).slice(0, 120)}`);
    this.resource = res.headers.get("location") || "";
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    this.timer = window.setInterval(() => void this.poll(), 1000);
  }

  private async poll() {
    if (!this.pc) return;
    let report: RTCStatsReport;
    try { report = await this.pc.getStats(); } catch { return; }
    const now = performance.now();
    report.forEach((s: any) => {
      if (s.type !== "inbound-rtp" || s.kind !== "video") return;
      const bytes = Number(s.bytesReceived || 0);
      const kbps = this.lastAt ? Math.round(((bytes - this.lastBytes) * 8) / ((now - this.lastAt) / 1000) / 1000) : 0;
      this.lastBytes = bytes; this.lastAt = now;
      const delay = Number(s.jitterBufferDelay || 0), count = Number(s.jitterBufferEmittedCount || 0);
      const bufferMs = count > this.lastBuf.count ? Math.round(((delay - this.lastBuf.delay) / (count - this.lastBuf.count)) * 1000) : this.stats.bufferMs;
      this.lastBuf = { delay, count };
      this.stats = { fps: Math.round(Number(s.framesPerSecond || 0)), width: Number(s.frameWidth || 0), height: Number(s.frameHeight || 0), kbps, bufferMs, lost: Number(s.packetsLost || 0) };
    });
    this.onStats(this.stats);
  }

  async stop() {
    window.clearInterval(this.timer);
    const pc = this.pc; this.pc = null;
    if (this.resource) { try { await fetch(this.resource, { method: "DELETE", headers: authHeaders() }); } catch { /* server side times out on its own */ } }
    this.resource = "";
    try { pc?.getReceivers().forEach((r) => r.track?.stop()); pc?.close(); } catch { /* closed */ }
    this.video.srcObject = null;
  }
}
