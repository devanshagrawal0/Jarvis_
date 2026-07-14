// Synapse W4 — WebRTC P2P DataChannel with perfect-negotiation, signalled over SynChannel (the WS
// relay). Once the P2P channel opens, bulk collab traffic flows peer-to-peer off our infra; if it
// never establishes (hostile NAT), SynChannel's relay keeps everything working — the call site
// prefers the DataChannel and falls back to channel.send() transparently.

import type { SynChannel } from "./synChannel";

export type RtcEvents = { onMessage?: (data: string) => void; onState?: (s: string) => void };

// polite peer yields on offer collisions (guest = polite, host = impolite) — the standard
// perfect-negotiation roles so simultaneous offers resolve without deadlock.
export function createRtc(channel: SynChannel, polite: boolean, iceServers: RTCIceServer[], ev: RtcEvents = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  let dc: RTCDataChannel | null = null;
  let makingOffer = false;
  let ignoreOffer = false;

  const wire = (channelDc: RTCDataChannel) => {
    dc = channelDc;
    dc.onopen = () => ev.onState?.("p2p-open");
    dc.onclose = () => ev.onState?.("p2p-closed");
    dc.onmessage = (e) => ev.onMessage?.(String(e.data));
  };
  if (!polite) wire(pc.createDataChannel("coop"));
  pc.ondatachannel = (e) => wire(e.channel);

  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      channel.send({ type: "signal", kind: "desc", desc: pc.localDescription });
    } catch { /* transient */ } finally { makingOffer = false; }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) channel.send({ type: "signal", kind: "ice", candidate }); };
  pc.onconnectionstatechange = () => ev.onState?.(pc.connectionState);

  async function onSignal(m: any) {
    try {
      if (m.kind === "desc" && m.desc) {
        const collision = m.desc.type === "offer" && (makingOffer || pc.signalingState !== "stable");
        ignoreOffer = !polite && collision;
        if (ignoreOffer) return;
        await pc.setRemoteDescription(m.desc);
        if (m.desc.type === "offer") {
          await pc.setLocalDescription();
          channel.send({ type: "signal", kind: "desc", desc: pc.localDescription });
        }
      } else if (m.kind === "ice" && m.candidate) {
        try { await pc.addIceCandidate(m.candidate); } catch { if (!ignoreOffer) throw new Error("ice"); }
      }
    } catch { /* ignore transient negotiation errors */ }
  }

  return {
    pc,
    onSignal,
    connected: () => !!dc && dc.readyState === "open",
    send: (data: string) => { if (dc && dc.readyState === "open") { dc.send(data); return true; } return false; },
    close: () => { try { pc.close(); } catch { /* noop */ } },
  };
}
