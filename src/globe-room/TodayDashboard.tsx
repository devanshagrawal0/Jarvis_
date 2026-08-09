import type { ReactNode } from "react";
import "./TodayDashboard.css";

// Today — focused view. Built to the 4 reference mockups: deep-space canvas, cyan primary with
// purple/blue/green semantic accents, left icon rail, "Next" hero + holographic art, four stat
// cards with sparklines + glowing underlines, Top of Mind, NOW waveform timeline, Waiting on
// Others, right rail (Focus ring, date, Quick Actions). Wired to /api/atlas/today. Decorative
// pieces (holographic art, focus ring, nav rail) are self-drawn SVG/CSS.

function command(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
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

export function TodayDashboard({ data, loading, onExpand }: { data: any; loading?: boolean; onExpand?: () => void }) {
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
  const greeting = hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : hr < 21 ? "Good evening" : "Good night";
  const dparts: Record<string, string> = (() => {
    try { return new Intl.DateTimeFormat("en-US", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: tz || undefined }).formatToParts(new Date(nowIso)).reduce((a, p) => ({ ...a, [p.type]: p.value }), {}); } catch { return {}; }
  })();
  const wk = dparts.weekday || "", dd = dparts.day || "", monYr = `${dparts.month || ""} ${dparts.year || ""}`.trim();

  // timeline axis: 5 hourly ticks centred near now; NOW marker position across the width
  const baseHr = Math.max(0, Math.min(19, hr - 1));
  const ticks = [0, 1, 2, 3, 4].map((k) => ((baseHr + k) % 24));
  const nowPct = 15 + ((hourIn(nowIso, tz) + (Number(new Date(nowIso).getMinutes()) / 60) - baseHr) / 4) * 70;

  const stat = (cls: string, ic: ReactNode, label: string, num: number | string, foot: string, a: string) => (
    <div className={`td-stat ${cls}`}>
      <div className="td-stat-top"><span className="td-stat-ic">{ic}</span><span className="chev">›</span></div>
      <div className="lbl">{label}</div>
      <div className="num">{num}</div>
      <div className="foot">{foot}</div>
      <Spark a={a} />
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
            <span className="td-online"><span className="td-dot" /> JARVIS ONLINE</span>
            <span style={{ color: "var(--td-mut)" }}>{I.search}</span>
          </div>
        </header>

        {/* Hero */}
        <section className="td-hero">
          <div className="td-hero-l">
            <div className="eyebrow">{greeting.toUpperCase()}{data?.place ? ` · ${data.place}` : ""}</div>
            <h2>
              <span className="lead">{now ? "Now:" : next ? "Next:" : "Today"}</span>
              {focusEvent ? <><span className="td-gem">◈</span>{focusEvent.title}</> : <span className="lead" style={{ fontSize: 22 }}>the day is clear</span>}
            </h2>
            <div className="meta">
              {focusEvent ? <span>Starts at {clockOf(focusEvent.startAt, tz)}{focusEvent.location ? ` · ${focusEvent.location}` : ""}</span> : <span>Nothing scheduled — a good day to get ahead.</span>}
              {now && <span className="td-live"><span className="td-dot" /> LIVE NOW</span>}
            </div>
          </div>
          {focusEvent && <button className="td-hero-btn" onClick={() => command(`Prepare me for "${focusEvent.title}" — the context, the people, and what I need.`)}>{now ? "JOIN NOW" : "VIEW DETAILS"} ›</button>}
          <svg className="td-hero-art" viewBox="0 0 320 320" fill="none">
            <defs><radialGradient id="planet" cx="50%" cy="45%" r="55%"><stop offset="0" stopColor="#2aa6d6" stopOpacity=".5" /><stop offset="1" stopColor="#0a1830" stopOpacity="0" /></radialGradient></defs>
            <circle cx="170" cy="150" r="82" fill="url(#planet)" stroke="rgba(69,224,255,.35)" strokeWidth="1" />
            {[0, 1, 2].map((k) => <ellipse key={k} cx="170" cy="150" rx={128 - k * 6} ry={38 - k * 4} stroke="rgba(69,224,255,.18)" strokeWidth="1" transform={`rotate(${-18 + k * 3} 170 150)`} />)}
            <circle cx="292" cy="118" r="2.5" fill="#8fdcff" />
          </svg>
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
            <div className="td-task" key={t.id}>
              <div className={`td-task-badge ${t.priority >= 3 ? "hi" : ""}`}>!!</div>
              <div className="td-task-main"><strong>{t.title}</strong><small>{t.dueAt ? `Due ${clockOf(t.dueAt, tz)}` : "No due time"}{t.waitingOn === "them" && t.actor ? ` · waiting on ${t.actor}` : ""}</small></div>
              <button className="td-icon-btn" title="Save">☆</button>
              <button className="td-icon-btn" title="More">⋯</button>
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
            <div className="td-panel-h"><div><div className="t">Timeline</div><div className="n">{timeline.length} today</div></div></div>
            <div className="td-timeline">
              <div className="td-axis">{ticks.map((h, i) => <span key={i}>{i === 1 ? <span className="td-now-pill">NOW</span> : `${((h % 12) || 12)} ${h < 12 ? "AM" : "PM"}`}</span>)}</div>
              <svg className="td-wave" viewBox="0 0 400 54" preserveAspectRatio="none">
                <defs><linearGradient id="wv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#45e0ff" /><stop offset="1" stopColor="#46e6b0" /></linearGradient></defs>
                <path d="M0 40 L400 40" stroke="rgba(120,200,240,.12)" strokeWidth="1" />
                <path d={Array.from({ length: 41 }, (_, i) => { const x = i * 10; const y = 40 - Math.abs(Math.sin(i * 0.7)) * (i < 20 ? 6 + i : 26 - (i - 20)) * 0.6; return `${i ? "L" : "M"}${x} ${Math.max(8, y)}`; }).join(" ")} fill="none" stroke="url(#wv)" strokeWidth="2" strokeLinecap="round" />
                <circle cx={4 * (nowPct)} cy="26" r="4" fill="#45e0ff" />
                <circle cx={4 * (nowPct)} cy="26" r="9" fill="none" stroke="#45e0ff" strokeOpacity=".4" />
              </svg>
            </div>
          </div>
          <div className="td-panel">
            <div className="td-panel-h b"><div><div className="t">Waiting on Others</div><div className="n">{waiting.length}</div></div><div className="r">Delegated / replies</div></div>
            <div className="td-wait">
              {waiting.length ? waiting.slice(0, 3).map((t) => (
                <div className="td-person" key={t.id} style={{ marginBottom: 8 }}>
                  <div className="td-avatar">{(t.actor || "?").split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
                  <div className="who"><strong>{t.actor || t.title}</strong><small>{t.actor ? "Waiting for response" : t.title}</small></div>
                  <span className="td-dot" style={{ background: "var(--td-blue)", boxShadow: "0 0 8px var(--td-blue)" }} />
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
          <div className="td-qa-row" onClick={() => command("Create a new task: ")}><span className="td-qa-ic">{I.plus}</span><strong>New Task</strong><span className="chev">›</span></div>
          <div className="td-qa-row" onClick={() => command("Take a new note: ")}><span className="td-qa-ic">{I.note}</span><strong>New Note</strong><span className="chev">›</span></div>
          <div className="td-qa-row" onClick={() => command("Listen for a voice command.")}><span className="td-qa-ic">{I.mic}</span><strong>Voice Command</strong><span className="chev">›</span></div>
        </div>
      </aside>
    </div>
  );
}
