import { useCallback, useEffect, useRef, useState } from "react";

type JarvisCommandBarProps = {
  onSubmit?: (text: string, files?: File[]) => void;
  onMicToggle?: (active: boolean) => void;
  onModules?: () => void;
  model?: string;               // "cortex" | "eclipse"
  onSetModel?: (v: string) => void;
  strength?: string;            // Cortex v4 P1.4 — "cost-guarded" | "balanced" | "full"
  onCycleStrength?: () => void;
  onSetStrength?: (v: string) => void;
  research?: string;            // "fast" | "deep"
  onToggleResearch?: () => void;
  onSetResearch?: (v: string) => void;
  voiceMode?: string;
  onSetVoiceMode?: (v: string) => void;
  liveVoiceActive?: boolean;
  onLiveVoiceToggle?: () => void | Promise<void>;
};

// Cortex v4 P1.4 — Strength dial labels for the command-bar pill.
function strengthShort(s?: string) { return s === "full" ? "Max" : s === "balanced" ? "Bal" : "Eco"; }
function strengthTitle(s?: string) {
  const cur = s === "full" ? "Max (full power)" : s === "balanced" ? "Balanced" : "Eco (cost-guarded)";
  return `Strength: ${cur} — click to cycle. Eco keeps cost low (Flash only); Balanced & Max allow the strongest models when needed.`;
}

const CSS = `
.jcb-root {
  position: fixed; left: 50%; bottom: 4.5vh; transform: translateX(-50%);
  width: min(890px, 59vw); z-index: 1100;
  font-family: Inter, "Segoe UI", sans-serif;
}
.jcb-pill {
  position: relative; height: 87px; border-radius: 27px;
  background: linear-gradient(180deg, #0A1119, #04070C);
  border: 1.5px solid rgba(120,212,255,0.75);
  box-shadow: 0 0 16px rgba(70,190,255,.4), 0 0 70px rgba(30,120,220,.2),
    inset 0 0 30px rgba(40,130,220,.1), inset 0 1px 0 rgba(170,230,255,.25);
  display: flex; align-items: center; padding: 0 68px 0 11px; gap: 11px; overflow: visible;
}
.jcb-apps {
  position: absolute; top: 10px; right: 14px; width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; color: rgba(0,207,255,.55);
  cursor: pointer; padding: 0; z-index: 4;
}
.jcb-apps:hover { color: rgba(0,207,255,.9); }
.jcb-mic {
  position: relative; flex: 0 0 120px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.jcb-mic::after {
  content:''; position:absolute; right:0; top:50%; transform:translateY(-50%);
  height:18px; width:1px;
  background: rgba(0,207,255,.35);
  box-shadow: 0 0 6px rgba(0,207,255,.5);
}
.jcb-mic-wrap {
  position: relative; width: 46px; height: 46px;
  display: flex; align-items: center; justify-content: center;
}
.jcb-mic-wrap svg.jcb-ring {
  position: absolute; inset: -8px;
  width: calc(100% + 16px); height: calc(100% + 16px);
  color: rgba(115,215,255,0.85);
  filter: drop-shadow(0 0 3px rgba(80,200,255,0.7));
  transition: color .2s, filter .2s;
}
.jcb-mic.active .jcb-mic-wrap svg.jcb-ring {
  color: rgba(0,220,255,1);
  filter: drop-shadow(0 0 6px rgba(0,210,255,0.9));
  animation: jcb-ring-pulse 1.2s ease-in-out infinite;
}
@keyframes jcb-ring-pulse {
  0%, 100% { opacity: 1; } 50% { opacity: 0.55; }
}
.jcb-mic-bg {
  position: absolute; inset: 0; border-radius: 50%;
  background: rgba(0,70,130,.50); border: 1px solid rgba(0,207,255,.2);
  transition: background .2s;
}
.jcb-mic.active .jcb-mic-bg { background: rgba(0,90,160,.65); }
.jcb-mic-icon {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  color: rgba(180,240,255,.92);
}
.jcb-center {
  position: relative; flex: 1; overflow: hidden; height: 100%;
}
.jcb-input {
  position: absolute; inset: 0; width: 100%; background: none;
  border: none; outline: none; resize: none;
  font-family: Inter, "Segoe UI", sans-serif; font-size: 18px; font-weight: 300;
  letter-spacing: .01em; color: rgba(180,240,255,.92);
  padding: 14px 12px 0 16px; caret-color: rgba(0,207,255,.9); z-index: 3;
}
.jcb-input::placeholder {
  font-size: 18px; font-weight: 300; letter-spacing: .01em;
  color: rgba(72,220,248,.55);
}
.jcb-center::after {
  content: '';
  position: absolute; left: 16px; top: 38px;
  width: 52%; height: 1px;
  background: linear-gradient(90deg, rgba(0,190,255,0.6), rgba(0,190,255,0));
  pointer-events: none; z-index: 2;
}
.jcb-acts {
  display: flex; align-items: center; gap: 3px;
  padding: 0 6px 0 10px; flex-shrink: 0;
}
.jcb-act-btn {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; background: none; border: none;
  color: rgba(0,207,255,.5); cursor: pointer; padding: 0; border-radius: 4px;
}
.jcb-act-btn:hover { color: rgba(0,207,255,.9); background: rgba(0,120,200,.1); }
.jcb-act-btn.has-files { color: rgba(0,220,255,.9); }
.jcb-vdiv { width:1px; height:18px; background:rgba(0,207,255,.35); flex-shrink:0; margin:0 26px 0 10px; align-self:center; box-shadow:0 0 6px rgba(0,207,255,.5); }
.jcb-send {
  position: relative;
  width: 59px; height: 41px; border-radius: 9px;
  border: 1.6px solid rgba(130,220,255,0.95);
  background: linear-gradient(160deg, rgba(30,85,150,0.35), rgba(8,24,48,0.65));
  color: #cfeeff; display: grid; place-items: center;
  box-shadow: 0 0 20px rgba(60,175,255,0.45), inset 0 0 14px rgba(70,170,255,0.22);
  cursor: pointer; padding: 0; flex-shrink: 0;
  transition: box-shadow .15s, border-color .15s;
}
.jcb-send::after {
  content: "";
  position: absolute; top: 3px; right: -8px;
  width: 14px; height: 1.4px;
  background: rgba(150,225,255,0.9);
  transform: rotate(-32deg);
  box-shadow: 0 0 6px rgba(90,200,255,0.9);
}
.jcb-send:hover {
  border-color: rgba(150,235,255,1);
  box-shadow: 0 0 28px rgba(60,175,255,0.65), inset 0 0 18px rgba(70,170,255,0.32);
}
.jcb-send:disabled {
  opacity: 0.4; cursor: default;
}
.jcb-file-chips {
  position: absolute; bottom: calc(100% + 8px); left: 0; right: 0;
  display: flex; flex-wrap: wrap; gap: 5px; padding: 0 4px;
  pointer-events: none;
}
.jcb-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 20px;
  background: rgba(0,40,90,.85); border: 1px solid rgba(0,180,255,.4);
  font-size: 11px; font-weight: 500; color: rgba(130,220,255,.9);
  pointer-events: auto; cursor: pointer;
}
.jcb-chip:hover { background: rgba(0,55,110,.9); }
`;

function MicRing() {
  return (
    <svg className="jcb-ring" viewBox="0 0 100 100" fill="none">
      <circle cx="50" cy="50" r="47"
        stroke="currentColor" strokeWidth="2.6"
        strokeLinecap="round" strokeDasharray="0.1 7.2" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="16" height="21" viewBox="0 0 24 32" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="8" y="2" width="8" height="16" rx="4" />
      <path d="M4 14 a8 8 0 0 0 16 0" />
      <line x1="12" y1="22" x2="12" y2="28" />
      <line x1="7" y1="28" x2="17" y2="28" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" width="18" height="18">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="8" cy="6" r="2" fill="currentColor" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="16" cy="12" r="2" fill="currentColor" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="10" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}

function IconClip() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M21.44 11.05L12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l8.19-8.19a3.5 3.5 0 0 1 4.95 4.95L9.41 17.41a1.5 1.5 0 0 1-2.12-2.12l7.27-7.28" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="21" height="17" viewBox="0 0 30 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M4 20 26 12 4 4 9 12 4 20Z" />
      <line x1="9" y1="12" x2="26" y2="12" />
      <line x1="20" y1="5" x2="27" y2="2" strokeDasharray="2 2" />
    </svg>
  );
}

function IconApps() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" fill="currentColor" />
      <rect x="9.5" y="1" width="5.5" height="5.5" rx="1" fill="currentColor" />
      <rect x="1" y="9.5" width="5.5" height="5.5" rx="1" fill="currentColor" />
      <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1" fill="currentColor" />
    </svg>
  );
}

// Products shown in the picker. Cortex owns the direct-chat effort ladder;
// Eclipse is the durable mission runtime.
const MODEL_NAME = "Cortex";
// Descriptions state EXACTLY what each option does — Effort maps to a real model tier.
const MODELS: { id: string; label: string; desc: string }[] = [
  { id: "cortex", label: "Cortex", desc: "Everyday to deep reasoning" },
  { id: "eclipse", label: "Eclipse", desc: "Durable multi-agent research mission" },
];
// Cortex effort tiers map to real model + thinking levels in the backend.
const STD_EFFORTS: { id: string; label: string; desc: string }[] = [
  { id: "cost-guarded", label: "Eco", desc: "Flash · minimal thinking" },
  { id: "balanced", label: "Balanced", desc: "Flash · medium thinking" },
  { id: "full", label: "Max", desc: "Pro · high thinking · extended budget" },
];
// Eclipse mission tiers — the effort names swap to these when Eclipse is the model.
const ECLIPSE_EFFORTS: { id: string; label: string; desc: string }[] = [
  { id: "pulse", label: "Pulse", desc: "1 worker · quick pass" },
  { id: "deep", label: "Deep", desc: "2 workers · bounded mission" },
  { id: "totality", label: "Totality", desc: "3 workers · full research mission" },
];
const STD_EFFORT_IDS = new Set(STD_EFFORTS.map((e) => e.id));
const ECLIPSE_EFFORT_IDS = new Set(ECLIPSE_EFFORTS.map((e) => e.id));
const RESEARCH_ROWS: { id: string; label: string; desc: string }[] = [
  { id: "fast", label: "Fast", desc: "One quick grounded answer" },
  { id: "deep", label: "Deep", desc: "Multi-source cited report" },
];
const VOICE_ROWS: { id: string; label: string; desc: string }[] = [
  { id: "dictate", label: "Dictate", desc: "Free browser speech-to-text" },
  { id: "live", label: "Talk-Live", desc: "Gemini native two-way audio" },
];
const pickerHdr: React.CSSProperties = { padding: "10px 13px 4px", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(0,229,255,0.5)" };
const pickRow = (active: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 10, padding: "7px 13px", cursor: "pointer", background: active ? "rgba(0,229,255,0.1)" : "transparent" });

export function JarvisCommandBar({ onSubmit, onMicToggle, onModules, model, onSetModel, strength, onCycleStrength, onSetStrength, research, onToggleResearch, onSetResearch, voiceMode, onSetVoiceMode, liveVoiceActive, onLiveVoiceToggle }: JarvisCommandBarProps) {
  const modelId = model || "cortex";
  const isEclipse = modelId === "eclipse";
  const EFFORTS = isEclipse ? ECLIPSE_EFFORTS : STD_EFFORTS;
  const activeModel = MODELS.find((m) => m.id === modelId) || MODELS[0];
  const activeEffort = EFFORTS.find((e) => e.id === strength) || EFFORTS[isEclipse ? 1 : 0];
  // Selecting a model swaps the effort vocabulary; keep the effort valid for the chosen model.
  const handleSetModel = (id: string) => {
    onSetModel?.(id);
    if (id === "eclipse") { if (!ECLIPSE_EFFORT_IDS.has(strength || "")) onSetStrength?.("deep"); }
    else if (!STD_EFFORT_IDS.has(strength || "")) onSetStrength?.("cost-guarded");
  };
  const activeResearch = RESEARCH_ROWS.find((r) => r.id === (research || "fast")) || RESEARCH_ROWS[0];
  const activeVoice = VOICE_ROWS.find((r) => r.id === (voiceMode || "dictate")) || VOICE_ROWS[0];
  void onCycleStrength; void onToggleResearch; // superseded by the picker panel
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submenu, setSubmenu] = useState<null | "model" | "effort" | "research" | "voice">(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMenu = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setPickerOpen(true); };
  const scheduleClose = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => { setPickerOpen(false); setSubmenu(null); }, 200); };
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) { setPickerOpen(false); setSubmenu(null); } }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);
  const [text, setText] = useState("");
  const [micActive, setMicActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const id = "jcb-styles";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = CSS;
  }, []);

  const toggleMic = useCallback(() => {
    if (voiceMode === "live") {
      void onLiveVoiceToggle?.();
      onMicToggle?.(!liveVoiceActive);
      return;
    }
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    if (micActive) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicActive(false);
      onMicToggle?.(false);
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    let baseText = "";
    rec.onstart = () => {
      baseText = text;
    };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setText(baseText + final + interim);
      if (final) baseText += final;
    };
    rec.onerror = () => {
      setMicActive(false);
      onMicToggle?.(false);
    };
    rec.onend = () => {
      if (recognitionRef.current === rec) {
        setMicActive(false);
        onMicToggle?.(false);
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = rec;
    rec.start();
    setMicActive(true);
    onMicToggle?.(true);
  }, [micActive, text, onMicToggle, voiceMode, liveVoiceActive, onLiveVoiceToggle]);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    if (onSubmit) onSubmit(value, files);
    else document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: value, files } }));
    setText("");
    setFiles([]);
    if (micActive) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicActive(false);
      onMicToggle?.(false);
    }
  }, [text, files, micActive, onSubmit, onMicToggle]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length) return;
    setFiles(prev => [...prev, ...selected]);
    e.target.value = "";
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  return (
    <div className="jcb-root" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); const dropped = Array.from(event.dataTransfer.files || []); if (dropped.length) setFiles((current) => [...current, ...dropped].slice(0, 5)); }}>
      {files.length > 0 && (
        <div className="jcb-file-chips">
          {files.map((f, i) => (
            <span key={i} className="jcb-chip" onClick={() => removeFile(i)} title="Click to remove">
              {f.name} ✕
            </span>
          ))}
        </div>
      )}
      <div className="jcb-pill">
        <button className="jcb-apps" title="Modules" onClick={onModules}><IconApps /></button>

        <div className={`jcb-mic${micActive || liveVoiceActive ? " active" : ""}`} onClick={toggleMic} title={voiceMode === "live" ? (liveVoiceActive ? "Stop Talk-Live" : "Start Talk-Live") : (micActive ? "Stop dictation" : "Start dictation")}>
          <div className="jcb-mic-wrap">
            <MicRing />
            <span className="jcb-mic-bg" />
            <span className="jcb-mic-icon"><IconMic /></span>
          </div>
        </div>

        {/* Cortex v4 — Codex picker chip: bottom-RIGHT of the bar (below the attachment), hover-to-open */}
        <div ref={pickerRef} style={{ position: "absolute", right: 193, bottom: 6, zIndex: 5 }}
          onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
          <button
            title="Model, effort & research"
            onClick={() => { setPickerOpen((o) => !o); setSubmenu(null); }}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
              cursor: "pointer", padding: "3px 6px", minHeight: "auto", whiteSpace: "nowrap" }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 500, color: "rgba(224,236,248,0.9)" }}>{activeModel.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 500, color: "#4da6ff" }}>{activeEffort.label}</span>
          </button>
          {pickerOpen && (() => {
            const sub = submenu === "model"
              ? { title: "Model", rows: MODELS, cur: model || "cortex", set: handleSetModel }
              : submenu === "effort"
                ? { title: "Effort", rows: EFFORTS, cur: strength || "cost-guarded", set: onSetStrength }
                : submenu === "research"
                  ? (isEclipse ? null : { title: "Research", rows: RESEARCH_ROWS, cur: research || "fast", set: onSetResearch })
                  : submenu === "voice"
                    ? { title: "Voice", rows: VOICE_ROWS, cur: voiceMode || "dictate", set: onSetVoiceMode }
                  : null;
            const L1 = [
              { key: "model" as const, label: "Model", value: activeModel.label },
              { key: "effort" as const, label: "Effort", value: activeEffort.label },
              // Eclipse encodes research depth in its Effort tiers (Pulse/Deep/Totality), so the
              // separate Research dial doesn't apply — hide it when Eclipse is the model.
              ...(isEclipse ? [] : [{ key: "research" as const, label: "Research", value: activeResearch.label }]),
              { key: "voice" as const, label: "Voice", value: activeVoice.label },
            ];
            const ACCENT = "#5cb0ff";
            const HL = "rgba(90,140,200,0.16)";
            const panel: React.CSSProperties = {
              position: "absolute", bottom: "calc(100% + 10px)",
              // Reference color: dark desaturated navy-charcoal (#1a2433), translucent +
              // heavy blur so the room glows through — holographic frosted glass, not pastel.
              background: "rgba(26,36,51,0.72)", backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
              border: "1px solid rgba(120,160,205,0.2)", borderRadius: 14, zIndex: 61,
              boxShadow: "0 16px 44px rgba(0,0,0,0.62), inset 0 1px 0 rgba(180,210,245,0.06)",
              fontFamily: 'Inter, "Segoe UI", sans-serif', color: "rgba(234,242,252,0.94)",
            };
            return (
              <>
                {/* Level 1 — category list, right-aligned to the chip */}
                <div style={{ ...panel, right: 0, width: 198, padding: "5px" }}
                  onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
                  {L1.map((row) => {
                    const open = submenu === row.key;
                    return (
                      <div key={row.key} role="button" tabIndex={0}
                        onClick={() => setSubmenu((s) => (s === row.key ? null : row.key))}
                        onMouseEnter={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setSubmenu(row.key); }}
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 8, cursor: "pointer", background: open ? HL : "transparent" }}>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{row.label}</span>
                        <span style={{ marginLeft: "auto", fontSize: 11.5, color: open ? ACCENT : "rgba(176,196,216,0.55)" }}>{row.value}</span>
                        <span style={{ fontSize: 11, color: open ? ACCENT : "rgba(176,196,216,0.4)" }}>›</span>
                      </div>
                    );
                  })}
                </div>
                {/* Level 2 — flyout to the RIGHT: header + label/description + checkmark */}
                {sub && (
                  <div style={{ ...panel, left: "calc(100% + 8px)", width: 224, padding: "5px 5px 7px" }}
                    onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
                    <div style={{ padding: "6px 10px 4px", fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(150,175,205,0.5)" }}>{sub.title}</div>
                    {sub.rows.map((r) => {
                      const active = sub.cur === r.id;
                      return (
                        <div key={r.id} role="button" tabIndex={0}
                          onClick={() => sub.set?.(r.id)}
                          style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 8, cursor: "pointer", background: active ? HL : "transparent" }}
                          onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(70,130,195,0.07)"; }}
                          onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.label}</div>
                            <div style={{ fontSize: 10, color: "rgba(158,180,202,0.58)", marginTop: 1 }}>{r.desc}</div>
                          </div>
                          {active ? <span style={{ color: ACCENT, fontSize: 12.5, fontWeight: 700 }}>✓</span> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        <div className="jcb-center">
          <textarea
            className="jcb-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask Jarvis anything..."
            rows={1}
            spellCheck={false}
          />
        </div>

        <div className="jcb-acts">
          <button
            className={`jcb-act-btn${files.length ? " has-files" : ""}`}
            title="Attach file"
            onClick={() => fileInputRef.current?.click()}
          >
            <IconClip />
          </button>
        </div>
        <span className="jcb-vdiv" />
        <button className="jcb-send" title="Send" onClick={submit}><IconSend /></button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>
  );
}
