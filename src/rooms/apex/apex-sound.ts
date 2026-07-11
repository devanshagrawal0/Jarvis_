/* APEX — Jarvis UI sound. Tiny Web Audio synth for subtle, cinematic
   interaction bleeps (Arwes-style). No assets, no deps. Lazy AudioContext
   (browsers require a user gesture before audio), master volume kept very
   low, and a persisted mute toggle. Respects prefers-reduced-motion as a
   sensible "calm" default. */

const LS_MUTE = "apex.home.sound.v1";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = load();

function load(): boolean {
  try {
    const s = localStorage.getItem(LS_MUTE);
    if (s != null) return s === "1";
  } catch { /* private mode */ }
  // Default: on, unless the user prefers reduced motion (treat as "calm").
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensure(): boolean {
  if (muted) return false;
  if (typeof window === "undefined") return false;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.055;            // deliberately quiet
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return true;
  } catch { return false; }
}

/* One shaped tone: quick attack, exponential decay, optional pitch glide. */
function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; glideTo?: number; delay?: number } = {}): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (opts.delay || 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type || "triangle";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glideTo), t0 + dur);
  const peak = opts.gain ?? 0.6;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

export type SfxName = "hover" | "tick" | "open" | "close" | "select" | "focus" | "tray" | "alert" | "mode" | "error";

export function sfx(name: SfxName): void {
  if (!ensure()) return;
  switch (name) {
    case "hover":  tone(2100, 0.03, { gain: 0.25, type: "sine" }); break;
    case "tick":   tone(1500, 0.035, { gain: 0.4 }); break;
    case "open":   tone(560, 0.14, { glideTo: 1180, gain: 0.5 }); break;
    case "close":  tone(1180, 0.12, { glideTo: 520, gain: 0.45 }); break;
    case "select": tone(880, 0.05, { gain: 0.5 }); tone(1320, 0.08, { gain: 0.45, delay: 0.05 }); break;
    case "focus":  tone(1760, 0.06, { gain: 0.4, type: "sine" }); break;
    case "tray":   tone(700, 0.1, { glideTo: 1000, gain: 0.4 }); break;
    case "mode":   tone(660, 0.06, { gain: 0.45 }); tone(990, 0.06, { gain: 0.4, delay: 0.06 }); tone(1320, 0.09, { gain: 0.4, delay: 0.12 }); break;
    case "alert":  tone(988, 0.09, { gain: 0.6 }); tone(988, 0.12, { gain: 0.6, delay: 0.14 }); break;
    case "error":  tone(220, 0.16, { glideTo: 160, gain: 0.5, type: "sawtooth" }); break;
  }
}

export function isMuted(): boolean { return muted; }

export function toggleMute(): boolean {
  muted = !muted;
  try { localStorage.setItem(LS_MUTE, muted ? "1" : "0"); } catch { /* noop */ }
  if (!muted) { ensure(); sfx("select"); }   // confirm chirp when un-muting
  return muted;
}
