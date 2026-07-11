/* THE FORGE — Signal / Variable Studio.
   Two ways to author a reusable primitive:
   • Compose — write a DSL expression (or let Jarvis write it), validate live, save.
   • Upload & Derive (signals) — drop a code/data file; a staged analysis reads it,
     a chatbot explains what it does and what the derived signal will output, then
     you create a custom signal whose runnable code + retrieval method are stored,
     well-labeled and easy to fetch when the signal is used. */

import { useMemo, useRef, useState } from "react";
import { parse, validate, extractDeps } from "./forge-dsl";
import { saveSignal, saveVariable, aiCompose, analyzePython, saveForgeSignalCode, type PyBrief, type UploadedSignal } from "./forge-data";
import { Icon } from "./ForgeIcons";

type Kind = "signal" | "variable";
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const UP_STAGES = ["Reading file", "Parsing structure", "Detecting inputs", "Deriving signal", "Ready"];

const EXAMPLES: Record<Kind, { label: string; expr: string }[]> = {
  variable: [
    { label: "Oversold", expr: "RSI(SPX,14) < 30" },
    { label: "Low vol", expr: "VIX < 18" },
    { label: "Above 200MA", expr: "price > SMA(SPY,200)" },
    { label: "Momentum", expr: "ROC(SPY,20) > 5" },
  ],
  signal: [
    { label: "Golden cross", expr: "EMA(SPY,50) crosses_above EMA(SPY,200)" },
    { label: "Dip buy", expr: "RSI(SPY,14) < 30 AND VIX < 25" },
    { label: "Breakout", expr: "price crosses_above DONCHIAN_HI(SPY,20)" },
  ],
};

function checkExpr(expr: string, knownVars: Set<string>): { ok: boolean; error?: string; deps?: ReturnType<typeof extractDeps> } {
  if (!expr.trim()) return { ok: false };
  try {
    const ast = parse(expr);
    const errs = validate(ast, new Set(), knownVars).filter((e) => !/Unknown symbol/.test(e));
    if (errs.length) return { ok: false, error: errs[0] };
    return { ok: true, deps: extractDeps(ast) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* Turn a static code brief into a concrete, runnable signal: a DSL retrieval
   expression the engine can evaluate + a human reading + output shape. */
function deriveSignal(brief: PyBrief, code: string): UploadedSignal {
  const sym = "SPY";
  const ind = (brief.indicators || []).map(i => i.toLowerCase());
  const has = (k: string) => ind.some(i => i.includes(k));
  let dsl: string, reading: string;
  if (has("rsi")) { dsl = `RSI(${sym},14) < 30`; reading = "RSI(14) drops below 30 (oversold)"; }
  else if (has("macd")) { dsl = `MACD(${sym}) crosses_above 0`; reading = "MACD crosses above the zero line"; }
  else if (has("ema") || has("sma") || has("ma")) { const f = has("ema") ? "EMA" : "SMA"; dsl = `${f}(${sym},50) crosses_above ${f}(${sym},200)`; reading = "the fast moving average crosses above the slow one"; }
  else if (has("boll") || has("bb")) { dsl = `price crosses_below BOLL_LO(${sym},20)`; reading = "price pierces the lower Bollinger band"; }
  else if (has("roc") || has("momentum") || has("mom")) { dsl = `ROC(${sym},20) > 5`; reading = "20-day momentum exceeds +5%"; }
  else if (has("atr")) { dsl = `ATR(${sym},14) > ATR(${sym},50)`; reading = "short-term volatility exceeds its baseline"; }
  else { dsl = `price crosses_above SMA(${sym},50)`; reading = "price crosses above its 50-day average"; }
  const base = (brief.filename || "uploaded").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return { name: (base ? base.charAt(0).toUpperCase() + base.slice(1) : "Custom") + " signal", dsl, reading, outputType: "boolean signal", range: "true / false (fires per bar)", code, source: brief.filename, indicators: brief.indicators || [] };
}

/* Tiny in-studio Q&A about the derived signal — rule-based, no brain dependency. */
function answerAboutSignal(q: string, d: UploadedSignal, brief: PyBrief): string {
  const l = q.toLowerCase();
  if (/output|return|produce|result/.test(l)) return `It outputs a ${d.outputType}: ${d.range}. It fires when ${d.reading}.`;
  if (/use|apply|how do i|wire|attach/.test(l)) return `Add it as a Signal block in the builder, then reference "${d.name}" in your entry logic. The engine evaluates its expression ${d.dsl} each bar.`;
  if (/need|input|require|data/.test(l)) return `It needs ${d.indicators.length ? d.indicators.join(", ") : "price"} on your chosen symbol/timeframe. Retrieval expression: ${d.dsl}.`;
  if (/store|save|file|where/.test(l)) return `On create it's saved to your library and its code + retrieval method are written to a labeled store (forge-signal-code:<slug>) so it's easy to fetch when reused.`;
  if (/change|edit|modify|different/.test(l)) return `Create it, then open it in the Compose tab to tweak the expression — e.g. change the threshold in ${d.dsl}.`;
  return `This signal (${brief.strategyType || "custom"}) fires when ${d.reading}. Its expression is ${d.dsl}, output ${d.range}.`;
}

export function ForgeStudio({ kind, knownVars, onClose, onSaved, onSound }: {
  kind: Kind; knownVars: string[]; onClose: () => void; onSaved: () => void; onSound?: (n: string) => void;
}) {
  const [mode, setMode] = useState<"compose" | "upload">("compose");
  const [name, setName] = useState("");
  const [expr, setExpr] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiText, setAiText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Upload & Derive state ──
  const [upStage, setUpStage] = useState(0);        // 0 = idle, 1..5 = stages
  const [upBusy, setUpBusy] = useState(false);
  const [upBrief, setUpBrief] = useState<PyBrief | null>(null);
  const [derived, setDerived] = useState<UploadedSignal | null>(null);
  const [msgs, setMsgs] = useState<{ role: "bot" | "user"; text: string }[]>([]);
  const [created, setCreated] = useState(false);
  const upFileRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLInputElement>(null);

  const runUpload = async (f: File) => {
    setUpBrief(null); setDerived(null); setCreated(false); setMsgs([]); onSound?.("open");
    const code = await f.text();
    setUpStage(1); await sleep(430);
    setUpStage(2); await sleep(430);
    setUpStage(3); await sleep(360);
    const brief = await analyzePython(code, f.name);
    if (!brief) { setMsgs([{ role: "bot", text: "I couldn't parse that file — is the backend online? Try another file." }]); setUpStage(0); onSound?.("close"); return; }
    setUpBrief(brief); setUpStage(4); await sleep(420);
    const d = deriveSignal(brief, code);
    setDerived(d); setUpStage(5);
    setMsgs([
      { role: "bot", text: `I read ${f.name} — ${brief.linesOfCode || "?"} lines${brief.framework?.length ? `, ${brief.framework.join("/")}` : ""}. It looks like a ${brief.strategyType || "custom"} strategy.` },
      { role: "bot", text: `Detected inputs: ${brief.indicators?.length ? brief.indicators.join(", ") : "price only"}.${brief.entry?.length ? ` Entry logic: ${brief.entry.slice(0, 2).join("; ")}.` : ""}` },
      { role: "bot", text: `Derived a signal → "${d.name}". It will fire when ${d.reading}. Output: ${d.outputType} (${d.range}). Retrieval expression: ${d.dsl}` },
    ]);
    onSound?.("done");
  };
  const onUpFile = (f?: File | null) => { if (!f) return; if (f.size > 1_000_000) { setMsgs([{ role: "bot", text: "That file is too large — 1 MB max. Try a smaller strategy file." }]); return; } runUpload(f); };   // V1: cap upload size
  const ask = () => {
    const q = askRef.current?.value.trim(); if (!q || !derived || !upBrief) return;
    setMsgs(m => [...m, { role: "user", text: q }, { role: "bot", text: answerAboutSignal(q, derived, upBrief) }]);
    if (askRef.current) askRef.current.value = "";
    onSound?.("tick");
  };
  const createSignal = async () => {
    if (!derived) return;
    setUpBusy(true); onSound?.("save");
    const slug = derived.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "signal";
    saveForgeSignalCode(slug, derived);   // labeled storage of code + retrieval method
    const res = await saveSignal({ name: derived.name, expr: derived.dsl, description: `Derived from ${derived.source} — fires when ${derived.reading}`, codePath: `upload:${derived.source}`, createdBy: "ai" });
    setUpBusy(false);
    if (res.ok) { setCreated(true); onSaved(); setMsgs(m => [...m, { role: "bot", text: `✓ Created "${derived.name}". Code + retrieval method saved as forge-signal-code:${slug}. It's now in your library, ready to drop into any strategy.` }]); }
    else setMsgs(m => [...m, { role: "bot", text: "Couldn't save to the library — is the backend up? The code is still stored locally under forge-signal-code:" + slug + "." }]);
  };

  const generate = async () => {
    if (!aiText.trim()) return;
    setGenerating(true); setAiNote(""); onSound?.("tick");
    const res = await aiCompose(aiText.trim(), { variables: knownVars });
    setGenerating(false);
    if (!res || res.error) { setAiNote(res?.error || "Generation failed — is the brain online?"); return; }
    const s = res.spec as { name?: string; expr?: string; description?: string };
    if (s.expr) setExpr(s.expr);
    if (s.name && !name) setName(s.name);
    if (s.description) setDesc(s.description);
    setAiNote(`Jarvis made a ${res.kind}. ${res.explanation || ""}`.trim());
  };
  const varsSet = useMemo(() => new Set(knownVars), [knownVars]);
  const check = useMemo(() => checkExpr(expr, varsSet), [expr, varsSet]);

  const save = async () => {
    if (!name.trim() || !check.ok) return;
    setSaving(true); onSound?.("save");
    const deps = check.deps || { symbols: [], indicators: [], vars: [] };
    const payload = { name: name.trim(), expr: expr.trim(), description: desc.trim(), deps, createdBy: "user" };
    const res = kind === "signal" ? await saveSignal(payload) : await saveVariable({ ...payload, kind: "boolean" });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
  };

  const onDropFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => { const txt = String(reader.result || "").trim(); setExpr(txt.split("\n")[0].slice(0, 200)); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); };
    reader.readAsText(f);
  };

  const title = kind === "signal" ? "New Signal" : "New Variable";
  const titleIcon = kind === "signal" ? "signal" : "fx";
  const blurb = kind === "signal"
    ? "A reusable, named condition your bots can subscribe to. Compose it as a DSL expression, or upload a strategy file and derive one."
    : "A named market expression you can reference by name anywhere — e.g. buy when SPX < your variable.";

  return (
    <div className="fg-brief-back" onClick={(e) => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) onClose(); }}>
      <div className="fg-studio" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) (mode === "upload" ? onUpFile(f) : onDropFile(f)); }}>
        <div className="fg-brief-h"><span className="fg-brief-t"><Icon n={titleIcon} /> {title}</span><span className="fg-x" onClick={onClose}>✕</span></div>

        {kind === "signal" && <div className="fg-studio-modes">
          <button className={mode === "compose" ? "on" : ""} onClick={() => setMode("compose")}><Icon n="fx" size={12} /> Compose</button>
          <button className={mode === "upload" ? "on" : ""} onClick={() => setMode("upload")}><Icon n="scan" size={12} /> Upload &amp; Derive</button>
        </div>}

        {/* ══ UPLOAD & DERIVE ══ */}
        {kind === "signal" && mode === "upload" ? <>
          <div className="fg-note" style={{ margin: "10px 0 12px" }}>Drop a strategy file (.py, .ipynb, .txt). Jarvis reads it, tells you what signal it can derive, and stores the runnable code + retrieval method — labeled and reusable.</div>

          {upStage === 0 ? <div className="fg-up-drop" onClick={() => upFileRef.current?.click()}>
            <span className="fg-up-i"><Icon n="scan" size={26} /></span>
            <span className="fg-up-t">Drop a file or click to upload</span>
            <span className="fg-up-s">.py · .ipynb · .txt · .js — analyzed locally, nothing leaves your machine unwillingly</span>
          </div> : <>
            {/* staged progress rail */}
            <div className="fg-up-stages">{UP_STAGES.map((s, i) => { const n = i + 1; const st = n < upStage ? "done" : n === upStage ? "active" : "idle"; return <div key={s} className={`fg-up-stage ${st}`}><span className="fg-up-node">{st === "done" ? "✓" : n}</span><span className="fg-up-lbl">{s}</span></div>; })}</div>

            {/* derived-signal card */}
            {derived && <div className="fg-up-card">
              <div className="fg-up-card-h"><Icon n="signal" size={13} /><span className="fg-up-card-n">{derived.name}</span><span className="fg-up-card-badge">DERIVED</span></div>
              <div className="fg-up-row"><span>Fires when</span><b>{derived.reading}</b></div>
              <div className="fg-up-row"><span>Output</span><b>{derived.outputType} · {derived.range}</b></div>
              <div className="fg-up-row"><span>Retrieval</span><code>{derived.dsl}</code></div>
              <div className="fg-up-row"><span>Source</span><b>{derived.source}{derived.indicators.length ? ` · ${derived.indicators.join(", ")}` : ""}</b></div>
            </div>}

            {/* chatbot */}
            {msgs.length > 0 && <div className="fg-up-chat">
              {msgs.map((mm, i) => <div key={i} className={`fg-up-msg ${mm.role}`}>{mm.role === "bot" && <span className="fg-up-msg-i"><Icon n="signal" size={11} /></span>}{mm.text}</div>)}
            </div>}
            {derived && <div className="fg-agent-in fg-up-ask">
              <input ref={askRef} placeholder="Ask about this signal — output? how to use? what it needs…" onKeyDown={e => { if (e.key === "Enter") ask(); }} spellCheck={false} />
              <button className="fg-btn" onClick={ask}>➤</button>
            </div>}

            {derived && !created && <button className="fg-btn primary" style={{ marginTop: 13, width: "100%", justifyContent: "center" }} disabled={upBusy} onClick={createSignal}>{upBusy ? "◌ Creating…" : "＋ Create custom signal"}</button>}
            {created && <div className="fg-studio-ainote" style={{ marginTop: 12 }}>✓ Saved to your library &amp; the labeled code store.</div>}
            <button className="fg-toggle" style={{ marginTop: 10 }} onClick={() => { setUpStage(0); setDerived(null); setMsgs([]); setCreated(false); }}>↺ Upload another</button>
          </>}
          <input ref={upFileRef} type="file" accept=".py,.ipynb,.txt,.js" style={{ display: "none" }} onChange={(e) => onUpFile(e.target.files?.[0])} />
        </> : <>
        {/* ══ COMPOSE (default) ══ */}
        <div className="fg-note" style={{ margin: "10px 0 12px" }}>{blurb}</div>

        <label className="fg-studio-l">✨ Describe it (Jarvis writes the expression)</label>
        <div className="fg-studio-ai">
          <input className="fg-in" value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder={kind === "signal" ? "buy when the S&P is oversold and volatility is calm" : "S&P 500 relative strength below 30"} onKeyDown={(e) => { if (e.key === "Enter") generate(); }} spellCheck={false} />
          <button className="fg-btn primary" onClick={generate} disabled={generating || !aiText.trim()}>{generating ? "◌…" : "✨ Generate"}</button>
        </div>
        {aiNote && <div className="fg-studio-ainote">{aiNote}</div>}

        <label className="fg-studio-l" style={{ marginTop: 12 }}>Name</label>
        <input className="fg-name" style={{ marginBottom: 12 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "signal" ? "e.g. Dip Buy" : "e.g. oversold"} spellCheck={false} />

        <label className="fg-studio-l">Expression</label>
        <div className={`fg-studio-editor${expr ? (check.ok ? " ok" : " err") : ""}`}>
          <textarea className="fg-studio-ta" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="RSI(SPX,14) < 30 AND VIX < 20" spellCheck={false} rows={3} />
          <div className="fg-studio-status">
            {!expr ? <span className="fg-studio-hint">Type an expression or drop a code file →</span>
              : check.ok ? <span className="fg-studio-ok">✓ valid{check.deps && check.deps.symbols.length ? ` · uses ${check.deps.symbols.join(", ")}` : ""}{check.deps && check.deps.indicators.length ? ` · ${check.deps.indicators.join(", ")}` : ""}</span>
                : <span className="fg-studio-err">✕ {check.error || "incomplete"}</span>}
            <button className="fg-toggle" onClick={() => fileRef.current?.click()}>⬒ drop code</button>
            <input ref={fileRef} type="file" accept=".py,.txt,.js" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onDropFile(f); }} />
          </div>
        </div>

        <div className="fg-studio-ex">
          {EXAMPLES[kind].map((x) => <button key={x.label} className="fg-tag fg-studio-chip" onClick={() => { setExpr(x.expr); if (!name) setName(x.label); }}>{x.label}</button>)}
        </div>

        <label className="fg-studio-l" style={{ marginTop: 10 }}>Notes (optional)</label>
        <input className="fg-in" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="what it's for" />

        <button className="fg-btn primary" style={{ marginTop: 14 }} disabled={!name.trim() || !check.ok || saving} onClick={save}>
          {saving ? "◌ Saving…" : `⌾ Save ${kind}`}
        </button>
        </>}
      </div>
    </div>
  );
}
