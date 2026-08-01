import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BacktestRun } from "./bt-types";

/* 🎬 LIVE RUN — a cinematic full-screen replay of the REAL computed backtest.
   The strategy's true equity landscape grows bar-by-bar in 3D while the PnL counter,
   drawdown, running metrics and a transaction feed update live. Nothing is invented:
   every point, trade and number is replayed from the actual run — only the pacing is
   cosmetic. Built on three.js with an incremental draw-range reveal (O(1)/frame). */

const money = (v: number) => `$${(Number.isFinite(v) ? v : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ymd = (t: number) => (t ? new Date(t).toISOString().slice(0, 10) : "");

export function BtLiveRun({ run, onClose }: { run: BacktestRun; onClose: () => void }) {
  const mount = useRef<HTMLDivElement | null>(null);
  const pnlRef = useRef<HTMLDivElement | null>(null);
  const retRef = useRef<HTMLSpanElement | null>(null);
  const ddRef = useRef<HTMLSpanElement | null>(null);
  const dateRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);
  const progRef = useRef<HTMLSpanElement | null>(null);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1); speedRef.current = speed;
  const [played, setPlayed] = useState(0);   // trades whose exit has occurred
  const [inPos, setInPos] = useState(false);
  const [done, setDone] = useState(false);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false); soundRef.current = sound;
  const audioRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);

  // Sonification: pitch rises with equity, a chime blips on each new all-time high (created on the
  // toggle click so the browser's user-gesture requirement is met). Pure audio mapping of real values.
  function toggleSound() {
    if (sound) { try { audioRef.current?.gain.gain.setTargetAtTime(0, audioRef.current.ctx.currentTime, 0.05); } catch { /* */ } setSound(false); return; }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioRef.current) { const ctx = new Ctx(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = "triangle"; gain.gain.value = 0; osc.connect(gain); gain.connect(ctx.destination); osc.start(); audioRef.current = { ctx, osc, gain }; }
      else audioRef.current.ctx.resume();
      setSound(true);
    } catch { /* audio unavailable */ }
  }
  useEffect(() => () => { try { audioRef.current?.osc.stop(); audioRef.current?.ctx.close(); } catch { /* */ } audioRef.current = null; }, []);

  useEffect(() => {
    const el = mount.current; if (!el) return;
    const eq = run.strategyEquity.map((p) => p.v);
    const N = eq.length; if (N < 2) return;
    const lo = Math.min(...eq), hi = Math.max(...eq), rg = hi - lo || 1;
    const t0 = run.strategyEquity[0].t, t1 = run.strategyEquity[N - 1].t, tr = t1 - t0 || 1;
    const startCash = run.config.startCash;

    let w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03080f, 0.011);
    const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h); renderer.setClearColor(0x03080f, 1);
    el.appendChild(renderer.domElement);

    const SPAN = 80, HGT = 20;
    const nx = (i: number) => (i / (N - 1)) * SPAN - SPAN / 2;
    const ny = (v: number) => ((v - lo) / rg) * HGT;

    // running-peak → drawdown coloring per column (green normally, red under water)
    let peak = -Infinity; const dd: number[] = eq.map((v) => { peak = Math.max(peak, v); return peak ? v / peak - 1 : 0; });

    // ribbon (filled strip from the line down to the floor), vertex-colored
    const ribGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
    const cGreen = new THREE.Color(0x2ee6a6), cRed = new THREE.Color(0xf4536a), cDark = new THREE.Color(0x061a24);
    for (let i = 0; i < N; i++) {
      const x = nx(i), y = ny(eq[i]);
      pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = 0;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = 0; pos[i * 6 + 5] = 0;
      const top = dd[i] < -0.001 ? cRed : cGreen;
      col[i * 6] = top.r; col[i * 6 + 1] = top.g; col[i * 6 + 2] = top.b;
      col[i * 6 + 3] = cDark.r; col[i * 6 + 4] = cDark.g; col[i * 6 + 5] = cDark.b;
    }
    ribGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    ribGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    ribGeo.setIndex(idx);
    const ribbon = new THREE.Mesh(ribGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(ribbon);

    // bright top line
    const lineGeo = new THREE.BufferGeometry();
    const lpos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { lpos[i * 3] = nx(i); lpos[i * 3 + 1] = ny(eq[i]) + 0.06; lpos[i * 3 + 2] = 0.02; }
    lineGeo.setAttribute("position", new THREE.BufferAttribute(lpos, 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x8ffce0 }));
    scene.add(line);

    // start-capital reference plane line
    const baseY = ny(startCash);
    const baseGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-SPAN / 2, baseY, 0), new THREE.Vector3(SPAN / 2, baseY, 0)]);
    scene.add(new THREE.Line(baseGeo, new THREE.LineDashedMaterial({ color: 0x2a4a5a, dashSize: 1, gapSize: 1 })));

    // floor grid + glow head
    const grid = new THREE.GridHelper(180, 90, 0x0c4256, 0x07222e); (grid.material as THREE.Material).opacity = 0.35; (grid.material as THREE.Material).transparent = true; grid.position.y = -0.02; scene.add(grid);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), new THREE.MeshBasicMaterial({ color: 0xbafcff }));
    scene.add(head);
    const headLight = new THREE.PointLight(0x4fe8ff, 3, 40); scene.add(headLight);
    scene.add(new THREE.AmbientLight(0x18344a, 1.4));
    // ambient star particles
    const starN = 260, sPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) { sPos[i * 3] = (Math.random() - 0.5) * 200; sPos[i * 3 + 1] = Math.random() * 60 - 5; sPos[i * 3 + 2] = -20 - Math.random() * 120; }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(sPos, 3)), new THREE.PointsMaterial({ color: 0x3a6b82, size: 0.5, transparent: true, opacity: 0.6 }));
    scene.add(stars);

    ribGeo.setDrawRange(0, 0); lineGeo.setDrawRange(0, 1);
    const DURATION = 60000; // ms at 1×
    let raf = 0, startT = 0, lastPlayed = -1, soundPeak = -Infinity;
    const exits = run.trades.map((tr2) => tr2.exitT);

    const frame = (now: number) => {
      if (!startT) startT = now;
      const prog = Math.min(1, ((now - startT) * speedRef.current) / DURATION);
      const reveal = Math.max(2, Math.floor(prog * N));
      const curT = t0 + prog * tr;
      ribGeo.setDrawRange(0, (reveal - 1) * 6);
      lineGeo.setDrawRange(0, reveal);
      const hx = nx(reveal - 1), hy = ny(eq[reveal - 1]);
      head.position.set(hx, hy + 0.06, 0.05); headLight.position.set(hx, hy + 2, 6);
      // trailing camera that follows the growing head
      const ang = 0.0004 * now;
      camera.position.set(hx - 10 + Math.sin(ang) * 3, 12 + HGT * 0.3, 30 + Math.cos(ang) * 2);
      camera.lookAt(hx - SPAN * 0.12, HGT * 0.4, 0);
      stars.rotation.y = ang * 0.2;
      renderer.render(scene, camera);

      // HUD (imperative — no React re-render per frame)
      const curEq = eq[reveal - 1], ret = (curEq / startCash - 1) * 100;
      // sonification: map equity → pitch; chime blip on a new all-time high
      if (soundRef.current && audioRef.current) {
        const a = audioRef.current, tt = a.ctx.currentTime;
        const norm = Math.max(0, Math.min(1, (curEq - lo) / (rg || 1)));
        a.osc.frequency.setTargetAtTime(180 + norm * 620, tt, 0.06);
        if (curEq > soundPeak) { a.gain.gain.cancelScheduledValues(tt); a.gain.gain.setValueAtTime(0.11, tt); a.gain.gain.setTargetAtTime(0.035, tt, 0.12); }
        else a.gain.gain.setTargetAtTime(dd[reveal - 1] < -0.02 ? 0.018 : 0.032, tt, 0.2);
      }
      if (curEq > soundPeak) soundPeak = curEq;
      if (pnlRef.current) pnlRef.current.textContent = money(curEq);
      if (retRef.current) { retRef.current.textContent = `${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%`; retRef.current.style.color = ret >= 0 ? "#2ee6a6" : "#f4536a"; }
      if (ddRef.current) { const d = dd[reveal - 1] * 100; ddRef.current.textContent = `${d.toFixed(2)}%`; }
      if (dateRef.current) dateRef.current.textContent = ymd(curT);
      if (barRef.current) barRef.current.textContent = `${reveal} / ${N}`;
      if (progRef.current) progRef.current.style.width = `${(prog * 100).toFixed(1)}%`;

      // low-frequency React updates (trades played + position state)
      const pc = exits.filter((e) => e <= curT).length;
      if (pc !== lastPlayed) { lastPlayed = pc; setPlayed(pc); setInPos(run.trades.some((tr2) => tr2.entryT <= curT && tr2.exitT > curT)); }

      if (prog < 1) raf = requestAnimationFrame(frame); else setDone(true);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => { w = el.clientWidth; h = el.clientHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    window.addEventListener("resize", onResize);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey);
      ribGeo.dispose(); lineGeo.dispose(); baseGeo.dispose(); (ribbon.material as THREE.Material).dispose(); (line.material as THREE.Material).dispose();
      renderer.dispose(); try { el.removeChild(renderer.domElement); } catch { /* */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const playedTrades = run.trades.slice(0, played);
  const wins = playedTrades.filter((t) => t.pnl > 0).length;
  const realized = playedTrades.reduce((s, t) => s + t.pnl, 0);

  return (
    <div className="btl-root">
      <div ref={mount} className="btl-canvas" />
      <div className="btl-scanlines" />
      {/* top bar */}
      <div className="btl-top">
        <div className="btl-brand">◆ APEX LIVE RUN<em>{run.config.strategyName} · {run.config.symbol} · {run.config.timeframe.toUpperCase()}</em></div>
        <div className="btl-topctl">
          <div className="btl-speed">{[1, 2, 4].map((s) => <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
          <button className={`btl-snd${sound ? " on" : ""}`} onClick={toggleSound} title="Sonification — pitch tracks equity, chime on new highs">♪ {sound ? "ON" : "OFF"}</button>
          <button className="btl-close" onClick={onClose}>✕ EXIT</button>
        </div>
      </div>
      {/* big PnL */}
      <div className="btl-pnl">
        <div ref={pnlRef} className="btl-pnlv">{money(run.config.startCash)}</div>
        <div className="btl-pnlsub">EQUITY · <span ref={retRef}>+0.00%</span> · DD <span ref={ddRef}>0.00%</span></div>
      </div>
      {/* live metrics */}
      <div className="btl-metrics">
        <Metric label="POSITION" value={inPos ? "IN MARKET" : "FLAT"} color={inPos ? "#2ee6a6" : "#8aa6bc"} />
        <Metric label="TRADES" value={String(played)} />
        <Metric label="WINS" value={`${wins} / ${played}`} />
        <Metric label="WIN RATE" value={played ? `${((wins / played) * 100).toFixed(0)}%` : "—"} />
        <Metric label="REALIZED P/L" value={money(realized)} color={realized >= 0 ? "#2ee6a6" : "#f4536a"} />
        <Metric label="DATE" value={""} refEl={dateRef} />
      </div>
      {/* transaction feed */}
      <div className="btl-feed">
        <div className="btl-feed-h">TRANSACTIONS</div>
        <div className="btl-feed-list">
          {playedTrades.slice().reverse().slice(0, 14).map((t, i) => (
            <div key={i} className="btl-feed-row">
              <span className={t.qty >= 0 ? "long" : "short"}>{t.qty >= 0 ? "▲ LONG" : "▼ SHORT"}</span>
              <span className="btl-feed-d">{ymd(t.entryT)}→{ymd(t.exitT)}</span>
              <b style={{ color: t.pnl >= 0 ? "#2ee6a6" : "#f4536a" }}>{t.pnl >= 0 ? "+" : ""}{money(t.pnl)}</b>
            </div>
          ))}
          {!playedTrades.length && <div className="btl-feed-none">Awaiting first trade…</div>}
        </div>
      </div>
      {/* progress */}
      <div className="btl-prog"><span ref={barRef} className="btl-prog-b">2 / {run.strategyEquity.length}</span><div className="btl-prog-track"><span ref={progRef} /></div>{done && <button className="btl-replay" onClick={onClose}>Done ✓</button>}</div>
      <style>{BTL_CSS}</style>
    </div>
  );
}

function Metric({ label, value, color, refEl }: { label: string; value: string; color?: string; refEl?: React.Ref<HTMLSpanElement> }) {
  return <div className="btl-metric"><div className="btl-metric-l">{label}</div><div className="btl-metric-v" style={{ color: color || "#dcebf7" }}><span ref={refEl}>{value}</span></div></div>;
}

const BTL_CSS = `
.btl-root { position:fixed; inset:0; z-index:12000; background:#03080f; font-family:var(--ax-disp,Oxanium),sans-serif; color:#dcebf7; overflow:hidden; animation:btl-in .5s ease; }
@keyframes btl-in { from{ opacity:0 } to{ opacity:1 } }
.btl-canvas { position:absolute; inset:0; }
.btl-scanlines { position:absolute; inset:0; pointer-events:none; background:repeating-linear-gradient(180deg,rgba(0,0,0,0) 0 2px,rgba(0,0,0,.10) 2px 3px); mix-blend-mode:overlay; opacity:.5; }
.btl-top { position:absolute; top:0; left:0; right:0; display:flex; align-items:center; justify-content:space-between; padding:16px 22px; background:linear-gradient(180deg,rgba(3,8,15,.85),transparent); }
.btl-brand { font-size:15px; font-weight:800; letter-spacing:.24em; color:#bafcff; }
.btl-brand em { display:block; font-style:normal; font-size:9px; letter-spacing:.2em; color:#6f97ad; margin-top:3px; }
.btl-topctl { display:flex; align-items:center; gap:12px; }
.btl-speed { display:flex; gap:3px; }
.btl-speed button { background:rgba(10,30,42,.7); border:1px solid rgba(80,200,255,.25); color:#8aa6bc; border-radius:6px; padding:5px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; }
.btl-speed button.on { color:#04121a; background:#4fe8ff; border-color:#4fe8ff; }
.btl-snd { background:rgba(10,30,42,.7); border:1px solid rgba(80,200,255,.25); color:#8aa6bc; border-radius:6px; padding:5px 11px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; }
.btl-snd.on { color:#04121a; background:#8ffce0; border-color:#8ffce0; }
.btl-close { background:rgba(244,83,106,.14); border:1px solid rgba(244,83,106,.5); color:#f4536a; border-radius:7px; padding:6px 13px; font-size:11px; font-weight:800; letter-spacing:.1em; cursor:pointer; font-family:inherit; }
.btl-pnl { position:absolute; top:78px; left:26px; }
.btl-pnlv { font-size:54px; font-weight:800; letter-spacing:.01em; color:#eafaff; text-shadow:0 0 30px rgba(80,232,255,.35); font-variant-numeric:tabular-nums; }
.btl-pnlsub { font-size:12px; letter-spacing:.16em; color:#8aa6bc; margin-top:2px; font-family:var(--ax-mono,ui-monospace); }
.btl-metrics { position:absolute; top:82px; right:26px; display:flex; flex-direction:column; gap:9px; width:210px; }
.btl-metric { display:flex; justify-content:space-between; align-items:baseline; padding:7px 12px; background:rgba(6,18,28,.62); border:1px solid rgba(80,200,255,.16); border-radius:9px; backdrop-filter:blur(6px); }
.btl-metric-l { font-size:8.5px; letter-spacing:.14em; color:#6f97ad; }
.btl-metric-v { font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; font-family:var(--ax-mono,ui-monospace); }
.btl-feed { position:absolute; bottom:70px; left:26px; width:320px; background:rgba(4,12,20,.66); border:1px solid rgba(80,200,255,.16); border-radius:11px; padding:10px 12px; backdrop-filter:blur(7px); }
.btl-feed-h { font-size:9px; letter-spacing:.2em; color:#5ec8e4; margin-bottom:7px; }
.btl-feed-list { display:flex; flex-direction:column; gap:4px; max-height:220px; overflow:hidden; }
.btl-feed-row { display:flex; align-items:center; gap:9px; font-family:var(--ax-mono,ui-monospace); font-size:10.5px; animation:btl-slide .35s ease; }
@keyframes btl-slide { from{ opacity:0; transform:translateX(-10px) } to{ opacity:1; transform:none } }
.btl-feed-row .long { color:#2ee6a6; font-weight:700; width:56px; }
.btl-feed-row .short { color:#f4536a; font-weight:700; width:56px; }
.btl-feed-d { color:#6f97ad; flex:1; }
.btl-feed-row b { font-variant-numeric:tabular-nums; }
.btl-feed-none { color:#5b7385; font-size:11px; font-family:var(--ax-mono,ui-monospace); }
.btl-prog { position:absolute; bottom:22px; left:26px; right:26px; display:flex; align-items:center; gap:12px; }
.btl-prog-b { font-family:var(--ax-mono,ui-monospace); font-size:10px; color:#6f97ad; min-width:80px; }
.btl-prog-track { flex:1; height:3px; background:rgba(80,200,255,.12); border-radius:3px; overflow:hidden; }
.btl-prog-track > span { display:block; height:100%; width:0%; background:linear-gradient(90deg,#1298c9,#8ffce0); box-shadow:0 0 10px rgba(80,232,255,.5); }
.btl-replay { background:#4fe8ff; color:#04121a; border:0; border-radius:7px; padding:6px 14px; font-weight:800; font-size:11px; cursor:pointer; font-family:inherit; }
`;
