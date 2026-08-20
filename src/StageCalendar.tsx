import { useLayoutEffect, useRef, type ReactNode } from "react";

// ── The Calendar widget (W3b) ───────────────────────────────────────────────────────────────────
// Built as a FIXED design canvas (BASE_W×BASE_H) that is measured and uniformly scaled to fill
// whatever widget box it lands in. Everything — type, glow, spacing, the whole day grid — scales
// together, so the content always fits its panel with NO scroll and NO oversized text, at any size.
// HUD frame, header + DAY/WEEK/MONTH tabs, a left 08:00–20:00 time-grid, a right sidebar (mini-month,
// today's schedule, upcoming). Real events only — nothing is invented. WEEK/MONTH come later.

export type CalEvent = { title: string; startAt?: string; endAt?: string; allDay?: boolean; location?: string };

const BASE_W = 1180, BASE_H = 740;   // the canvas the layout is tuned for; scaled to the real box
const H0 = 8, H1 = 20;               // fixed day range, like the reference
const HH = 45;                        // px per hour on the canvas
const ALLDAY_Z = 54;                  // all-day zone height on the canvas

const STYLE = `
/* The surrounding box paints NOTHING — the calendar canvas paints its own background, so no band or
   halo can ever show around the panel if the box isn't exactly the calendar's shape. */
.cr { position: relative; width: 100%; height: 100%; overflow: hidden; color: #dbeaf5; font-family: inherit; background: none; }
.cr-stage { position: absolute; top: 0; left: 0; width: ${BASE_W}px; height: ${BASE_H}px; transform-origin: top left;
  box-sizing: border-box; padding: 20px 26px; display: flex; flex-direction: column; overflow: hidden;
  background:
    repeating-linear-gradient(0deg, rgba(70,150,190,.028) 0 1px, transparent 1px 4px),
    radial-gradient(130% 100% at 50% -8%, #0b1b2b 0%, #06101d 46%, #04080f 80%); }
.cr-stage::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 150px -46px rgba(36,140,190,.5), inset 0 0 40px -20px rgba(76,228,255,.12); }
.cr-frame { position: absolute; inset: 8px; border: 1.5px solid rgba(78,200,240,.35); border-radius: 14px; pointer-events: none;
  box-shadow: 0 0 40px -10px rgba(76,228,255,.45), inset 0 0 70px -34px rgba(76,228,255,.5), inset 0 0 2px rgba(120,225,255,.35); }
.cr-edge { position: absolute; top: 8px; right: 150px; width: 180px; height: 2px; pointer-events: none;
  background: repeating-linear-gradient(90deg, #5eeaff 0 14px, transparent 14px 23px); box-shadow: 0 0 8px rgba(94,234,255,.85); }
.cr-br { position: absolute; width: 58px; height: 58px; border-color: #64ecff; pointer-events: none;
  filter: drop-shadow(0 0 9px rgba(100,236,255,.9)) drop-shadow(0 0 3px rgba(120,240,255,.85)); }
.cr-br.tl { top: 2px; left: 2px; border-top: 3px solid; border-left: 3px solid; border-top-left-radius: 15px; }
.cr-br.tr { top: 2px; right: 2px; border-top: 3px solid; border-right: 3px solid; border-top-right-radius: 15px; }
.cr-br.bl { bottom: 2px; left: 2px; border-bottom: 3px solid; border-left: 3px solid; border-bottom-left-radius: 15px; }
.cr-br.br { bottom: 2px; right: 2px; border-bottom: 3px solid; border-right: 3px solid; border-bottom-right-radius: 15px; }

.cr-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex: none; }
.cr-head-l { display: flex; align-items: center; gap: 14px; }
.cr-ico { width: 50px; height: 50px; display: grid; place-items: center; color: #6eeaff; flex: none;
  border: 1.5px solid rgba(100,236,255,.7); border-radius: 12px; background: linear-gradient(160deg, rgba(30,90,120,.32), rgba(12,40,60,.18));
  box-shadow: 0 0 18px -3px rgba(76,228,255,.55), inset 0 0 18px -6px rgba(76,228,255,.6);
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
.cr-title { font-size: 26px; font-weight: 700; letter-spacing: .05em; color: #eef8ff; line-height: 1.04; text-shadow: 0 0 16px rgba(120,220,250,.45), 0 0 4px rgba(160,230,255,.35); }
.cr-sub { font-size: 12px; color: #7e8ea0; margin-top: 3px; }
.cr-tabs { display: flex; align-items: center; gap: 3px; padding: 4px; border-radius: 11px; border: 1px solid rgba(78,190,230,.3); background: rgba(10,24,40,.5);
  box-shadow: inset 0 0 14px -8px rgba(76,228,255,.3); }
.cr-tab { font-size: 12px; letter-spacing: .09em; font-weight: 600; color: #8fa2b0; padding: 6px 18px; border-radius: 8px; border: 1px solid transparent; }
.cr-tab.on { color: #d5f7ff; border-color: rgba(100,236,255,.85); background: linear-gradient(180deg, rgba(38,102,132,.4), rgba(20,60,84,.3));
  box-shadow: 0 0 16px -3px rgba(76,228,255,.7), inset 0 0 12px -4px rgba(76,228,255,.55); text-shadow: 0 0 9px rgba(120,225,255,.5); }

.cr-body { display: grid; grid-template-columns: minmax(0,1fr) 312px; gap: 22px; flex: 1 1 auto; min-height: 0; }
.cr-main { min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.cr-datenav { display: flex; align-items: center; justify-content: center; gap: 18px; margin: 0 0 12px; flex: none; }
.cr-date { font-size: 18px; font-weight: 700; letter-spacing: .08em; color: #eef8ff; text-shadow: 0 0 12px rgba(120,220,250,.35); }
.cr-chev { color: #5eeaff; font-size: 22px; line-height: 1; filter: drop-shadow(0 0 6px rgba(94,234,255,.8)); }

.cr-grid { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.cr-vline { position: absolute; left: 78px; top: 0; bottom: 0; width: 1px; background: rgba(90,140,180,.12); }
.cr-hour { position: absolute; left: 0; right: 0; height: 0; }
.cr-hour-lbl { position: absolute; left: 0; top: -7px; width: 60px; text-align: right; font-size: 12px; color: #7c8b98; font-variant-numeric: tabular-nums; }
.cr-hour-line { position: absolute; left: 82px; right: 2px; top: 0; height: 1px; background: rgba(90,140,180,.1); }
.cr-allday { position: absolute; left: 82px; right: 2px; top: 0; }
.cr-allday-lbl { position: absolute; left: -82px; top: 12px; width: 60px; text-align: right; font-size: 11px; letter-spacing: .05em; color: #7c8b98; }
.cr-allday-box { display: flex; align-items: center; height: 38px; padding: 0 14px; border-radius: 9px; border: 1px solid rgba(90,190,235,.28);
  background: linear-gradient(180deg, rgba(20,44,70,.5), rgba(9,18,30,.5)); font-size: 13px; color: #dbeaf5;
  box-shadow: inset 0 1px 0 rgba(120,215,250,.07), 0 0 18px -14px rgba(76,228,255,.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-now { position: absolute; left: 0; right: 0; height: 0; z-index: 5; }
.cr-now-pill { position: absolute; left: 2px; top: -10px; width: 52px; text-align: center; font-size: 11px; color: #6eeaff; font-weight: 700;
  border: 1px solid rgba(100,236,255,.9); border-radius: 6px; padding: 2px 0; background: rgba(10,34,48,.8); box-shadow: 0 0 14px -2px rgba(76,228,255,.8); }
.cr-now-dot { position: absolute; left: 78px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: #6eeaff; box-shadow: 0 0 11px rgba(100,236,255,1); }
.cr-now-line { position: absolute; left: 84px; right: 2px; top: 0; height: 1.5px; background: rgba(100,236,255,.7); box-shadow: 0 0 8px rgba(76,228,255,.75); }
.cr-ev { position: absolute; left: 82px; right: 2px; display: flex; align-items: center; gap: 4px; overflow: hidden;
  border: 1px solid rgba(92,182,225,.3); border-radius: 9px; padding: 0 16px;
  background: linear-gradient(180deg, rgba(24,50,78,.62), rgba(10,20,34,.58));
  box-shadow: inset 0 1px 0 rgba(120,215,250,.06), 0 4px 14px -12px rgba(0,0,0,.7); }
.cr-ev.near { border-color: rgba(100,236,255,.55); box-shadow: 0 0 22px -8px rgba(76,228,255,.6), inset 0 0 30px -18px rgba(76,228,255,.45), inset 0 1px 0 rgba(120,215,250,.1); }
.cr-ev-time { flex: 0 0 104px; font-size: 13px; color: #cfe0ec; font-variant-numeric: tabular-nums; }
.cr-ev-main { flex: 1 1 auto; min-width: 0; }
.cr-ev-title { font-size: 14.5px; font-weight: 600; color: #eef6fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ev-loc { font-size: 12px; color: #8090a0; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ev-ico { flex: none; display: flex; }

.cr-side { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: hidden; }
.cr-card { border: 1px solid rgba(92,190,232,.3); border-radius: 12px; padding: 9px 13px;
  background: linear-gradient(180deg, rgba(18,42,68,.38), rgba(8,16,30,.48));
  box-shadow: 0 0 26px -16px rgba(76,228,255,.42), inset 0 1px 0 rgba(120,215,250,.07); }
.cr-mm-head { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 8px; }
.cr-mm-title { font-size: 13px; font-weight: 700; letter-spacing: .11em; color: #5eeaff; text-shadow: 0 0 10px rgba(76,228,255,.5); }
.cr-mm-chev { color: #5eeaff; font-size: 16px; line-height: 1; filter: drop-shadow(0 0 5px rgba(94,234,255,.65)); }
.cr-mm-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 1px 0; }
.cr-mm-dow { text-align: center; font-size: 11px; color: #7c8b98; padding: 1px 0 4px; }
.cr-mm-dow.on { color: #5eeaff; text-shadow: 0 0 7px rgba(76,228,255,.55); }
.cr-mm-cell { text-align: center; font-size: 12px; color: #cdd9e4; padding: 3px 0; font-variant-numeric: tabular-nums; }
.cr-mm-cell.dim { color: #495666; }
.cr-mm-cell.today span { display: inline-grid; place-items: center; width: 23px; height: 23px; border-radius: 50%; color: #6eeaff; font-weight: 700;
  border: 1.5px solid #64ecff; box-shadow: 0 0 12px -1px rgba(100,236,255,.8), inset 0 0 8px -3px rgba(100,236,255,.55); text-shadow: 0 0 7px rgba(94,234,255,.65); }

.cr-sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cr-sec-title { font-size: 13px; font-weight: 700; letter-spacing: .05em; color: #5eeaff; text-shadow: 0 0 10px rgba(76,228,255,.5); }
.cr-pill { font-size: 10px; letter-spacing: .09em; color: #b8f4ff; border: 1px solid rgba(100,236,255,.65); border-radius: 7px; padding: 3px 9px; box-shadow: 0 0 11px -3px rgba(76,228,255,.55); }
.cr-link { font-size: 11px; letter-spacing: .04em; color: #7f93a2; }
.cr-ts-row { display: flex; align-items: center; gap: 11px; padding: 4px 0; }
.cr-ts-time { flex: 0 0 42px; font-size: 11.5px; color: #9fb0bd; line-height: 1.3; font-variant-numeric: tabular-nums; }
.cr-ts-bar { flex: 0 0 3px; align-self: stretch; border-radius: 3px; margin: 1px 0; filter: drop-shadow(0 0 4px currentColor); }
.cr-ts-main { flex: 1 1 auto; min-width: 0; }
.cr-ts-title { font-size: 13px; font-weight: 600; color: #eaf3fb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ts-loc { font-size: 11.5px; color: #8090a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-ts-ico { flex: none; display: flex; }
.cr-add { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(76,180,220,.18);
  font-size: 12px; letter-spacing: .07em; color: #5eeaff; text-shadow: 0 0 8px rgba(76,228,255,.45); }
.cr-up-row { display: flex; align-items: center; gap: 13px; padding: 7px 0; }
.cr-up-row + .cr-up-row { border-top: 1px solid rgba(70,150,190,.1); }
.cr-up-date { flex: 0 0 38px; text-align: center; }
.cr-up-day { font-size: 20px; font-weight: 700; color: #eaf3fb; line-height: 1; }
.cr-up-mon { font-size: 10px; letter-spacing: .09em; color: #7c8b98; margin-top: 2px; }
.cr-up-main { flex: 1 1 auto; min-width: 0; border-left: 1px solid rgba(70,150,190,.15); padding-left: 13px; }
.cr-up-title { font-size: 13px; font-weight: 600; color: #eaf3fb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-up-sub { font-size: 11.5px; color: #8090a0; margin-top: 2px; }
.cr-empty { color: #7c8b98; font-size: 12px; padding: 9px 2px; }
`;

function ensureStyle() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("jr-cr-style")) {
    const el = document.createElement("style");
    el.id = "jr-cr-style"; el.textContent = STYLE; document.head.appendChild(el);
  }
}

const S = 15;
const IcoCal = () => (<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /><circle cx="8" cy="13" r=".6" fill="currentColor" /><circle cx="12" cy="13" r=".6" fill="currentColor" /><circle cx="16" cy="13" r=".6" fill="currentColor" /></svg>);
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

const clampH = (h: number) => Math.max(H0, Math.min(H1, h));
const hourOf = (iso?: string) => { if (!iso) return 0; const d = new Date(iso); return d.getHours() + d.getMinutes() / 60; };
const fmt24 = (iso?: string) => { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return ""; } };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function CalendarWidget({ events, upcoming = [], loading = false }: { events: CalEvent[]; upcoming?: CalEvent[]; loading?: boolean }) {
  ensureStyle();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Measure the real widget box and uniformly scale the fixed canvas to fit it — always, on resize.
  useLayoutEffect(() => {
    const root = rootRef.current, stage = stageRef.current;
    if (!root || !stage) return;
    const fit = () => {
      const W = root.clientWidth, H = root.clientHeight;
      if (!W || !H) return;
      const k = Math.min(W / BASE_W, H / BASE_H);
      const tx = Math.round((W - BASE_W * k) / 2), ty = Math.round((H - BASE_H * k) / 2);
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const now = new Date();
  const timed = events.filter((e) => !e.allDay && e.startAt);
  const allDay = events.filter((e) => e.allDay);
  const hours: number[] = []; for (let h = H0; h <= H1; h++) hours.push(h);

  const dateObj = timed[0]?.startAt ? new Date(timed[0].startAt) : now;
  const isToday = dateObj.toDateString() === now.toDateString();
  const nowH = hourOf(now.toISOString());
  const nowInRange = isToday && nowH >= H0 && nowH <= H1;
  const dateTitle = dateObj.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();

  // mini month
  const y = now.getFullYear(), m = now.getMonth();
  const gridStart = new Date(y, m, 1 - new Date(y, m, 1).getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    return { day: d.getDate(), inMonth: d.getMonth() === m, isToday: d.toDateString() === now.toDateString() };
  });

  return (
    <div className="cr" ref={rootRef}>
      <div className="cr-stage" ref={stageRef}>
        <div className="cr-frame" />
        <span className="cr-edge" />
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
              <div className="cr-vline" />
              {/* all-day */}
              <div className="cr-allday">
                <span className="cr-allday-lbl">ALL DAY</span>
                <div className="cr-allday-box">{allDay.length ? allDay.map((e) => e.title).join(" · ") : loading ? "Loading…" : "No all-day events"}</div>
              </div>
              {/* hour grid, offset below the all-day zone */}
              <div style={{ position: "absolute", left: 0, right: 0, top: ALLDAY_Z, height: (H1 - H0) * HH }}>
                {hours.map((h) => (
                  <div className="cr-hour" style={{ top: (h - H0) * HH }} key={h}>
                    <span className="cr-hour-lbl">{String(h).padStart(2, "0")}:00</span>
                    <span className="cr-hour-line" />
                  </div>
                ))}
                {nowInRange ? (
                  <div className="cr-now" style={{ top: (nowH - H0) * HH }}>
                    <span className="cr-now-pill">{fmt24(now.toISOString())}</span>
                    <span className="cr-now-dot" /><span className="cr-now-line" />
                  </div>
                ) : null}
                {timed.map((e, k) => {
                  const top = (clampH(hourOf(e.startAt)) - H0) * HH;
                  const dur = e.endAt ? Math.max(0.5, clampH(hourOf(e.endAt)) - clampH(hourOf(e.startAt))) : 1;
                  const h = Math.max(40, dur * HH - 4);
                  const cat = catFor(e.title);
                  const near = isToday && Math.abs(hourOf(e.startAt) - nowH) < 1;
                  return (
                    <div className={`cr-ev${near ? " near" : ""}`} style={{ top: top + 2, height: h }} key={k}>
                      <span className="cr-ev-time">{fmt24(e.startAt)}{e.endAt ? ` – ${fmt24(e.endAt)}` : ""}</span>
                      <div className="cr-ev-main"><div className="cr-ev-title">{e.title}</div>{e.location ? <div className="cr-ev-loc">{e.location}</div> : null}</div>
                      <span className="cr-ev-ico" style={{ color: cat.color }}><cat.Icon s={20} /></span>
                    </div>
                  );
                })}
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
                    <span className="cr-ts-bar" style={{ background: cat.color, color: cat.color }} />
                    <div className="cr-ts-main"><div className="cr-ts-title">{e.title}</div>{e.location ? <div className="cr-ts-loc">{e.location}</div> : null}</div>
                    <span className="cr-ts-ico" style={{ color: cat.color }}><cat.Icon s={18} /></span>
                  </div>
                );
              }) : <div className="cr-empty">{loading ? "Reading your calendar…" : "Nothing scheduled today."}</div>}
              <div className="cr-add"><span style={{ fontSize: 15, lineHeight: 1 }}>+</span> ADD EVENT</div>
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
              }) : <div className="cr-empty">{loading ? "Reading your calendar…" : "Nothing coming up."}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
