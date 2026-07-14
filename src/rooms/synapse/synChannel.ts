// Synapse W4 — the live channel client. Connects to /mesh/coop/ws, authenticates by session code,
// and provides live presence + chat + WebRTC signaling + a Yjs CRDT doc synced over the relay (the
// "never dies" path the WebRTC DataChannel optimizes on top of). Auto-reconnects with backoff.

import * as Y from "yjs";

export type ChannelStatus = "connecting" | "open" | "closed";
export type ChannelEvents = {
  onStatus?: (s: ChannelStatus) => void;
  onPresence?: (roster: Array<{ role: string; name: string }>, event: string, who: { role: string; name: string }) => void;
  onChat?: (msg: any) => void;
  onSignal?: (msg: any) => void;
  onCursor?: (msg: any) => void;
};

function bytesToB64(u: Uint8Array): string { let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s); }
function b64ToBytes(s: string): Uint8Array { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

export class SynChannel {
  ws: WebSocket | null = null;
  doc = new Y.Doc();
  status: ChannelStatus = "closed";
  private retry = 0;
  private closed = false;

  constructor(
    private code: string,
    private role: "host" | "guest",
    private name: string,
    private ev: ChannelEvents = {},
  ) {
    // Local Yjs edits (origin !== "remote") are broadcast to peers over the relay.
    this.doc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "remote") this.send({ type: "sync", update: bytesToB64(u) });
    });
  }

  connect() {
    this.closed = false;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/mesh/coop/ws`);
    this.ws = ws;
    this.setStatus("connecting");
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", code: this.code, role: this.role, name: this.name }));
    ws.onmessage = (e) => {
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      switch (m.type) {
        case "welcome": this.retry = 0; this.setStatus("open"); this.send({ type: "sync", update: bytesToB64(Y.encodeStateAsUpdate(this.doc)) }); break;
        case "presence": this.ev.onPresence?.(m.roster || [], m.event, { role: m.role, name: m.name }); break;
        case "chat": this.ev.onChat?.(m); break;
        case "signal": this.ev.onSignal?.(m); break;
        case "cursor": this.ev.onCursor?.(m); break;
        case "sync": if (m.update) Y.applyUpdate(this.doc, b64ToBytes(m.update), "remote"); break;
      }
    };
    ws.onclose = () => {
      if (this.closed) return; // deliberate close (unmount/StrictMode) — don't report or reconnect
      this.setStatus("closed");
      window.setTimeout(() => { if (!this.closed) this.connect(); }, Math.min(1000 * 2 ** this.retry++, 8000));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
  }

  private setStatus(s: ChannelStatus) { this.status = s; this.ev.onStatus?.(s); }
  send(msg: any) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  sendChat(text: string) { this.send({ type: "chat", text }); }
  sendCursor(x: number, y: number) { this.send({ type: "cursor", x, y }); }
  close() { this.closed = true; try { this.ws?.close(); } catch { /* noop */ } }
}
