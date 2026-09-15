import { useCallback, useEffect, useRef, useState } from "react";
import { LiveVoiceController } from "../liveVoice";

// Batch 5 — voice on the phone is the desktop's Talk-Live path, reused as is: the mic streams to
// Gemini Live with the JARVIS instruction and every tool, replies come back as audio + transcript,
// and speaking over it interrupts it (barge-in is the model's, not ours). What this hook adds is
// the phone-side state: a level meter for the centrepiece, a session clock, and the transcripts
// handed to the thread so the conversation stays the record.
//
// Reality on iOS (plan v1 §2.1): getUserMedia must be called inside the tap; a second stream kills
// the first, so one controller per session; audio output is forced to the speaker while the mic is
// open. All handled by the controller's start()/stop().

export type VoiceState = "off" | "connecting" | "listening" | "speaking" | "error";

export type VoiceEvents = {
  onUserText: (text: string, final: boolean) => void;
  onModelText: (text: string, final: boolean) => void;
  onTool: (tool: string, result: unknown) => void;
};

export function useVoice(events: VoiceEvents) {
  const [state, setState] = useState<VoiceState>("off");
  const [detail, setDetail] = useState("");
  const [seconds, setSeconds] = useState(0);
  const level = useRef(0);               // 0..1, read by the stage every frame
  const ctrl = useRef<LiveVoiceController | null>(null);
  const evRef = useRef(events); evRef.current = events;
  const raf = useRef(0);
  const startedAt = useRef(0);

  // level meter: whichever side is talking drives the ring — the mic while listening, the reply
  // while speaking
  const meter = useCallback(() => {
    const c = ctrl.current;
    if (!c) { level.current = 0; return; }
    const a = c._outputAnalyser && (c as any).playing?.size ? c._outputAnalyser : c._inputAnalyser;
    if (a) {
      const buf = new Uint8Array(a.fftSize);
      a.getByteTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      level.current = Math.min(1, rms * 6);
    }
    raf.current = requestAnimationFrame(meter);
  }, []);

  const stop = useCallback(async () => {
    cancelAnimationFrame(raf.current);
    level.current = 0;
    const c = ctrl.current; ctrl.current = null;
    if (c) await c.stop().catch(() => {});
    setState("off"); setDetail("");
  }, []);

  const start = useCallback(async () => {
    if (ctrl.current) return;
    setState("connecting"); setDetail(""); setSeconds(0); startedAt.current = Date.now();
    const c = new LiveVoiceController({
      onState: (s, d) => {
        if (s === "error") { setState("error"); setDetail(d || "Voice failed"); ctrl.current = null; cancelAnimationFrame(raf.current); level.current = 0; return; }
        if (s === "idle") { if (ctrl.current === c) { setState("off"); setDetail(d || ""); ctrl.current = null; cancelAnimationFrame(raf.current); level.current = 0; } return; }
        setState(s); if (d) setDetail(d);
      },
      onInputTranscript: (t) => evRef.current.onUserText(t, false),
      onOutputTranscript: (t) => evRef.current.onModelText(t, false),
      onTurnComplete: (turn) => { evRef.current.onUserText(turn.input, true); evRef.current.onModelText(turn.output, true); },
      onToolResult: (tool, result) => evRef.current.onTool(tool, result),
    });
    ctrl.current = c;
    try {
      await c.start();
      raf.current = requestAnimationFrame(meter);
    } catch (e) {
      ctrl.current = null;
      setState("error"); setDetail(e instanceof Error ? e.message : String(e));
    }
  }, [meter]);

  useEffect(() => {
    if (state === "off" || state === "error") return;
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [state]);
  useEffect(() => () => { void stop(); }, [stop]);

  return { state, detail, seconds, level, start, stop, active: state !== "off" && state !== "error" };
}
