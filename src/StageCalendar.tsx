import { type ReactNode } from "react";

// ── The Calendar room (W3b) ───────────────────────────────────────────────────────────────────
// A pixel-close recreation of Dev's reference: HUD frame, header + DAY/WEEK/MONTH tabs, a left
// time-grid day view, and a right sidebar (mini-month, today's schedule, upcoming). Real events
// only — nothing is invented. WEEK/MONTH tab content comes later; DAY is the live view.

export type CalEvent = { title: string; startAt?: string; endAt?: string; allDay?: boolean; location?: string };

const STYLE = `
.cr { position: relative; width: 100%; height: 100%; box-sizing: border-box; padding: 20px 26px;
  background: radial-gradient(120% 90% at 50% 0%, #0a1420 0%, #05090f 70%); color: #dbeaf5;
  font-family: inherit; overflow: hidden; }
.cr-frame { position: absolute; inset: 6px; border: 1px solid rgba(70,180,225,.3); border-radius: 8px; pointer-events: none;
  box-shadow: 0 0 34px -12px rgba(64,219,243,.4), inset 0 0 46px -32px rgba(64,219,243,.35); }
.cr-br { position: absolute; width: 62px; height: 62px; border-color: #4ce4ff; pointer-events: none;
  filter: drop-shadow(0 0 9px rgba(76,228,255,.9)); }
.cr-br.tl { top: 2px; left: 2px; border-top: 3px solid; border-left: 3px solid; border-top-left-radius: 11px; }
.cr-br.tr { top: 2px; right: 2px; border-top: 3px solid; border-right: 3px solid; border-top-right-radius: 11px; }
.cr-br.bl { bottom: 2px; left: 2px; border-bottom: 3px solid; border-left: 3px solid; border-bottom-left-radius: 11px; }
.cr-br.br { bottom: 2px; right: 2px; border-bottom: 3px solid; border-right: 3px solid; border-bottom-right-radius: 11px; }

.cr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.cr-head-l { display: flex; align-items: center; gap: 16px; }
.cr-ico { width: 58px; height: 58px; display: grid; place-items: center; color: #40dbf3; flex: none;
  border: 1.5px solid rgba(64,219,243,.55); border-radius: 12px; background: rgba(20,60,80,.18);
  box-shadow: 0 0 14px -2px rgba(64,219,243,.4), inset 0 0 14px -6px rgba(64,219,243,.5);
  clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px); }
.cr-title { font-size: 27px; font-weight: 700; letter-spacing: .06em; color: #eaf6fd; line-height: 1.05; text-shadow: 0 0 12px rgba(120,210,240,.25); }
.cr-sub { font-size: 13px; color: #8090a0; margin-top: 3px; }
.cr-tabs { display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 12px; border: 1px solid rgba(70,150,190,.22); background: rgba(10,22,36,.5); }
.cr-tab { font-size: 13px; letter-spacing: .1em; font-weight: 600; color: #8fa2b0; padding: 8px 22px; border-radius: 9px; border: 1px solid transparent; }
.cr-tab.on { color: #bfeeff; border-color: rgba(64,219,243,.7); background: rgba(30,80,105,.3); box-shadow: 0 0 12px -3px rgba(64,219,243,.55), inset 0 0 10px -4px rgba(64,219,243,.5); }

.cr-body { display: grid; grid-template-columns: minmax(0,1fr) 316px; gap: 24px; height: calc(100% - 80px); }
.cr-main { min-width: 0; display: flex; flex-direction: column; }
.cr-datenav { display: flex; align-items: center; justify-content: center; gap: 20px; margin: 2px 0 16px; }
.cr-date { font-size: 21px; font-weight: 700; letter-spacing: .09em; color: #eaf6fd; }
.cr-chev { color: #40dbf3; font-size: 26px; line-height: 1; cursor: default; filter: drop-shadow(0 0 5px rgba(64,219,243,.5)); }

.cr-grid { position: relative; flex: 1 1 auto; overflow-y: auto; padding-right: 4px; }
.cr-hour { position: absolute; left: 0; right: 0; height: 0; }
.cr-hour-lbl { position: absolute; left: 0; top: -8px; width: 62px; text-align: right; font-size: 12px; color: #7c8b98; font-variant-numeric: tabular-nums; }
.cr-hour-line { position: absolute; left: 82px; right: 2px; top: 0; height: 1px; background: rgba(90,140,180,.1); }
.cr-vline { position: absolute; left: 78px; top: 0; bottom: 0; width: 1px; background: rgba(90,140,180,.12); }
.cr-allday { position: absolute; left: 82px; right: 2px; }
.cr-allday-lbl { position: absolute; left: 0; width: 62px; text-align: right; font-size: 11px; letter-spacing: .06em; color: #7c8b98; margin-left: -82px; margin-top: 12px; }
.cr-allday-box { display: flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 9px; border: 1px solid rgba(70,150,190,.2);
  background: linear-gradient(180deg, rgba(14,28,44,.55), rgba(9,17,29,.5)); font-size: 14px; color: #dbeaf5; }
.cr-now { position: absolute; left: 0; right: 0; height: 0; z-index: 5; }
.cr-now-pill { position: absolute; left: 4px; top: -12px; width: 54px; text-align: center; font-size: 12px; color: #40dbf3; font-weight: 700;
  border: 1px solid rgba(64,219,243,.8); border-radius: 7px; padding: 3px 0; background: rgba(10,30,42,.7); box-shadow: 0 0 10px -2px rgba(64,219,243,.6); }
.cr-now-dot { position: absolute; left: 78px; top: -3.5px; width: 7px; height: 7px; border-radius: 50%; background: #40dbf3; box-shadow: 0 0 9px rgba(64,219,243,.9); }
.cr-now-line { position: absolute; left: 85px; right: 2px; top: 0; height: 1.5px; background: rgba(64,219,243,.55); }
.cr-ev { position: absolute; left: 82px; right: 2px; display: flex; align-items: center; gap: 4px; overflow: hidden;
  border: 1px solid rgba(80,160,200,.2); border-radius: 10px; padding: 0 18px;
  background: linear-gradient(180deg, rgba(16,32,50,.62), rgba(9,18,30,.55)); }
.cr-ev.near { border-color: rgba(64,219,243,.4); box-shadow: 0 0 18px -8px rgba(64,219,243,.5), inset 0 0 22px -14px rgba(64,219,243,.4); }
.cr-ev-time { flex: 0 0 118px; font-size: 14px; color: #cfe0ec; font-variant-numeric: tabular-nums; }
.cr-ev-main { flex: 1 1 auto; min-width: 0; }
.cr-ev-title { font-size: 16px; font-weight: 600; color: #eef6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ev-loc { font-size: 13px; color: #8090a0; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ev-ico { flex: none; display: flex; }

.cr-side { display: flex; flex-direction: column; gap: 16px; min-height: 0; overflow-y: auto; }
.cr-card { border: 1px solid rgba(70,150,190,.2); border-radius: 12px; padding: 12px 15px; background: rgba(9,18,30,.4); }
.cr-mm-head { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 12px; }
.cr-mm-title { font-size: 14px; font-weight: 700; letter-spacing: .12em; color: #40dbf3; }
.cr-mm-chev { color: #40dbf3; font-size: 18px; line-height: 1; }
.cr-mm-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px 0; }
.cr-mm-dow { text-align: center; font-size: 12px; color: #7c8b98; padding: 3px 0 6px; }
.cr-mm-dow.on { color: #40dbf3; }
.cr-mm-cell { text-align: center; font-size: 13px; color: #cdd9e4; padding: 6px 0; font-variant-numeric: tabular-nums; }
.cr-mm-cell.dim { color: #4a5867; }
.cr-mm-cell.today { }
.cr-mm-cell.today span { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: #40dbf3; font-weight: 700;
  border: 1.5px solid #40dbf3; box-shadow: 0 0 10px -2px rgba(64,219,243,.6); }

.cr-sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.cr-sec-title { font-size: 14px; font-weight: 700; letter-spacing: .06em; color: #40dbf3; }
.cr-pill { font-size: 11px; letter-spacing: .1em; color: #9fe8f8; border: 1px solid rgba(64,219,243,.55); border-radius: 8px; padding: 3px 10px; }
.cr-link { font-size: 12px; letter-spacing: .04em; color: #7f93a2; }
.cr-ts-row { display: flex; align-items: center; gap: 12px; padding: 7px 0; }
.cr-ts-time { flex: 0 0 46px; font-size: 12.5px; color: #9fb0bd; line-height: 1.35; font-variant-numeric: tabular-nums; }
.cr-ts-bar { flex: 0 0 3px; align-self: stretch; border-radius: 3px; margin: 1px 0; }
.cr-ts-main { flex: 1 1 auto; min-width: 0; }
.cr-ts-title { font-size: 14px; font-weight: 600; color: #eaf3fb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ts-loc { font-size: 12px; color: #8090a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ts-ico { flex: none; display: flex; }
.cr-add { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px; padding-top: 12px; border-top: 1px solid rgba(70,150,190,.14);
  font-size: 13px; letter-spacing: .08em; color: #40dbf3; }
.cr-up-row { display: flex; align-items: center; gap: 14px; padding: 10px 0; }
.cr-up-row + .cr-up-row { border-top: 1px solid rgba(70,150,190,.1); }
.cr-up-date { flex: 0 0 42px; text-align: center; }
.cr-up-day { font-size: 22px; font-weight: 700; color: #eaf3fb; line-height: 1; }
.cr-up-mon { font-size: 11px; letter-spacing: .1em; color: #7c8b98; margin-top: 2px; }
.cr-up-main { flex: 1 1 auto; min-width: 0; border-left: 1px solid rgba(70,150,190,.16); padding-left: 14px; }
.cr-up-title { font-size: 14px; font-weight: 600; color: #eaf3fb; }
.cr-up-sub { font-size: 12.5px; color: #8090a0; margin-top: 2px; }
.cr-empty { color: #7c8b98; font-size: 13px; padding: 10px 2px; }
`;

function ensureStyle() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("jr-cr-style")) {
    const el = document.createElement("style");
    el.id = "jr-cr-style"; el.textContent = STYLE; document.head.appendChild(el);
  }
}

const S = 16, W = 16;
const IcoCal = () => (<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /><circle cx="8" cy="13" r=".6" fill="currentColor" /><circle cx="12" cy="13" r=".6" fill="currentColor" /><circle cx="16" cy="13" r=".6" fill="currentColor" /></svg>);
const IcoPeople = ({ s = S }: { s?: number }) => (<svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M21 20a6 6 0 0 0-4-5.7" /></svg>);
const IcoPhone = ({ s = S }: { s?: number }) => (<svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" /></svg>);
const IcoFolder = ({ s = S }: { s?: number }) => (<svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>);
const IcoChart = ({ s = S }: { s?: number }) => (<svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 20V11M10 20V4M15 20v-6M20 20v-9" /></svg>);
const IcoDot = ({ s = S }: { s?: number }) => (<svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" /></svg>);

function catFor(title: string): { color: string; Icon: (p: { s?: number }) => ReactNode } {
  const t = (title || "").toLowerCase();
  if (/\b(call|dial|phone|ring|voice|secure channel)\b/.test(t)) return { color: "#3ecf6e", Icon: IcoPhone };
  if (/\b(meet|meeting|briefing|sync|standup|stand-up|1:1|1-1|interview|review|catch ?up|lunch|coffee|dinner|strategy)\b/.test(t)) return { color: "#b06fe8", Icon: IcoPeople };
  if (/\b(deadline|report|doc|document|deliver|submit|due|paper|file|nexus|update|project)\b/.test(t)) return { color: "#f5923e", Icon: IcoFolder };
  if (/\b(market|analysis|stats|metrics|earnings|trade|trading|data|numbers)\b/.test(t)) return { color: "#40dbf3", Icon: IcoChart };
  return { color: "#40dbf3", Icon: IcoDot };
}

const HH = 50;
const hourOf = (iso?: string) => { if (!iso) return 0; const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
const fmt24 = (iso?: string) => { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; } };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function CalendarRoom({ events, upcoming = [] }: { events: CalEvent[]; upcoming?: CalEvent[] }) {
  ensureStyle();
  const now = new Date();
  const timed = events.filter((e) => !e.allDay && e.startAt);
  const allDay = events.filter((e) => e.allDay);
  const s = timed.length ? Math.max(0, Math.min(8, ...timed.map((e) => Math.floor(hourOf(e.startAt))))) : 8;
  const en = timed.length ? Math.min(24, Math.max(20, ...timed.map((e) => Math.ceil(hourOf(e.endAt || e.startAt) + (e.endAt ? 0 : 1))))) : 20;
  const hours: number[] = []; for (let h = s; h <= en; h++) hours.push(h);
  const gridH = (en - s) * HH + 8;
  const dateObj = timed[0]?.startAt ? new Date(timed[0].startAt) : now;
  const isToday = dateObj.toDateString() === now.toDateString();
  const nowTop = isToday ? (hourOf(now.toISOString()) - s) * HH + 44 : -1; // +44 = below the all-day row
  const dateTitle = dateObj.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();

  // mini month
  const y = now.getFullYear(), m = now.getMonth();
  const gridStart = new Date(y, m, 1 - new Date(y, m, 1).getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { day: d.getDate(), inMonth: d.getMonth() === m, isToday: d.toDateString() === now.toDateString() };
  });

  return (
    <div className="cr">
      <div className="cr-frame" />
      <span className="cr-br tl" /><span className="cr-br tr" /><span className="cr-br bl" /><span className="cr-br br" />

      <div className="cr-head">
        <div className="cr-head-l">
          <div className="cr-ico"><IcoCal /></div>
          <div><div className="cr-title">CALENDAR</div><div className="cr-sub">Stay on schedule. Stay ahead.</div></div>
        </div>
        <div className="cr-tabs">
          <span className="cr-tab on">DAY</span><span className="cr-tab">WEEK</span><span className="cr-tab">MONTH</span>
        </div>
      </div>

      <div className="cr-body">
        <div className="cr-main">
          <div className="cr-datenav"><span className="cr-chev">‹</span><span className="cr-date">{dateTitle}</span><span className="cr-chev">›</span></div>
          <div className="cr-grid">
            <div style={{ position: "relative", height: gridH + 48 }}>
              <div className="cr-vline" />
              {/* all-day */}
              <div className="cr-allday" style={{ top: 0 }}>
                <span className="cr-allday-lbl">ALL DAY</span>
                <div className="cr-allday-box">{allDay.length ? allDay.map((e) => e.title).join(" · ") : "No all-day events"}</div>
              </div>
              {/* hour grid offset by 56 (below all-day) */}
              <div style={{ position: "absolute", left: 0, right: 0, top: 56, height: gridH }}>
                {hours.map((h) => (
                  <div className="cr-hour" style={{ top: (h - s) * HH }} key={h}>
                    <span className="cr-hour-lbl">{String(h).padStart(2, "0")}:00</span>
                    <span className="cr-hour-line" />
                  </div>
                ))}
                {nowTop >= 44 ? (
                  <div className="cr-now" style={{ top: nowTop - 44 }}>
                    <span className="cr-now-pill">{fmt24(now.toISOString())}</span>
                    <span className="cr-now-dot" /><span className="cr-now-line" />
                  </div>
                ) : null}
                {timed.map((e, k) => {
                  const top = (hourOf(e.startAt) - s) * HH;
                  const dur = e.endAt ? Math.max(0.5, hourOf(e.endAt) - hourOf(e.startAt)) : 1;
                  const h = Math.max(52, dur * HH - 6);
                  const cat = catFor(e.title);
                  const near = isToday && Math.abs(hourOf(e.startAt) - hourOf(now.toISOString())) < 1;
                  return (
                    <div className={`cr-ev${near ? " near" : ""}`} style={{ top: top + 3, height: h }} key={k}>
                      <span className="cr-ev-time">{fmt24(e.startAt)}{e.endAt ? ` – ${fmt24(e.endAt)}` : ""}</span>
                      <div className="cr-ev-main"><div className="cr-ev-title">{e.title}</div>{e.location ? <div className="cr-ev-loc">{e.location}</div> : null}</div>
                      <span className="cr-ev-ico" style={{ color: cat.color }}><cat.Icon s={24} /></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="cr-side">
          <div className="cr-card">
            <div className="cr-mm-head"><span className="cr-mm-chev">‹</span><span className="cr-mm-title">{MON[m]} {y}</span><span className="cr-mm-chev">›</span></div>
            <div className="cr-mm-grid">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div className={`cr-mm-dow${i === now.getDay() ? " on" : ""}`} key={i}>{d}</div>)}
              {cells.map((c, i) => (
                <div className={`cr-mm-cell${c.inMonth ? "" : " dim"}${c.isToday ? " today" : ""}`} key={i}>{c.isToday ? <span>{c.day}</span> : c.day}</div>
              ))}
            </div>
          </div>

          <div className="cr-card">
            <div className="cr-sec-head"><span className="cr-sec-title">TODAY'S SCHEDULE</span><span className="cr-pill">TODAY</span></div>
            {timed.length ? timed.map((e, k) => {
              const cat = catFor(e.title);
              return (
                <div className="cr-ts-row" key={k}>
                  <div className="cr-ts-time">{fmt24(e.startAt)}<br />{fmt24(e.endAt)}</div>
                  <span className="cr-ts-bar" style={{ background: cat.color }} />
                  <div className="cr-ts-main"><div className="cr-ts-title">{e.title}</div>{e.location ? <div className="cr-ts-loc">{e.location}</div> : null}</div>
                  <span className="cr-ts-ico" style={{ color: cat.color }}><cat.Icon s={20} /></span>
                </div>
              );
            }) : <div className="cr-empty">Nothing scheduled today.</div>}
            <div className="cr-add"><span style={{ fontSize: 16, lineHeight: 1 }}>+</span> ADD EVENT</div>
          </div>

          <div className="cr-card">
            <div className="cr-sec-head"><span className="cr-sec-title">UPCOMING</span><span className="cr-link">VIEW ALL</span></div>
            {upcoming.length ? upcoming.map((e, k) => {
              const d = e.startAt ? new Date(e.startAt) : now;
              return (
                <div className="cr-up-row" key={k}>
                  <div className="cr-up-date"><div className="cr-up-day">{d.getDate()}</div><div className="cr-up-mon">{MON[d.getMonth()]}</div></div>
                  <div className="cr-up-main"><div className="cr-up-title">{e.title}</div><div className="cr-up-sub">{e.allDay ? "All day" : `${fmt24(e.startAt)} – ${fmt24(e.endAt)}`}</div></div>
                </div>
              );
            }) : <div className="cr-empty">Nothing coming up.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
