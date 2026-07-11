import React, { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  }
}

interface JarvisMessage {
  id: string;
  role: "user" | "jarvis";
  text: string;
  streaming?: boolean;
}

export interface HelixContext {
  projectName: string;
  entryCount: number;
  contradictionCount: number;
  activeStrand: string;
  recentEntries: Array<{ query: string; strand: string; confidence: number }>;
}

interface Props {
  onClose: () => void;
  helixContext: HelixContext;
  onAddToEvidence: (text: string) => void;
}

const HINT_PROMPTS = [
  "Summarize the key contradictions",
  "What evidence is missing?",
  "Challenge my strongest assumption",
];

export function JarvisPanel({ onClose, helixContext, onAddToEvidence }: Props) {
  const [messages, setMessages] = useState<JarvisMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const voiceSupported = typeof window !== "undefined" &&
    !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.stop();
    };
  }, []);

  function toggleVoice() {
    if (!voiceSupported) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition!;
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = Array.from(e.results).map((res) => res[0].transcript).join("");
      setInput(transcript);
      if (e.results[e.results.length - 1].isFinal) setListening(false);
    };
    r.onerror = () => setListening(false);
    r.onend  = () => setListening(false);
    r.start();
    recognitionRef.current = r;
    setListening(true);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function buildContextPrefix(): string {
    const { projectName, entryCount, contradictionCount, activeStrand, recentEntries } = helixContext;
    const lines = [
      `[HELIX Intelligence Chamber — Live Context]`,
      `Project: "${projectName}" | Active strand: ${activeStrand} | Entries: ${entryCount} | Open contradictions: ${contradictionCount}`,
    ];
    if (recentEntries.length > 0) {
      lines.push(`Recent evidence:`);
      recentEntries.slice(0, 4).forEach(e =>
        lines.push(`  • [${e.strand} ${(e.confidence * 100).toFixed(0)}%] ${e.query.slice(0, 100)}`)
      );
    }
    lines.push(`---`, ``);
    return lines.join("\n");
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;
    if (!overrideText) setInput("");

    const isFirst = messages.length === 0;
    const userMsg: JarvisMessage = { id: crypto.randomUUID(), role: "user", text };
    const jarvisId = crypto.randomUUID();
    const jarvisMsg: JarvisMessage = { id: jarvisId, role: "jarvis", text: "", streaming: true };
    setMessages(prev => [...prev, userMsg, jarvisMsg]);
    setStreaming(true);

    const prompt = isFirst ? `${buildContextPrefix()}\n${text}` : text;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode: "chat" }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "delta" && event.text) {
              accumulated += event.text;
              setMessages(prev =>
                prev.map(m => m.id === jarvisId ? { ...m, text: accumulated } : m)
              );
            }
          } catch { /* partial JSON line — safe to skip */ }
        }
      }

      setMessages(prev =>
        prev.map(m => m.id === jarvisId ? { ...m, streaming: false } : m)
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== "AbortError") {
        setMessages(prev =>
          prev.map(m =>
            m.id === jarvisId
              ? { ...m, text: "Jarvis is unreachable — check that the backend server is running.", streaming: false }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  const { projectName, entryCount, contradictionCount } = helixContext;

  return (
    <motion.div
      className="helix-jarvis-panel"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="hjp-header">
        <div className="hjp-header-left">
          <span className="hjp-wordmark">JARVIS</span>
          <span className="hjp-sep">·</span>
          <span className="hjp-project">{projectName}</span>
        </div>
        <div className="hjp-header-stats">
          <span className="hjp-stat">{entryCount}E</span>
          {contradictionCount > 0 && (
            <span className="hjp-stat hjp-stat--danger">{contradictionCount}⚡</span>
          )}
        </div>
        <button className="hjp-close" onClick={onClose} title="Close (⌘J or Esc)" aria-label="Close Jarvis panel">✕</button>
      </div>

      {/* Messages */}
      <div className="hjp-messages" ref={scrollRef} role="log" aria-live="polite" aria-label="Jarvis conversation">
        {messages.length === 0 && (
          <div className="hjp-empty">
            <div className="hjp-empty-icon" aria-hidden>◈</div>
            <p className="hjp-empty-text">
              Ask Jarvis anything about this investigation. Responses can be added directly to HELIX evidence.
            </p>
            <div className="hjp-empty-hints" role="list">
              {HINT_PROMPTS.map(hint => (
                <button
                  key={hint}
                  className="hjp-hint"
                  role="listitem"
                  onClick={() => void send(hint)}
                  disabled={streaming}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`hjp-msg hjp-msg--${msg.role}`}>
            <div className="hjp-msg-label" aria-hidden>
              {msg.role === "user" ? "YOU" : "JARVIS"}
            </div>
            <div className={`hjp-msg-body${msg.streaming ? " hjp-msg--streaming" : ""}`}>
              {msg.text}
              {msg.streaming && <span className="hjp-cursor" aria-hidden />}
            </div>
            {msg.role === "jarvis" && !msg.streaming && msg.text && (
              <button
                className="hjp-add-btn"
                onClick={() => onAddToEvidence(msg.text)}
                title="Submit this response as a HELIX inquiry"
              >
                ⊕ Add to Evidence
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="hjp-input-row">
        {voiceSupported && (
          <button
            className={`hjp-mic${listening ? " hjp-mic--active" : ""}`}
            onClick={toggleVoice}
            title={listening ? "Stop listening (active)" : "Voice input"}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            type="button"
            disabled={streaming}
          >
            {listening ? "◉" : "⏺"}
          </button>
        )}
        <input
          ref={inputRef}
          className="hjp-input"
          type="text"
          placeholder={listening ? "Listening…" : "Ask Jarvis…"}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={streaming}
          maxLength={2000}
          autoComplete="off"
          spellCheck={false}
          aria-label="Message to Jarvis"
        />
        <button
          className="hjp-send"
          onClick={() => void send()}
          disabled={streaming || !input.trim()}
          title="Send (Enter)"
          aria-label="Send message"
        >
          {streaming ? <span className="hjp-send-spinner" aria-hidden /> : "↑"}
        </button>
      </div>
    </motion.div>
  );
}
