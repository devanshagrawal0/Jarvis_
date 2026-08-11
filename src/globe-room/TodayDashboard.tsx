import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import "./TodayDashboard.css";
import heroArt from "./assets/hero-planet.png";

// Today — focused view. Built to the 4 reference mockups: deep-space canvas, cyan primary with
// purple/blue/green semantic accents, left icon rail, "Next" hero + holographic art, four stat
// cards with sparklines + glowing underlines, Top of Mind, NOW waveform timeline, Waiting on
// Others, right rail (Focus ring, date, Quick Actions). Wired to /api/atlas/today. Decorative
// pieces (holographic art, focus ring, nav rail) are self-drawn SVG/CSS.

function command(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
}
// Grant one Google capability bundle (gmail_read / calendar_write) RIGHT HERE in Today — opens the
// consent popup, no trip to a separate settings screen. The window regains focus when consent finishes,
// which is what triggers the status re-fetch below.
async function connectGoogle(bundle: string) {
  try {
    const r = await fetch(`/api/oauth/google/start?bundles=${encodeURIComponent(bundle)}`);
    const d = await r.json().catch(() => ({}));
    if (d?.authorizationUrl) window.open(d.authorizationUrl, "_blank", "noopener,noreferrer");
    else command(`I tried to start the Google "${bundle}" connection but got no authorization URL. What's blocking it?`);
  } catch { command("The Google connection couldn't start — check that OAuth credentials are configured."); }
}
const clockOf = (iso?: string | null, tz?: string) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }); } catch { return ""; }
};
const hourIn = (iso: string, tz?: string) => {
  try { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz || undefined }).format(new Date(iso))); } catch { return new Date().getHours(); }
};

// ── inline icons (line style) ───────────────────────────────────────────────
const I = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>,
  tasks: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 12l3 3 5-6" /></svg>,
  focus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></svg>,
  planner: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  analytics: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  agents: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3" r="1.6" /><circle cx="12" cy="21" r="1.6" /><circle cx="4" cy="8" r="1.6" /><circle cx="20" cy="8" r="1.6" /><path d="M12 6v3M12 15v4M9.5 10L5 8.5M14.5 10L19 8.5" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 6L9 17l-5-5" /></svg>,
  brain: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 3a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 001 4 3 3 0 004 3V3z" /><path d="M15 3a3 3 0 013 3 3 3 0 012 5 3 3 0 01-1 4 3 3 0 01-4 3V3z" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.5a3 3 0 010 5.8M18 20c0-2.4-1-4-2.5-4.6" /></svg>,
  bell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 20a2 2 0 004 0" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>,
  note: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 3h11l3 3v15H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  mic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>,
};

function Spark({ a }: { a: string }) {
  const pts = [2, 9, 6, 5, 10, 8, 6, 11, 7, 13, 18, 12].map((v, i) => `${i * 7},${30 - v}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 78 30" preserveAspectRatio="none">
      <defs><linearGradient id={`sg-${a}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} stopOpacity=".4" /><stop offset="1" stopColor={a} stopOpacity="0" /></linearGradient></defs>
      <polyline points={`0,30 ${pts} 78,30`} fill={`url(#sg-${a})`} stroke="none" />
      <polyline points={pts} fill="none" stroke={a} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity=".9" />
    </svg>
  );
}

export function TodayDashboard({ data, loading, onExpand, onRefresh }: { data: any; loading?: boolean; onExpand?: () => void; onRefresh?: () => void }) {
  const tz = data?.tz;
  const nowIso: string = data?.now || new Date().toISOString();
  const now = data?.nowNext?.now || null;
  const next = data?.nowNext?.next || null;
  const focusEvent = now || next;
  const timeline: any[] = data?.timeline || [];
  const top: any[] = data?.topOfMind || [];
  const waiting: any[] = data?.waitingOnThem || [];
  const c = data?.counts || {};
  const hr = hourIn(nowIso, tz);
  // Live ticking clock — the hero anchor when the day is clear (real + useful, not filler text).
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setTick(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  // Which Google capabilities are live, so Today can offer to enable the missing ones inline. Re-checks
  // when the window regains focus (i.e. right after the consent popup closes).
  const [gcap, setGcap] = useState<{ calWrite: boolean; mailRead: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/health"); const j = await r.json();
        const s = j?.providers?.google?.services || {};
        const connected = j?.providers?.google?.connected;
        if (alive) setGcap(connected ? { calWrite: !!s.calendar?.canWrite, mailRead: !!s.gmail?.canRead } : null);
      } catch { /* leave null → offer nothing rather than a wrong prompt */ }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.removeEventListener("focus", onFocus); };
  }, []);
  const [liveTime, liveAp] = (() => {
    try { return new Date(tick).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }).split(" "); } catch { return ["", ""]; }
  })();
  const dparts: Record<string, string> = (() => {
    try { return new Intl.DateTimeFormat("en-US", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: tz || undefined }).formatToParts(new Date(nowIso)).reduce((a, p) => ({ ...a, [p.type]: p.value }), {}); } catch { return {}; }
  })();
  const wk = dparts.weekday || "", dd = dparts.day || "", monYr = `${dparts.month || ""} ${dparts.year || ""}`.trim();

  // timeline axis: 5 hourly ticks centred near now; NOW marker position across the width
  const baseHr = Math.max(0, Math.min(19, hr - 1));
  const ticks = [0, 1, 2, 3, 4].map((k) => ((baseHr + k) % 24));
  const nowPct = 15 + ((hourIn(nowIso, tz) + (Number(new Date(nowIso).getMinutes()) / 60) - baseHr) / 4) * 70;
  // Plot real events on the ruler (only those inside the visible 5-hour window). No invented waveform.
  const eventDots = timeline
    .map((e: any) => { const h = hourIn(e.startAt, tz) + (Number(new Date(e.startAt).getMinutes()) / 60); const pct = 15 + ((h - baseHr) / 4) * 70; return { pct, x: 4 * pct }; })
    .filter((d) => d.pct >= 4 && d.pct <= 96);

  // ── Wave 2: natural-language quick capture ──────────────────────────────────
  const capRef = useRef<HTMLInputElement>(null);
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const flashTimer = useRef<number | null>(null);
  const showFlash = (ok: boolean, msg: string) => {
    setFlash({ ok, msg });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 4200);
  };
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  const seed = (s: string) => {
    setCap(s);
    window.setTimeout(() => { const el = capRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = s.length; } }, 0);
  };
  const submitCapture = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setCap("");                                                    // clear immediately so a second Enter can't resend the same text
    try {
      const r = await fetch("/api/atlas/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t, tz }) });
      const d = await r.json().catch(() => ({}));
      if (d && d.ok) { showFlash(true, d.message || "Captured."); onRefresh?.(); }
      else { command(t); showFlash(true, "Not a task or reminder — sent to Jarvis."); }   // let the brain handle non-capture text
    } catch { setCap(t); showFlash(false, "Couldn't reach the day-model. Is the backend running?"); }  // restore text so it isn't lost
    finally { setBusy(false); }
  };

  // ── Wave 3: act on the board (complete / snooze / drop / cancel / remove) ────
  const [pending, setPending] = useState<Set<string>>(new Set());   // ids mid-flight, for row fade
  const mark = (id: string, on: boolean) => setPending((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });
  const act = async (id: string, run: () => Promise<Response>) => {
    if (pending.has(id)) return;
    mark(id, true);
    try { const r = await run(); if (r.ok) onRefresh?.(); } catch { /* leave the row; a refresh will reconcile */ }
    finally { mark(id, false); }
  };
  const patchTask = (id: string, body: Record<string, unknown>) => act(id, () => fetch(`/api/atlas/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const completeTask = (id: string) => patchTask(id, { status: "done" });
  const dropTask = (id: string) => patchTask(id, { status: "dropped" });
  const snoozeTask = (id: string) => patchTask(id, { dueAt: new Date(Date.now() + 3600_000).toISOString() });   // +1h
  const cancelReminder = (id: string) => act(id, () => fetch(`/api/atlas/reminders/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  const removeEvent = (id: string) => act(id, () => fetch(`/api/atlas/events/${id}`, { method: "DELETE" }));
  // inline rename — double-click a title to edit; Enter/blur saves, Escape cancels
  const [editing, setEditing] = useState<{ id: string; kind: "task" | "event" | "reminder"; value: string } | null>(null);
  const startEdit = (id: string, kind: "task" | "event" | "reminder", value: string) => setEditing({ id, kind, value });
  const saveEdit = async () => {
    if (!editing) return;
    const { id, kind, value } = editing;
    const title = value.trim();
    setEditing(null);
    if (!title) return;
    const url = kind === "task" ? `/api/atlas/tasks/${id}` : kind === "event" ? `/api/atlas/events/${id}` : `/api/atlas/reminders/${id}`;
    await act(id, () => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }));
  };
  const editBox = (id: string, kind: "task" | "event" | "reminder", value: string, cls = "") => (
    <input className={`td-edit ${cls}`} autoFocus value={editing?.value ?? value}
      onChange={(e) => setEditing((cur) => cur ? { ...cur, value: e.target.value } : cur)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(); } else if (e.key === "Escape") setEditing(null); }}
      onBlur={() => void saveEdit()} />
  );
  // upcoming agenda = today's events + pending reminders, merged and time-sorted, each cancelable
  const reminders: any[] = data?.reminders || [];
  const agenda = [
    ...timeline.map((e: any) => ({ kind: "event", id: e.id, title: e.title, at: e.startAt, loc: e.location, google: e.source?.kind === "google" || String(e.id).startsWith("gcal_") })),
    ...reminders.map((r: any) => ({ kind: "reminder", id: r.id, title: r.title, at: r.fireAt, loc: null, google: false })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const stat = (cls: string, ic: ReactNode, label: string, num: number | string, foot: string, a: string) => (
    <div className={`td-stat ${cls}`}>
      <div className="td-stat-top"><span className="td-stat-ic">{ic}</span><span className="chev">›</span></div>
      <div className="lbl">{label}</div>
      <div className="num">{num}</div>
      <div className="foot">{foot}</div>
    </div>
  );

  return (
    <div className="td-root">
      {/* ── Left rail ── */}
      <aside className="td-rail">
        <div className="td-logo">◆</div>
        <nav className="td-nav">
          <div className="td-nav-item on">{I.home}<span>HOME</span></div>
          <div className="td-nav-item" onClick={() => command("Show all my open tasks from Today — waiting on me and waiting on others.")}>{I.tasks}<span>TASKS</span>{c.openTasks ? <i className="td-nav-badge">{c.openTasks}</i> : null}</div>
          <div className="td-nav-item soon">{I.focus}<span>FOCUS</span></div>
          <div className="td-nav-item soon">{I.planner}<span>PLANNER</span></div>
          <div className="td-nav-item soon">{I.analytics}<span>ANALYTICS</span></div>
          <div className="td-nav-item soon">{I.agents}<span>AGENTS</span></div>
          <div className="td-nav-item soon">{I.settings}<span>SETTINGS</span></div>
        </nav>
        <div className="td-reactor">◆</div>
        <div className="td-rail-name">JARVIS</div>
        <div className="td-rail-status">● ONLINE</div>
      </aside>

      {/* ── Main ── */}
      <main className="td-main">
        <header className="td-topbar">
          <div>
            <h1>TODAY</h1>
            <div className="sub"><span className="td-dot" /> {clockOf(nowIso, tz)} · {now ? "Live now" : "On schedule"}</div>
          </div>
          <div className="td-top-right">
            {gcap && !gcap.calWrite ? <button className="td-connect" title="Let Jarvis create, move and cancel calendar events — each change is previewed for your OK first." onClick={() => connectGoogle("calendar_write")}>⊕ Enable calendar editing</button> : null}
            {gcap && !gcap.mailRead ? <button className="td-connect" title="Let Jarvis read your inbox to surface replies you owe. Read-only — it never sends." onClick={() => connectGoogle("gmail_read")}>⊕ Read email</button> : null}
            <span className="td-online"><span className="td-dot" /> JARVIS ONLINE</span>
            <span style={{ color: "var(--td-mut)" }}>{I.search}</span>
          </div>
        </header>

        {/* Quick capture — say it, it lands in Today (deterministic; falls back to Jarvis) */}
        <div className={`td-capture ${flash ? (flash.ok ? "ok" : "err") : ""} ${busy ? "busy" : ""}`}>
          <span className="td-capture-ic">{I.plus}</span>
          <input
            ref={capRef}
            className="td-capture-input"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitCapture(cap); } }}
            placeholder={"Tell me to remember something — “remind me to call the bank at 5”, “lunch with Priya tomorrow at 1”, “note: parking is B12”"}
            aria-label="Quick capture a task, reminder, event, or note"
          />
          {flash
            ? <span className={`td-capture-flash ${flash.ok ? "ok" : "err"}`}>{flash.msg}</span>
            : <button className="td-capture-send" onClick={() => void submitCapture(cap)} disabled={!cap.trim() || busy}>{busy ? "Saving…" : "Capture ⏎"}</button>}
        </div>

        {/* Hero — embedded 4K art + live-motion layers (rings, glow, particles, ken-burns parallax) */}
        <section className="td-hero">
          <div className="td-hero-bg" style={{ backgroundImage: `url(${heroArt})` }} />
          <div className="td-hero-glow" />
          <svg className="td-hero-rings" viewBox="0 0 300 300" fill="none">
            <g className="r1">{[132, 118, 104].map((r, i) => <ellipse key={i} cx="150" cy="150" rx={r} ry={r * 0.32} stroke="rgba(79,227,255,.3)" strokeWidth="1" transform="rotate(-16 150 150)" />)}</g>
            <g className="r2">{[92, 78].map((r, i) => <ellipse key={i} cx="150" cy="150" rx={r} ry={r * 0.34} stroke="rgba(177,139,255,.28)" strokeWidth="1" transform="rotate(-16 150 150)" />)}</g>
          </svg>
          <div className="td-hero-particles" />
          <div className="td-hero-fade" />
          <div className="td-hero-l">
            <div className="eyebrow">{wk ? wk.toUpperCase() : "TODAY"}{dd ? ` · ${(dparts.month || "").toUpperCase()} ${dd.replace(/^0/, "")}` : ""}</div>
            {focusEvent ? (
              <>
                <div className="td-kick">{now ? <span className="td-live"><span className="td-dot" /> LIVE NOW</span> : <>NEXT UP{next?.startAt ? ` · ${clockOf(next.startAt, tz)}` : ""}</>}</div>
                <h2><span className="td-gem">◈</span><span className="ttl">{focusEvent.title}</span></h2>
                <div className="meta"><span>{now ? "In progress" : "Starts"} {clockOf(focusEvent.startAt, tz)}{focusEvent.location ? ` · ${focusEvent.location}` : ""}</span></div>
              </>
            ) : (
              <>
                <div className="td-clock">{liveTime}<span className="ap">{liveAp}</span></div>
                <div className="td-chips">
                  <span className="td-chip"><i style={{ background: "var(--td-cyan)" }} />{c.openTasks ?? 0} open task{(c.openTasks ?? 0) === 1 ? "" : "s"}</span>
                  <span className="td-chip"><i style={{ background: "var(--td-green)" }} />{c.pendingReminders ?? 0} reminder{(c.pendingReminders ?? 0) === 1 ? "" : "s"}</span>
                  <span className="td-chip"><i style={{ background: "var(--td-purple)" }} />{timeline.length ? `${timeline.length} event${timeline.length === 1 ? "" : "s"}` : "nothing scheduled"}</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Stat cards */}
        <section className="td-stats">
          {stat("", I.check, "Open Tasks", c.openTasks ?? 0, "to do", "#45e0ff")}
          {stat("p", I.brain, "Top of Mind", top.length, "need you today", "#a889ff")}
          {stat("b", I.users, "Waiting on Others", c.waitingOnThem ?? 0, "delegated / replies", "#4aa0ff")}
          {stat("g", I.bell, "Reminders Set", c.pendingReminders ?? 0, "will fire on time", "#46e6b0")}
        </section>

        {/* Top of mind */}
        <section className="td-panel">
          <div className="td-tom-glow" />
          <div className="td-panel-h p">
            <div><div className="t">Top of Mind</div><div className="n">{top.length ? `${top.length} for today` : "All clear"}</div></div>
            <div className="r"><span>Due today or high priority</span><span className="sort">⇅ Sort</span></div>
          </div>
          {top.length ? top.slice(0, 3).map((t) => (
            <div className={`td-task ${pending.has(t.id) ? "is-busy" : ""}`} key={t.id}>
              <button className={`td-check ${t.priority >= 3 ? "hi" : ""}`} title="Mark done" onClick={() => completeTask(t.id)} />
              <div className="td-task-main">{editing?.id === t.id ? editBox(t.id, "task", t.title) : <strong onDoubleClick={() => startEdit(t.id, "task", t.title)} title="Double-click to rename">{t.title}</strong>}<small>{t.dueAt ? `Due ${clockOf(t.dueAt, tz)}` : "No due time"}{t.waitingOn === "them" && t.actor ? ` · waiting on ${t.actor}` : ""}</small></div>
              <button className="td-icon-btn" title="Snooze 1 hour" onClick={() => snoozeTask(t.id)}>⏰</button>
              <button className="td-icon-btn" title="Dismiss" onClick={() => dropTask(t.id)}>✕</button>
            </div>
          )) : <div className="td-empty">Nothing urgent is due today. Add a task and it shows here.</div>}
          <div className="td-tom-actions">
            <button className="td-oline" onClick={() => command("Plan my day from my tasks, calendar and top-of-mind. Realistic order, protect focus time, flag risks. Don't invent items.")}>▦ Plan my day</button>
            <button className="td-oline p" onClick={() => command("What am I forgetting today? Check open tasks, reminders and what I'm waiting on others for. Be concise and honest.")}>💡 What am I forgetting?</button>
          </div>
        </section>

        {/* Bottom row */}
        <section className="td-bottom">
          <div className="td-panel">
            <div className="td-panel-h"><div><div className="t">Up Next</div><div className="n">{agenda.length ? `${agenda.length} today` : "clear"}</div></div><div className="r">Events &amp; reminders</div></div>
            <div className="td-timeline">
              <div className="td-axis">{ticks.map((h, i) => <span key={i}>{i === 1 ? <span className="td-now-pill">NOW</span> : `${((h % 12) || 12)} ${h < 12 ? "AM" : "PM"}`}</span>)}</div>
              <svg className="td-wave" viewBox="0 0 400 54" preserveAspectRatio="none">
                <path d="M8 40 L392 40" stroke="rgba(120,200,240,.16)" strokeWidth="1.5" strokeLinecap="round" />
                {/* real events plotted on the hour ruler — no invented waveform */}
                {eventDots.map((d, i) => (
                  <g key={i}>
                    <line x1={d.x} y1="40" x2={d.x} y2="18" stroke="rgba(69,224,255,.5)" strokeWidth="1.5" />
                    <circle cx={d.x} cy="16" r="4.5" fill="#45e0ff" />
                  </g>
                ))}
                <circle cx={4 * nowPct} cy="40" r="4" fill="#46e6b0" />
                <circle cx={4 * nowPct} cy="40" r="9" fill="none" stroke="#46e6b0" strokeOpacity=".45" />
              </svg>
            </div>
            <div className="td-agenda">
              {agenda.length ? agenda.slice(0, 4).map((it) => (
                <div className={`td-agenda-row ${pending.has(it.id) ? "is-busy" : ""}`} key={`${it.kind}-${it.id}`}>
                  <span className={`td-agenda-ic ${it.kind}`}>{it.kind === "event" ? "◈" : "⏰"}</span>
                  <div className="td-agenda-main">{!it.google && editing?.id === it.id ? editBox(it.id, it.kind as "event" | "reminder", it.title) : <strong onDoubleClick={() => { if (!it.google) startEdit(it.id, it.kind as "event" | "reminder", it.title); }} title={it.google ? "From Google Calendar" : "Double-click to rename"}>{it.title}</strong>}<small>{clockOf(it.at, tz)}{it.loc ? ` · ${it.loc}` : it.google ? " · Google Calendar" : it.kind === "reminder" ? " · reminder" : ""}</small></div>
                  {it.google
                    ? <span className="td-agenda-badge" title="Read-only — from Google Calendar">G</span>
                    : <button className="td-icon-btn" title={it.kind === "event" ? "Remove event" : "Cancel reminder"} onClick={() => it.kind === "event" ? removeEvent(it.id) : cancelReminder(it.id)}>✕</button>}
                </div>
              )) : <div className="td-empty">Nothing coming up. Capture a reminder or event above.</div>}
            </div>
          </div>
          <div className="td-panel">
            <div className="td-panel-h b"><div><div className="t">Waiting on Others</div><div className="n">{waiting.length}</div></div><div className="r">Delegated / replies</div></div>
            <div className="td-wait">
              {waiting.length ? waiting.slice(0, 3).map((t) => (
                <div className={`td-person ${pending.has(t.id) ? "is-busy" : ""}`} key={t.id} style={{ marginBottom: 8 }}>
                  <div className="td-avatar">{(t.actor || "?").split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div className="who"><strong>{t.actor || t.title}</strong><small>{t.actor ? t.title : "Waiting for response"}</small></div>
                  <button className="td-pill-btn" title="Nudge them" onClick={() => command(`Draft a short, friendly nudge to ${t.actor || "them"} about: ${t.title}`)}>Nudge</button>
                  <button className="td-pill-btn ok" title="Mark received / done" onClick={() => completeTask(t.id)}>✓ Got it</button>
                </div>
              )) : <div className="td-empty">You're not blocked on anyone right now.</div>}
            </div>
          </div>
        </section>
      </main>

      {/* ── Right rail ── */}
      <aside className="td-side">
        <div className="td-card">
          <div className="h">Focus Mode</div>
          <div className="td-focus-ring">
            <svg viewBox="0 0 130 130">
              {[58, 48, 38].map((r, i) => <circle key={i} cx="65" cy="65" r={r} fill="none" stroke="rgba(69,224,255,.28)" strokeWidth="1" strokeDasharray={i === 0 ? "3 6" : "none"} />)}
              <circle cx="65" cy="65" r="58" fill="none" stroke="#45e0ff" strokeWidth="2" strokeDasharray="140 260" strokeLinecap="round" opacity=".8" />
            </svg>
            <div className="core" />
          </div>
          <div className="td-focus-txt"><strong>Stay in the zone</strong><small>Minimize distractions</small></div>
          <button className="td-btn" onClick={() => command("Start a 45-minute focus session — mute low-priority notifications and protect the time.")}>START FOCUS</button>
        </div>

        <div className="td-card td-date">
          <div className="h">{(wk || "TODAY").toUpperCase()} <span className="arrows"><button>‹</button><button>›</button></span></div>
          <div className="big">{dd || clockOf(nowIso, tz).replace(/\D/g, "").slice(0, 2)}</div>
          <div className="mon">{(monYr || "").toUpperCase()}</div>
          <p className="note">{timeline.length ? `${timeline.length} event${timeline.length === 1 ? "" : "s"} scheduled today.` : "No events scheduled. Enjoy your free time."}</p>
          <button className="td-btn" style={{ marginTop: 14 }} onClick={() => command("Show my calendar for this week.")}>VIEW CALENDAR</button>
        </div>

        <div className="td-card">
          <div className="h" style={{ marginBottom: 6 }}>Quick Actions</div>
          <div className="td-qa-row" onClick={() => seed("Add a task: ")}><span className="td-qa-ic">{I.plus}</span><strong>New Task</strong><span className="chev">›</span></div>
          <div className="td-qa-row" onClick={() => seed("Note: ")}><span className="td-qa-ic">{I.note}</span><strong>New Note</strong><span className="chev">›</span></div>
          <div className="td-qa-row" onClick={() => command("Listen for a voice command.")}><span className="td-qa-ic">{I.mic}</span><strong>Voice Command</strong><span className="chev">›</span></div>
        </div>
      </aside>
    </div>
  );
}
