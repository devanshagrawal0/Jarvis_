// APEX — loading screen (~4s), pure Canvas2D (no WebGL → no GPU lag). On-brand for a trading
// terminal: an "APEX COMPOSITE" market line draws itself left→right over a faint grid with a live
// price ticker and a leading glow dot, on near-black. The APEX wordmark + progress HUD live in the
// DOM overlay (ApexRoom), updated imperatively via onProgress.
// Signature preserved: startApexBoot(canvas, onDone, onProgress?) → stop().

const DURATION = 4000; // ms
const PTS = 260;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function startApexBoot(canvas: HTMLCanvasElement, onDone: () => void, onProgress?: (t: number) => void): () => void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const ctx = canvas.getContext("2d");
  if (!ctx) { const t = setTimeout(() => { onProgress?.(1); onDone(); }, 200); return () => clearTimeout(t); }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  const resize = () => {
    W = canvas.clientWidth || window.innerWidth; H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  // deterministic APEX-composite series: gentle up-drifting random walk, smoothed
  let seed = 7654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const raw: number[] = []; let v = 0;
  for (let i = 0; i < PTS; i++) { v += (rnd() - 0.44) * 1.0 + 0.05; raw.push(v); }
  // smooth
  const series: number[] = [];
  for (let i = 0; i < PTS; i++) { let s = 0, n = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < PTS) { s += raw[j]; n++; } } series.push(s / n); }
  const lo = Math.min(...series), hi = Math.max(...series), span = hi - lo || 1;
  const norm = series.map((x) => (x - lo) / span); // 0..1
  const base = 1000, priceOf = (n01: number) => base + n01 * 148; // "index" price range ~1000-1148

  const start = performance.now();
  let raf = 0, done = false;
  const finish = () => { if (done) return; done = true; onProgress?.(1); try { onDone(); } catch { /* noop */ } };
  if (reduced) { onProgress?.(1); const t = setTimeout(finish, 300); return () => { clearTimeout(t); cleanup(); }; }

  const AX_R = 66; // right price-axis gutter

  const frame = (now: number) => {
    const t = clamp01((now - start) / DURATION);
    onProgress?.(t);

    ctx.clearRect(0, 0, W, H);
    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#03080f"); bg.addColorStop(1, "#01040a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const padL = 40, padR = AX_R, padT = H * 0.16, padB = H * 0.16;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const X = (i: number) => padL + (i / (PTS - 1)) * plotW;
    const Y = (n01: number) => padT + (1 - n01) * plotH;

    // faint grid + right price scale
    ctx.lineWidth = 1; ctx.font = "10px ui-monospace, monospace"; ctx.textBaseline = "middle";
    for (let g = 0; g <= 4; g++) {
      const yy = padT + (g / 4) * plotH;
      ctx.strokeStyle = "rgba(120,160,190,0.06)"; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      const price = priceOf(1 - g / 4);
      ctx.fillStyle = "rgba(120,150,175,0.45)"; ctx.textAlign = "left";
      ctx.fillText(price.toFixed(0), W - padR + 10, yy);
    }

    const rev = Math.max(1, Math.floor(t * (PTS - 1)));
    // area fill under the revealed line
    ctx.beginPath(); ctx.moveTo(X(0), Y(norm[0]));
    for (let i = 1; i <= rev; i++) ctx.lineTo(X(i), Y(norm[i]));
    ctx.lineTo(X(rev), H - padB); ctx.lineTo(X(0), H - padB); ctx.closePath();
    const area = ctx.createLinearGradient(0, padT, 0, H - padB);
    area.addColorStop(0, "rgba(46,199,255,0.14)"); area.addColorStop(1, "rgba(46,199,255,0.0)");
    ctx.fillStyle = area; ctx.fill();

    // the line
    ctx.beginPath(); ctx.moveTo(X(0), Y(norm[0]));
    for (let i = 1; i <= rev; i++) ctx.lineTo(X(i), Y(norm[i]));
    ctx.strokeStyle = "#63c6ec"; ctx.lineWidth = 1.6; ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(46,199,255,0.5)"; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;

    // leading glow dot + a vertical scan line
    const lx = X(rev), ly = Y(norm[rev]);
    ctx.strokeStyle = "rgba(99,198,236,0.16)"; ctx.beginPath(); ctx.moveTo(lx, padT); ctx.lineTo(lx, H - padB); ctx.stroke();
    ctx.beginPath(); ctx.arc(lx, ly, 3.4, 0, 6.283); ctx.fillStyle = "#a9e2f7"; ctx.shadowColor = "#2ec7ff"; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;

    // APEX composite label + live-ish price near the dot
    const price = priceOf(norm[rev]);
    const chg = (norm[rev] - norm[0]) * (span / (base)) * 100 + norm[rev] * 1.2; // small positive-ish %
    ctx.textAlign = "left"; ctx.font = "600 11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(150,180,205,0.7)"; ctx.fillText("APEX COMPOSITE", padL, padT - 14);
    ctx.font = "700 15px ui-monospace, monospace"; ctx.fillStyle = "#dcecf7";
    const label = price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ctx.fillText(label, padL, padT - 32);
    ctx.font = "600 11px ui-monospace, monospace"; ctx.fillStyle = "#4fd39a";
    ctx.fillText("▲ " + chg.toFixed(2) + "%", padL + ctx.measureText(label).width + 12, padT - 30);

    if (t >= 1) { finish(); return; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  function cleanup() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); }
  return () => cleanup();
}
