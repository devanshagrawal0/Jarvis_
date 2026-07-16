// APEX — cinematic loading screen (~4.6s), pure Canvas2D (no WebGL → no GPU lag). A "terminal coming
// online" montage: a scrolling ticker tape, an APEX-composite candlestick chart (candles + MA + volume
// + price axis) drawing in, a live order-book depth ladder, regime/VIX/breadth stat tiles counting up,
// a streaming boot log, and a scan sweep — composed around a centre vignette for the DOM wordmark.
// Signature preserved: startApexBoot(canvas, onDone, onProgress?) → stop().

const DURATION = 4600; // ms
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

type Candle = { o: number; h: number; l: number; c: number; v: number };

export function startApexBoot(canvas: HTMLCanvasElement, onDone: () => void, onProgress?: (t: number) => void): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const ctx = canvas.getContext("2d");
  if (!ctx) { const t = setTimeout(() => { onProgress?.(1); onDone(); }, 200); return () => clearTimeout(t); }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  const resize = () => { W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize(); window.addEventListener("resize", resize);

  let seed = 7654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const UP = "#3fb489", DN = "#e0566a", ACC = "#63c6ec", MUT = "rgba(140,170,195,0.5)", DIM = "rgba(120,150,175,0.32)";

  // ── candlestick series (APEX composite) ──
  const NC = 58; const candles: Candle[] = []; let px = 1000;
  for (let i = 0; i < NC; i++) { const o = px; const mv = (rnd() - 0.44) * 9; const c = o + mv; const h = Math.max(o, c) + rnd() * 5; const l = Math.min(o, c) - rnd() * 5; candles.push({ o, h, l, c, v: 0.3 + rnd() * 0.7 }); px = c; }
  const ma: number[] = []; for (let i = 0; i < NC; i++) { let s = 0, n = 0; for (let k = -4; k <= 0; k++) { const j = i + k; if (j >= 0) { s += candles[j].c; n++; } } ma.push(s / n); }
  const lo = Math.min(...candles.map((c) => c.l)), hi = Math.max(...candles.map((c) => c.h)), span = (hi - lo) || 1;

  // ── ticker tape ──
  const TICK = [["NVDA", 2.41], ["AAPL", 1.08], ["MSFT", -0.21], ["TSLA", -1.27], ["BTC", 1.53], ["SPY", 0.35], ["META", 1.31], ["AMZN", 0.73], ["ETH", 2.12], ["GOOGL", -0.42], ["AMD", 2.15], ["NFLX", 0.66], ["QQQ", 0.51], ["GLD", -0.18]];

  // ── order book ──
  const book: { bid: number; ask: number }[] = []; for (let i = 0; i < 9; i++) book.push({ bid: 0.2 + rnd() * 0.8, ask: 0.2 + rnd() * 0.8 });

  // ── boot log ──
  const LOG: [number, string][] = [[0.04, "core online"], [0.16, "market data feeds ....... connected"], [0.30, "regime engine ........... calibrated"], [0.45, "oracle prediction core .. ready"], [0.60, "watchlists + scanners ... loaded"], [0.75, "news intelligence ....... streaming"], [0.90, "terminal ................ rendering"]];

  const start = performance.now(); let raf = 0, done = false;
  const finish = () => { if (done) return; done = true; onProgress?.(1); try { onDone(); } catch { /* noop */ } };
  if (reduced) { onProgress?.(1); const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  const frame = (now: number) => {
    const t = clamp01((now - start) / DURATION); onProgress?.(t);

    // backdrop + faint grid
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#03080f"); bg.addColorStop(1, "#01040a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(90,130,160,0.04)"; ctx.lineWidth = 1;
    for (let x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, H - 60); ctx.stroke(); }
    for (let y = 90; y < H - 40; y += 54) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke(); }

    // ── ticker tape (top) ──
    const tyH = 30, ty = 42; ctx.font = "600 12px ui-monospace, monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillStyle = "rgba(3,10,18,0.7)"; ctx.fillRect(0, ty - tyH / 2, W, tyH);
    ctx.strokeStyle = "rgba(90,140,175,0.12)"; ctx.beginPath(); ctx.moveTo(0, ty + tyH / 2); ctx.lineTo(W, ty + tyH / 2); ctx.stroke();
    const scroll = (t * 260) % 1e9; let tx = 30 - scroll;
    // draw ticker twice for wrap
    for (let rep = 0; rep < 3; rep++) {
      let cx = tx + rep * (TICK.length * 150);
      for (const [sym, pc] of TICK) { const up = (pc as number) >= 0; ctx.fillStyle = "#cfe0ee"; ctx.fillText(sym as string, cx, ty); const sw = ctx.measureText(sym as string).width; ctx.fillStyle = up ? UP : DN; ctx.fillText(`${up ? "▲" : "▼"}${Math.abs(pc as number).toFixed(2)}%`, cx + sw + 8, ty); cx += 150; }
    }

    // ── main candlestick chart ──
    const cpL = 60, cpR = W - 78, cpT = 96, cpB = H - 150;
    const plotW = cpR - cpL, plotH = (cpB - cpT) * 0.78, volTop = cpT + plotH + 10, volH = (cpB - cpT) * 0.16;
    const X = (i: number) => cpL + (i + 0.5) / NC * plotW;
    const Y = (p: number) => cpT + (1 - (p - lo) / span) * plotH;
    // price axis
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left";
    for (let g = 0; g <= 4; g++) { const yy = cpT + g / 4 * plotH; ctx.strokeStyle = "rgba(120,160,190,0.05)"; ctx.beginPath(); ctx.moveTo(cpL, yy); ctx.lineTo(cpR, yy); ctx.stroke(); ctx.fillStyle = DIM; ctx.fillText((hi - g / 4 * span).toFixed(0), cpR + 8, yy); }
    const rev = Math.floor(easeOut(t / 0.9) * NC);
    const cw = Math.max(2, (plotW / NC) * 0.58);
    // volume
    for (let i = 0; i < rev; i++) { const c = candles[i]; ctx.fillStyle = (c.c >= c.o ? "rgba(63,180,137,0.35)" : "rgba(224,86,106,0.35)"); const bh = c.v * volH; ctx.fillRect(X(i) - cw / 2, volTop + volH - bh, cw, bh); }
    // candles
    for (let i = 0; i < rev; i++) { const c = candles[i]; const up = c.c >= c.o; ctx.strokeStyle = up ? UP : DN; ctx.fillStyle = up ? UP : DN; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(i), Y(c.h)); ctx.lineTo(X(i), Y(c.l)); ctx.stroke(); const yO = Y(c.o), yC = Y(c.c); ctx.fillRect(X(i) - cw / 2, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO))); }
    // MA line
    if (rev > 1) { ctx.beginPath(); ctx.moveTo(X(0), Y(ma[0])); for (let i = 1; i < rev; i++) ctx.lineTo(X(i), Y(ma[i])); ctx.strokeStyle = ACC; ctx.lineWidth = 1.4; ctx.shadowColor = "rgba(99,198,236,0.5)"; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0; }
    // leading dot + scan
    if (rev > 0) { const i = rev - 1; const yy = Y(candles[i].c); ctx.strokeStyle = "rgba(99,198,236,0.14)"; ctx.beginPath(); ctx.moveTo(X(i), cpT); ctx.lineTo(X(i), cpB); ctx.stroke(); ctx.beginPath(); ctx.arc(X(i), yy, 3, 0, 6.283); ctx.fillStyle = "#a9e2f7"; ctx.shadowColor = "#2ec7ff"; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0; }
    // composite label
    const priceNow = candles[Math.max(0, rev - 1)].c; const chg = ((priceNow - candles[0].o) / candles[0].o) * 100;
    ctx.textAlign = "left"; ctx.font = "600 11px ui-monospace, monospace"; ctx.fillStyle = MUT; ctx.fillText("APEX COMPOSITE  ·  1D", cpL, cpT - 20);
    ctx.font = "700 16px ui-monospace, monospace"; ctx.fillStyle = "#e6f1fa"; ctx.fillText(priceNow.toFixed(2), cpL + 132, cpT - 18); ctx.font = "600 11px ui-monospace, monospace"; ctx.fillStyle = chg >= 0 ? UP : DN; ctx.fillText(`${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%`, cpL + 132 + ctx.measureText(priceNow.toFixed(2)).width + 12, cpT - 18);

    // ── order-book depth ladder (right) ──
    const obX = W - 250, obW = 172, obT = cpT + 6, rh = 13, obReveal = clamp01((t - 0.3) / 0.4);
    ctx.textAlign = "left"; ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = DIM; ctx.fillText("ORDER BOOK", obX, obT - 8);
    for (let i = 0; i < book.length; i++) {
      const yy = obT + i * rh; const b = book[i];
      const av = Math.min(1, b.ask * obReveal), bv = Math.min(1, b.bid * obReveal);
      ctx.fillStyle = "rgba(224,86,106,0.16)"; ctx.fillRect(obX + obW / 2, yy, (obW / 2) * av, rh - 3);
      ctx.fillStyle = "rgba(63,180,137,0.16)"; ctx.fillRect(obX + obW / 2 - (obW / 2) * bv, yy, (obW / 2) * bv, rh - 3);
      ctx.fillStyle = "rgba(120,150,175,0.45)"; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText((priceNow + (book.length / 2 - i) * 0.12).toFixed(2), obX + obW / 2, yy + rh / 2 - 1);
    }

    // ── stat tiles (right, under book) ──
    const stats: [string, string, string][] = [["REGIME", "RISK-ON", UP], ["VIX", (14 + (1 - t) * 4).toFixed(2), MUT], ["BREADTH", `${Math.round(52 + t * 12)}%`, ACC]];
    const stY = obT + book.length * rh + 20;
    stats.forEach(([k, v, col], i) => { const yy = stY + i * 30; const rv = clamp01((t - 0.4 - i * 0.06) / 0.2); ctx.globalAlpha = rv; ctx.textAlign = "left"; ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = DIM; ctx.fillText(k, obX, yy); ctx.font = "700 14px ui-monospace, monospace"; ctx.fillStyle = col; ctx.fillText(v, obX, yy + 16); ctx.globalAlpha = 1; });

    // ── boot log (bottom-left) ──
    ctx.textAlign = "left"; ctx.font = "11px ui-monospace, monospace";
    let ly = H - 40 - (LOG.filter(([thr]) => t >= thr).length) * 17;
    for (const [thr, msg] of LOG) { if (t < thr) continue; const ok = t > thr + 0.05; ctx.fillStyle = "rgba(99,198,236,0.6)"; ctx.fillText("▸", 44, ly); ctx.fillStyle = "rgba(150,175,198,0.75)"; ctx.fillText(msg, 62, ly); if (ok) { ctx.fillStyle = UP; ctx.fillText("OK", 62 + ctx.measureText(msg).width + 12, ly); } ly += 17; }

    // ── centre vignette so the DOM APEX wordmark stays legible ──
    const vg = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, Math.max(W, H) * 0.42);
    vg.addColorStop(0, "rgba(1,4,10,0.82)"); vg.addColorStop(0.55, "rgba(1,4,10,0.35)"); vg.addColorStop(1, "rgba(1,4,10,0)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // horizontal scan sweep
    const sy = ((t * 1.4) % 1) * H; const sg = ctx.createLinearGradient(0, sy - 40, 0, sy + 40); sg.addColorStop(0, "rgba(99,198,236,0)"); sg.addColorStop(0.5, "rgba(99,198,236,0.05)"); sg.addColorStop(1, "rgba(99,198,236,0)"); ctx.fillStyle = sg; ctx.fillRect(0, sy - 40, W, 80);

    if (t >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function cleanup() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); }
  return () => cleanup();
}
