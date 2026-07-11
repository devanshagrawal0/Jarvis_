import { useCallback, useEffect, useRef, useState } from "react";

type JarvisCommandBarProps = {
  onSubmit?: (text: string) => void;
  onMicToggle?: (active: boolean) => void;
  onAttach?: (files: File[]) => void;
  onModules?: () => void;
};

const CSS = `
.jcb-root {
  position: fixed; left: 50%; bottom: 4.5vh; transform: translateX(-50%);
  width: min(890px, 59vw); z-index: 30;
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

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function JarvisCommandBar({ onSubmit, onMicToggle, onAttach, onModules }: JarvisCommandBarProps) {
  const [text, setText] = useState("");
  const [micActive, setMicActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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
  }, [micActive, text, onMicToggle]);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value) return;
    onSubmit?.(value);
    document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: value, files } }));
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
    onAttach?.(selected);
    e.target.value = "";
  }, [onAttach]);

  const removeFile = useCallback((idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  return (
    <div className="jcb-root">
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

        <div className={`jcb-mic${micActive ? " active" : ""}`} onClick={toggleMic} title={micActive ? "Stop listening" : "Start voice input"}>
          <div className="jcb-mic-wrap">
            <MicRing />
            <span className="jcb-mic-bg" />
            <span className="jcb-mic-icon"><IconMic /></span>
          </div>
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
          <button className="jcb-act-btn" title="Settings"><IconSliders /></button>
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
