/* ═══════════════════════════════════════════════════════════
   APEX — Cinematic boot sequence (canvas)
   Ported from the approved standalone reference. Runs a rapid
   trading montage (candles / spikes / ticker walls / depth /
   heatmap / number streams / archival newspapers / breaking
   news) that accelerates, pulls back into the APEX letterforms,
   flashes, then settles on a cold-steel lockup.

   startApexBoot(canvas, onDone) begins the loop and calls
   onDone() once progress reaches 100%. It returns a stop()
   cleanup that cancels the RAF and removes listeners.
   ═══════════════════════════════════════════════════════════ */

type SceneData = any;
interface Scene {
  init: () => SceneData;
  draw: (c: CanvasRenderingContext2D, w: number, h: number, p: number, d: SceneData, lt?: number) => void;
}

export function startApexBoot(cv: HTMLCanvasElement, onDone: () => void): () => void {
  const ctx = cv.getContext("2d")!;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const monCv = document.createElement("canvas");  const monCtx  = monCv.getContext("2d")!;
  const maskCv = document.createElement("canvas"); const maskCtx = maskCv.getContext("2d")!;
  const compCv = document.createElement("canvas"); const compCtx = compCv.getContext("2d")!;

  function resize() {
    const W = window.innerWidth, H = window.innerHeight;
    for (const c of [cv, monCv, maskCv, compCv]) { c.width = W * DPR; c.height = H * DPR; }
    cv.style.width = W + "px"; cv.style.height = H + "px";
  }
  resize();
  window.addEventListener("resize", resize);

  /* film grain tile */
  const grainTile = document.createElement("canvas");
  grainTile.width = grainTile.height = 256;
  {
    const g = grainTile.getContext("2d")!;
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255 | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 26;
    }
    g.putImageData(img, 0, 0);
  }

  const GREEN = "#2ea882", RED = "#c4515e", CYAN = "#5ec8ff";
  const TICKERS = ["NVDA", "AAPL", "TSLA", "SPY", "QQQ", "MSFT", "AMZN", "META", "AMD", "PLTR", "COIN", "GOOGL", "NFLX", "AVGO", "CRM", "ORCL"];
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: T[]): T => arr[Math.random() * arr.length | 0];

  function makeWalk(n: number, start: number, vol: number) {
    const out: number[] = []; let p = start;
    for (let i = 0; i < n; i++) { p += (Math.random() - .48) * vol; out.push(p); }
    return out;
  }

  /* ═══════════════ MONTAGE SCENES ═══════════════ */
  const SCENES: Record<string, Scene> = {
    candles: {
      init() {
        const n = 30, walk = makeWalk(n + 1, 100, 6);
        return { n, candles: Array.from({ length: n }, (_, i) => {
          const o = walk[i], c = walk[i + 1];
          return { o, c, h: Math.max(o, c) + rnd(0, 3), l: Math.min(o, c) - rnd(0, 3) };
        }) };
      },
      draw(c, w, h, p, d) {
        const { n, candles } = d;
        const vis = Math.max(2, Math.ceil(p * 1.25 * n));
        const shown = candles.slice(0, vis);
        const all = shown.flatMap((k: any) => [k.h, k.l]);
        const mn = Math.min(...all), mx = Math.max(...all), rg = mx - mn || 1;
        const px = w * .08, py = h * .16, pw = w * .84, ph = h * .68, cw = pw / n;
        const Y = (v: number) => py + ph - ((v - mn) / rg) * ph;
        c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 1;
        for (let i = 0; i <= 5; i++) { c.beginPath(); c.moveTo(px, py + ph * i / 5); c.lineTo(px + pw, py + ph * i / 5); c.stroke(); }
        for (let i = 0; i < vis && i < n; i++) {
          const k = candles[i], up = k.c >= k.o, col = up ? GREEN : RED;
          const x = px + i * cw, cx2 = x + cw / 2;
          c.strokeStyle = col; c.lineWidth = Math.max(1.5, cw * .09);
          c.beginPath(); c.moveTo(cx2, Y(k.h)); c.lineTo(cx2, Y(k.l)); c.stroke();
          c.fillStyle = col;
          const t2 = Y(Math.max(k.o, k.c)), b2 = Y(Math.min(k.o, k.c));
          c.fillRect(x + cw * .18, t2, cw * .64, Math.max(2, b2 - t2));
          if (i === vis - 1) {
            c.shadowColor = col; c.shadowBlur = 12;
            c.fillRect(x + cw * .18, t2, cw * .64, Math.max(2, b2 - t2));
            c.shadowBlur = 0;
            c.fillStyle = "#fff"; c.font = `700 ${h * .03 | 0}px Consolas,monospace`; c.textAlign = "left";
            c.fillText(k.c.toFixed(2), x + cw, Y(k.c));
          }
        }
      }
    },

    spike: {
      init() {
        const crash = Math.random() < .45, n = 90, pts: number[] = []; let v = 100;
        for (let i = 0; i < n; i++) {
          const ramp = i / n;
          v += (Math.random() - (crash ? .38 : .58)) * 3 * (1 + ramp * 2.2);
          pts.push(v);
        }
        return { pts, crash };
      },
      draw(c, w, h, p, d) {
        const { pts, crash } = d, col = crash ? RED : GREEN;
        const vis = Math.max(2, Math.ceil(p * 1.15 * pts.length));
        const shown = pts.slice(0, vis);
        const mn = Math.min(...shown), mx = Math.max(...shown), rg = mx - mn || 1;
        const py = h * .12, ph = h * .76;
        const X = (i: number) => (i / (pts.length - 1)) * w;
        const Y = (v: number) => py + ph - ((v - mn) / rg) * ph;
        c.beginPath(); c.moveTo(X(0), Y(shown[0]));
        for (let i = 1; i < vis; i++) c.lineTo(X(i), Y(shown[i]));
        c.lineTo(X(vis - 1), h); c.lineTo(0, h); c.closePath();
        const g = c.createLinearGradient(0, py, 0, h);
        g.addColorStop(0, col + "33"); g.addColorStop(1, col + "00");
        c.fillStyle = g; c.fill();
        c.beginPath(); c.moveTo(X(0), Y(shown[0]));
        for (let i = 1; i < vis; i++) c.lineTo(X(i), Y(shown[i]));
        c.strokeStyle = col; c.lineWidth = Math.max(2.5, h * .006);
        c.shadowColor = col; c.shadowBlur = 12; c.stroke(); c.shadowBlur = 0;
        const ex = X(vis - 1), ey = Y(shown[vis - 1]);
        c.beginPath(); c.arc(ex, ey, h * .012, 0, 7);
        c.fillStyle = "#e6e9ee"; c.shadowColor = col; c.shadowBlur = 14; c.fill(); c.shadowBlur = 0;
        const chg = ((shown[vis - 1] - pts[0]) / pts[0] * 100);
        c.fillStyle = col; c.font = `900 ${h * .14 | 0}px "Arial Black",Arial,sans-serif`;
        c.textAlign = "left"; c.globalAlpha = .55;
        c.fillText((chg >= 0 ? "+" : "") + chg.toFixed(2) + "%", w * .06, h * .3);
        c.globalAlpha = 1;
      }
    },

    tickerwall: {
      init() {
        const rows = 7, cols = 5;
        return { rows, cols, cells: Array.from({ length: rows * cols }, () => ({
          tk: pick(TICKERS), price: rnd(40, 900), chg: rnd(-4, 4), flash: 0
        })) };
      },
      draw(c, w, h, _p, d) {
        const { rows, cols, cells } = d;
        const cw = w / cols, chh = h / rows;
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          if (Math.random() < .12) { cell.price *= 1 + rnd(-.004, .004); cell.chg += rnd(-.15, .15); cell.flash = 1; }
          cell.flash *= .82;
          const r = i / cols | 0, col2 = i % cols;
          const x = col2 * cw, y = r * chh;
          const up = cell.chg >= 0, cc = up ? GREEN : RED;
          if (cell.flash > .1) {
            c.fillStyle = (up ? "rgba(46,168,130," : "rgba(196,81,94,") + (cell.flash * .09) + ")";
            c.fillRect(x, y, cw, chh);
          }
          c.strokeStyle = "rgba(255,255,255,.05)"; c.strokeRect(x, y, cw, chh);
          c.textAlign = "left";
          c.fillStyle = "rgba(255,255,255,.9)"; c.font = `700 ${chh * .2 | 0}px Consolas,monospace`;
          c.fillText(cell.tk, x + cw * .08, y + chh * .36);
          c.fillStyle = cc; c.font = `400 ${chh * .17 | 0}px Consolas,monospace`;
          c.fillText(cell.price.toFixed(2), x + cw * .08, y + chh * .62);
          c.fillText((up ? "▲ +" : "▼ ") + cell.chg.toFixed(2) + "%", x + cw * .08, y + chh * .85);
        }
      }
    },

    depth: {
      init() {
        const n = 34;
        return {
          bids: Array.from({ length: n }, (_, i) => Math.pow(i / n, 1.4) + rnd(0, .12)),
          asks: Array.from({ length: n }, (_, i) => Math.pow(i / n, 1.4) + rnd(0, .12)),
          mid: rnd(100, 600)
        };
      },
      draw(c, w, h, p, d) {
        const { bids, asks, mid } = d, n = bids.length;
        const reveal = Math.min(1, p * 1.4), cx2 = w / 2, bw = (w * .46) / n;
        for (let i = 0; i < n * reveal; i++) {
          const bh = bids[i] * h * .6 * (1 + Math.sin(performance.now() * .004 + i) * .04);
          const ah = asks[i] * h * .6 * (1 + Math.cos(performance.now() * .005 + i) * .04);
          c.fillStyle = "rgba(0,229,137,.55)";
          c.fillRect(cx2 - (i + 1) * bw - 1, h * .82 - bh, bw - 2, bh);
          c.fillStyle = "rgba(255,59,78,.55)";
          c.fillRect(cx2 + i * bw + 1, h * .82 - ah, bw - 2, ah);
        }
        c.strokeStyle = "rgba(255,255,255,.5)"; c.setLineDash([6, 6]); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(cx2, h * .1); c.lineTo(cx2, h * .85); c.stroke(); c.setLineDash([]);
        c.fillStyle = "#fff"; c.font = `900 ${h * .06 | 0}px "Arial Black",Arial,sans-serif`; c.textAlign = "center";
        c.fillText("$" + mid.toFixed(2), cx2, h * .08);
        c.font = `400 ${h * .022 | 0}px Consolas,monospace`;
        c.fillStyle = GREEN; c.textAlign = "right"; c.fillText("BIDS", cx2 - w * .03, h * .9);
        c.fillStyle = RED; c.textAlign = "left"; c.fillText("ASKS", cx2 + w * .03, h * .9);
      }
    },

    heatmap: {
      init() {
        const rows = 6, cols = 9;
        return { rows, cols, tiles: Array.from({ length: rows * cols }, () => ({
          tk: pick(TICKERS), v: rnd(-3, 3)
        })) };
      },
      draw(c, w, h, _p, d) {
        const { rows, cols, tiles } = d;
        const cw = w / cols, chh = h / rows;
        for (let i = 0; i < tiles.length; i++) {
          const t2 = tiles[i];
          if (Math.random() < .09) t2.v += rnd(-.6, .6);
          const r = i / cols | 0, col2 = i % cols;
          const x = col2 * cw, y = r * chh;
          const mag = Math.min(1, Math.abs(t2.v) / 3);
          c.fillStyle = t2.v >= 0 ? `rgba(34,130,95,${.12 + mag * .38})` : `rgba(165,52,64,${.12 + mag * .38})`;
          c.fillRect(x + 2, y + 2, cw - 4, chh - 4);
          c.fillStyle = "rgba(230,235,240,.75)";
          c.font = `700 ${chh * .2 | 0}px Arial,sans-serif`; c.textAlign = "center";
          c.fillText(t2.tk, x + cw / 2, y + chh * .46);
          c.font = `400 ${chh * .16 | 0}px Consolas,monospace`;
          c.fillText((t2.v >= 0 ? "+" : "") + t2.v.toFixed(2) + "%", x + cw / 2, y + chh * .72);
        }
      }
    },

    numstream: {
      init() {
        return { rows: Array.from({ length: 14 }, (_, i) => ({
          y: (i + .5) / 14, speed: rnd(400, 1400) * (Math.random() < .5 ? 1 : -1),
          items: Array.from({ length: 10 }, () => ({
            txt: pick(TICKERS) + " " + rnd(40, 900).toFixed(2), up: Math.random() < .55, x: rnd(0, 3000)
          }))
        })) };
      },
      draw(c, w, h, _p, d, lt = 0) {
        c.font = `700 ${h * .05 | 0}px Consolas,monospace`; c.textAlign = "left";
        for (const row of d.rows) {
          for (const it of row.items) {
            let x = (it.x + row.speed * lt) % (w + 600) - 300;
            if (x < -300) x += w + 600;
            c.fillStyle = it.up ? GREEN : RED;
            c.globalAlpha = .5;
            c.fillText(it.txt, x, row.y * h);
          }
        }
        c.globalAlpha = 1;
        c.fillStyle = "rgba(255,255,255,.025)";
        for (let i = 0; i < 5; i++) c.fillRect(0, rnd(0, h), w, 1);
      }
    },

    /* ── Newspaper — dark archival close-up, slow push-in ── */
    newspaper: {
      init() {
        const headlines = [
          ["MARKETS IN FREEFALL", "TRILLIONS ERASED"],
          ["GLOBAL SELL-OFF", "DEEPENS OVERNIGHT"],
          ["PANIC GRIPS", "THE TRADING FLOOR"],
          ["BANKS ON THE BRINK", "AS CREDIT FREEZES"],
          ["THE DAY THE", "MARKET BROKE"],
          ["FLASH CRASH WIPES", "$3T IN MINUTES"],
          ["NO BUYERS LEFT:", "LIQUIDITY VANISHES"],
        ];
        return {
          hl: pick(headlines),
          rot: rnd(-.022, .022),
          cols: Array.from({ length: 4 }, () => Array.from({ length: 30 }, () => rnd(.5, 1))),
          chart: makeWalk(40, 50, 4).map((v, i) => v - i * .8),
          driftX: rnd(-.02, .02),
        };
      },
      draw(c, w, h, p, d) {
        const zoom = 1.05 + p * .09;
        const pw = w * 1.25, ph = pw * 1.3;
        c.save();
        c.translate(w / 2 + d.driftX * w * p, h * .44);
        c.rotate(d.rot);
        c.scale(zoom, zoom);
        c.translate(-pw / 2, -ph * .12);
        const pg = c.createLinearGradient(0, 0, 0, ph * .6);
        pg.addColorStop(0, "#6e695c");
        pg.addColorStop(.35, "#57534a");
        pg.addColorStop(1, "#2b2925");
        c.fillStyle = pg;
        c.fillRect(0, 0, pw, ph);
        const M = pw * .05;
        c.fillStyle = "rgba(16,14,11,.9)";
        c.font = `900 ${pw * .045 | 0}px Georgia,"Times New Roman",serif`;
        c.textAlign = "center";
        c.fillText("THE FINANCIAL LEDGER", pw / 2, M + pw * .038);
        c.font = `400 ${pw * .013 | 0}px Georgia,serif`;
        c.fillStyle = "rgba(30,27,22,.7)";
        c.fillText("LATE CITY FINAL — MARKETS EDITION", pw / 2, M + pw * .062);
        c.fillStyle = "rgba(16,14,11,.85)";
        c.fillRect(M, M + pw * .075, pw - 2 * M, 2.5);
        c.font = `900 ${pw * .075 | 0}px "Arial Black",Arial,sans-serif`;
        c.fillStyle = "rgba(14,12,10,.95)";
        c.fillText(d.hl[0], pw / 2, M + pw * .165);
        c.fillText(d.hl[1], pw / 2, M + pw * .245);
        c.fillRect(M, M + pw * .275, pw - 2 * M, 1);
        const colW = (pw - 2 * M - 3 * pw * .018) / 4;
        for (let ci = 0; ci < 4; ci++) {
          const x = M + ci * (colW + pw * .018);
          for (let li = 0; li < d.cols[ci].length; li++) {
            const y = M + pw * .3 + li * pw * .017;
            if (y > ph * .62) break;
            const fade = 1 - (y - M - pw * .3) / (ph * .32);
            c.fillStyle = `rgba(22,19,15,${.5 * Math.max(0, fade)})`;
            c.fillRect(x, y, colW * d.cols[ci][li], pw * .006);
          }
        }
        const bx = M + 2 * (colW + pw * .018), bw2 = colW * 2 + pw * .018, by = M + pw * .31, bh2 = pw * .14;
        c.strokeStyle = "rgba(16,14,11,.6)"; c.lineWidth = 1.2; c.strokeRect(bx, by, bw2, bh2);
        const pts = d.chart;
        const mn = Math.min(...pts), mx = Math.max(...pts), rg = mx - mn || 1;
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = bx + bw2 * .06 + (i / (pts.length - 1)) * bw2 * .88;
          const y = by + bh2 * .85 - ((pts[i] - mn) / rg) * bh2 * .65;
          i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.strokeStyle = "rgba(110,26,26,.8)"; c.lineWidth = 1.8; c.stroke();
        c.restore();
        const vg = c.createRadialGradient(w / 2, h * .38, h * .12, w / 2, h * .45, h * .9);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(.55, "rgba(0,0,0,.35)");
        vg.addColorStop(1, "rgba(0,0,0,.92)");
        c.fillStyle = vg;
        c.fillRect(0, 0, w, h);
        const ly = h * .1 + Math.sin(p * 2) * h * .02;
        const lg2 = c.createLinearGradient(0, ly - h * .12, 0, ly + h * .12);
        lg2.addColorStop(0, "rgba(255,250,235,0)");
        lg2.addColorStop(.5, "rgba(255,250,235,.05)");
        lg2.addColorStop(1, "rgba(255,250,235,0)");
        c.fillStyle = lg2;
        c.fillRect(0, ly - h * .12, w, h * .24);
      }
    },

    /* ── Breaking-news lower third ── */
    breaking: {
      init() {
        const lines = [
          "S&P 500 CROSSES 6,000 FOR FIRST TIME IN HISTORY",
          "NVIDIA BECOMES MOST VALUABLE COMPANY ON EARTH",
          "TRADING VOLUME HITS ALL-TIME RECORD ON NYSE",
          "RETAIL TRADERS MOVE $40B IN SINGLE SESSION",
          "CIRCUIT BREAKERS TRIGGERED AS MARKETS WHIPSAW",
        ];
        return { line: pick(lines), chart: makeWalk(120, 100, 3), tick: 0 };
      },
      draw(c, w, h, p, d, lt = 0) {
        const pts = d.chart;
        const mn = Math.min(...pts), mx = Math.max(...pts), rg = mx - mn || 1;
        c.strokeStyle = "rgba(120,190,255,.14)"; c.lineWidth = 2;
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = (i / (pts.length - 1)) * w;
          const y = h * .15 + (1 - ((pts[i] - mn) / rg)) * h * .5;
          i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
        const bh2 = h * .09, by = h * .62;
        const slide = Math.min(1, p * 4);
        c.fillStyle = "#7a1518";
        c.fillRect(0, by, w * slide, bh2);
        if (slide >= 1) {
          c.fillStyle = "#fff";
          c.font = `900 ${bh2 * .52 | 0}px "Arial Black",Arial,sans-serif`;
          c.textAlign = "left";
          c.fillText("BREAKING", w * .03, by + bh2 * .68);
          c.fillStyle = "rgba(10,12,16,.92)";
          c.fillRect(0, by + bh2, w, bh2 * .9);
          c.fillStyle = "#e8ecf2";
          c.font = `700 ${bh2 * .38 | 0}px Arial,sans-serif`;
          c.fillText(d.line, w * .03, by + bh2 * 1.62);
          const blink = (Math.sin(lt * 6) + 1) / 2;
          c.fillStyle = `rgba(255,59,78,${.4 + blink * .6})`;
          c.beginPath(); c.arc(w * .94, by + bh2 * .5, bh2 * .14, 0, 7); c.fill();
          c.fillStyle = "#fff"; c.font = `700 ${bh2 * .3 | 0}px Arial,sans-serif`;
          c.textAlign = "right";
          c.fillText("LIVE", w * .92, by + bh2 * .6);
        }
        c.fillStyle = "rgba(8,10,14,.9)";
        c.fillRect(0, h * .88, w, h * .05);
        c.font = `700 ${h * .026 | 0}px Consolas,monospace`; c.textAlign = "left";
        const spd = w * .18;
        for (let i = 0; i < 10; i++) {
          const tx = ((i * w * .16) - (lt * spd)) % (w * 1.6);
          const xx = tx < 0 ? tx + w * 1.6 : tx;
          const up = i % 3 !== 0;
          c.fillStyle = up ? GREEN : RED;
          c.fillText(TICKERS[i % TICKERS.length] + (up ? " ▲" : " ▼"), xx - w * .3, h * .915);
        }
      }
    }
  };

  const STAMPS = ["MOMENTUM", "VOLATILITY", "EXECUTION", "ALPHA", "LIQUIDITY", "LEVERAGE", "SIGNAL", "RISK"];

  /* ═══════════════ TIMELINE ═══════════════ */
  const P1_END = 6.4;
  const P2_END = 9.4;
  const FLASH_T = 9.4;
  const TOTAL = 13.2;

  type SchedItem = { t0: number; t1: number; key: string; data: SceneData; stamp: string };
  let schedule: SchedItem[] = [];
  function buildSchedule() {
    schedule = [];
    const base = ["candles", "spike", "tickerwall", "depth", "heatmap", "numstream"].sort(() => Math.random() - .5);
    const pool: string[] = [];
    let bi = 0;
    for (let i = 0; i < 40; i++) {
      if (i > 0 && i % 3 === 2) pool.push(Math.random() < .6 ? "newspaper" : "breaking");
      else { pool.push(base[bi % base.length]); bi++; }
    }
    let t = 0, dur = 1.35, i = 0;
    while (t < P2_END + .3) {
      schedule.push({ t0: t, t1: t + dur, key: pool[i % pool.length], data: null, stamp: pick(STAMPS) });
      t += dur; i++;
      dur = Math.max(.24, dur * .88);
    }
  }
  buildSchedule();

  function currentScene(t: number) {
    for (const s of schedule) if (t >= s.t0 && t < s.t1) return s;
    return schedule[schedule.length - 1];
  }

  /* cold dust for the lockup */
  let dust: any[] = [];
  function spawnDust() {
    dust = Array.from({ length: 110 }, () => ({
      x: rnd(0, 1), y: rnd(.2, .9),
      vx: rnd(-.006, .006), vy: rnd(-.012, -.003),
      life: rnd(.4, 1), sz: rnd(.6, 2), tw: rnd(0, 7)
    }));
  }

  const easeOutCubic = (v: number) => 1 - Math.pow(1 - v, 3);

  function fontSpec(px: number) { return `900 ${px}px "Arial Black","Helvetica Neue",Arial,sans-serif`; }

  function wordWidthAt100(c: CanvasRenderingContext2D) {
    c.font = fontSpec(100);
    let total = 0;
    for (const ch of "APEX") total += c.measureText(ch).width;
    return total + 100 * .12 * 3;
  }

  function drawWordmark(c: CanvasRenderingContext2D, size: number, mode: "fill" | "stroke") {
    c.save();
    c.font = fontSpec(size);
    c.textAlign = "center"; c.textBaseline = "middle";
    const word = "APEX", track = size * .12;
    let total = 0; const widths: number[] = [];
    for (const ch of word) { const m = c.measureText(ch).width; widths.push(m); total += m; }
    total += track * 3;
    let x = (cv.width - total) / 2;
    for (let i = 0; i < 4; i++) {
      if (mode === "stroke") c.strokeText(word[i], x + widths[i] / 2, cv.height / 2);
      else c.fillText(word[i], x + widths[i] / 2, cv.height / 2);
      x += widths[i] + track;
    }
    c.restore();
  }

  let pulseLine = makeWalk(300, 0, 1.2);

  let t0: number | null = null, raf = 0, done = false, flashDone = false, frame = 0, stopped = false;

  function loop(now: number) {
    if (stopped) return;
    if (t0 === null) t0 = now;
    const t = (now - t0) / 1000;
    const w = cv.width, h = cv.height;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    /* ---------- MONTAGE (P1 + P2) ---------- */
    if (t < P2_END + .1) {
      const sc = currentScene(t);
      if (!sc.data) sc.data = SCENES[sc.key].init();
      const lt = t - sc.t0, sp = Math.min(1, lt / (sc.t1 - sc.t0));

      monCtx.fillStyle = "#04050a";
      monCtx.fillRect(0, 0, w, h);
      SCENES[sc.key].draw(monCtx, w, h, sp, sc.data, lt);

      if (sc.key !== "newspaper") {
        monCtx.save();
        monCtx.globalAlpha = .04;
        monCtx.fillStyle = "#fff";
        monCtx.font = fontSpec(h * .2 | 0);
        monCtx.textAlign = "center"; monCtx.textBaseline = "middle";
        monCtx.fillText(sc.stamp, w / 2, h / 2);
        monCtx.restore();
      }

      const sinceCut = t - sc.t0;
      if (sinceCut < .16) {
        monCtx.fillStyle = `rgba(0,0,0,${(1 - sinceCut / .16) * .85})`;
        monCtx.fillRect(0, 0, w, h);
      }
      monCtx.fillStyle = "rgba(2,4,8,.22)";
      monCtx.fillRect(0, 0, w, h);
      const mvg = monCtx.createRadialGradient(w / 2, h / 2, h * .25, w / 2, h / 2, h * .95);
      mvg.addColorStop(0, "rgba(0,0,0,0)");
      mvg.addColorStop(1, "rgba(0,0,0,.6)");
      monCtx.fillStyle = mvg;
      monCtx.fillRect(0, 0, w, h);

      const p1ratio = Math.min(1, t / P1_END);
      const p2p = t < P1_END ? 0 : easeOutCubic(Math.min(1, (t - P1_END) / (P2_END - P1_END)));
      const shakeAmp = (t < P1_END ? p1ratio : 1 - p2p) * 1.6 * DPR;
      const shx = Math.sin(t * 7.3) * shakeAmp, shy = Math.cos(t * 6.1) * shakeAmp;
      const zoom = 1 + p1ratio * .08;

      if (t < P1_END) {
        ctx.save();
        ctx.translate(w / 2 + shx, h / 2 + shy);
        ctx.scale(zoom, zoom);
        ctx.translate(-w / 2, -h / 2);
        ctx.drawImage(monCv, 0, 0);
        ctx.restore();
      } else {
        /* ---------- P2: slow cinematic pull-back ---------- */
        const mw100 = wordWidthAt100(maskCtx);
        const startSize = (w * 3.2) / mw100 * 100;
        const finalSize = Math.min((w * .74) / mw100 * 100, h * .42);
        const size = startSize + (finalSize - startSize) * p2p;

        maskCtx.clearRect(0, 0, w, h);
        maskCtx.fillStyle = "#fff";
        drawWordmark(maskCtx, size, "fill");

        compCtx.clearRect(0, 0, w, h);
        compCtx.save();
        compCtx.filter = `grayscale(${p2p * .8}) brightness(${1 - p2p * .35})`;
        compCtx.translate(w / 2 + shx * .3, h / 2 + shy * .3);
        compCtx.scale(zoom, zoom);
        compCtx.translate(-w / 2, -h / 2);
        compCtx.drawImage(monCv, 0, 0);
        compCtx.restore();
        compCtx.filter = "none";
        compCtx.globalCompositeOperation = "destination-in";
        compCtx.drawImage(maskCv, 0, 0);
        compCtx.globalCompositeOperation = "source-over";

        const rot = (1 - p2p) * .06;
        const camScale = 1 + (1 - p2p) * .05;
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rot);
        ctx.scale(camScale, camScale);
        ctx.translate(-w / 2, -h / 2 + (1 - p2p) * h * .03);

        ctx.globalAlpha = .35;
        ctx.drawImage(compCv, 0, -3 * DPR * (1 - p2p));
        ctx.globalAlpha = 1;
        ctx.drawImage(compCv, 0, 0);

        if (p2p > .45) {
          ctx.globalAlpha = (p2p - .45) / .55;
          ctx.strokeStyle = "rgba(168,212,242,.9)";
          ctx.lineWidth = 1.2 * DPR;
          drawWordmark(ctx, size, "stroke");
          ctx.globalAlpha = 1;
        }
        ctx.restore();

        const vg = ctx.createRadialGradient(w / 2, h / 2, h * .2, w / 2, h / 2, h * .85);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, `rgba(0,0,0,${.3 + p2p * .45})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, w, h);
      }
    }

    /* ---------- FLASH ---------- */
    if (t >= FLASH_T && t < FLASH_T + .7) {
      const f = 1 - (t - FLASH_T) / .7;
      if (!flashDone) { flashDone = true; spawnDust(); }
      ctx.fillStyle = `rgba(225,238,250,${f * f * .6})`;
      ctx.fillRect(0, 0, w, h);
    }

    /* ---------- P3: STEEL LOCKUP ---------- */
    if (t >= FLASH_T) {
      const p3 = Math.min(1, (t - FLASH_T) / .9);
      const mw100 = wordWidthAt100(ctx);
      const finalSize = Math.min((w * .74) / mw100 * 100, h * .42);

      const breathe = (Math.sin(t * .9) + 1) / 2;
      const ag = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * .7);
      ag.addColorStop(0, `rgba(94,200,255,${.05 + breathe * .02})`);
      ag.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = ag;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalAlpha = .12 * p3;
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 1 * DPR;
      ctx.beginPath();
      const pn = pulseLine.length;
      const scroll = (t - FLASH_T) * .06;
      for (let i = 0; i < pn; i++) {
        const x = (i / (pn - 1)) * w;
        const idx = (i + Math.floor(scroll * pn)) % pn;
        const y = h / 2 + pulseLine[idx] * h * .03;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      ctx.save();
      for (const e of dust) {
        e.x += e.vx * .016; e.y += e.vy * .016; e.life -= .0022;
        if (e.life <= 0) { e.x = rnd(0, 1); e.y = rnd(.6, .95); e.life = rnd(.4, 1); }
        const twinkle = (Math.sin(t * 2.4 + e.tw) + 1) / 2;
        ctx.globalAlpha = e.life * .4 * twinkle * p3;
        ctx.fillStyle = "#cfe8fa";
        ctx.beginPath();
        ctx.arc(e.x * w, e.y * h, e.sz * DPR, 0, 7);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = p3;
      const grad = ctx.createLinearGradient(0, h / 2 - finalSize * .5, 0, h / 2 + finalSize * .5);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(.42, "#c9d4de");
      grad.addColorStop(.55, "#8a97a5");
      grad.addColorStop(1, "#4c5763");
      ctx.fillStyle = grad;
      ctx.shadowColor = "rgba(120,200,255,.35)";
      ctx.shadowBlur = 50 * DPR * p3;
      drawWordmark(ctx, finalSize, "fill");
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(140,215,255,${.55 * p3})`;
      ctx.lineWidth = 1 * DPR;
      drawWordmark(ctx, finalSize, "stroke");
      ctx.restore();

      const sweepT = (t - FLASH_T - .4) / 1.3;
      if (sweepT > 0 && sweepT < 1) {
        maskCtx.clearRect(0, 0, w, h);
        maskCtx.fillStyle = "#fff";
        drawWordmark(maskCtx, finalSize, "fill");
        compCtx.clearRect(0, 0, w, h);
        const sx = (sweepT * 1.6 - .3) * w;
        const sg = compCtx.createLinearGradient(sx - w * .1, 0, sx + w * .1, 0);
        sg.addColorStop(0, "rgba(255,255,255,0)");
        sg.addColorStop(.5, "rgba(255,255,255,.9)");
        sg.addColorStop(1, "rgba(255,255,255,0)");
        compCtx.fillStyle = sg;
        compCtx.save();
        compCtx.translate(w / 2, h / 2); compCtx.rotate(-.35); compCtx.translate(-w / 2, -h / 2);
        compCtx.fillRect(0, 0, w, h);
        compCtx.restore();
        compCtx.globalCompositeOperation = "destination-in";
        compCtx.drawImage(maskCv, 0, 0);
        compCtx.globalCompositeOperation = "source-over";
        ctx.drawImage(compCv, 0, 0);
      }

      const tagP = Math.min(1, Math.max(0, (t - FLASH_T - .8) / 1));
      if (tagP > 0) {
        const e2 = easeOutCubic(tagP);
        ctx.save();
        ctx.globalAlpha = e2;
        const ry = h / 2 + finalSize * .6;
        const lw = Math.min(w * .32, finalSize * 2.4) * e2;
        const lg = ctx.createLinearGradient(w / 2 - lw / 2, 0, w / 2 + lw / 2, 0);
        lg.addColorStop(0, "rgba(94,200,255,0)");
        lg.addColorStop(.5, "rgba(94,200,255,.7)");
        lg.addColorStop(1, "rgba(94,200,255,0)");
        ctx.fillStyle = lg;
        ctx.fillRect(w / 2 - lw / 2, ry, lw, DPR);
        ctx.fillStyle = "rgba(220,232,242,.72)";
        ctx.font = `400 ${Math.max(11, finalSize * .065) | 0}px "Helvetica Neue",Arial,sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("I N T E L L I G E N T   T R A D I N G   R O O M", w / 2, ry + finalSize * .17);
        ctx.restore();
      }
    }

    /* ---------- letterbox bars ---------- */
    const barP = Math.min(1, t / .9);
    const barH = h * .075 * easeOutCubic(barP);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, barH);
    ctx.fillRect(0, h - barH, w, barH);

    /* ---------- film grain ---------- */
    if ((frame++ & 1) === 0) {
      ctx.save();
      ctx.globalAlpha = .3;
      const ox = Math.random() * 256 | 0, oy = Math.random() * 256 | 0;
      for (let y = -oy; y < h; y += 256)
        for (let x = -ox; x < w; x += 256)
          ctx.drawImage(grainTile, x, y);
      ctx.restore();
    }

    /* ---------- progress ---------- */
    const prog = Math.min(1, t / TOTAL);
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fillRect(0, h - 2 * DPR, w, 2 * DPR);
    ctx.fillStyle = t < FLASH_T ? "rgba(255,255,255,.65)" : CYAN;
    ctx.shadowColor = CYAN; ctx.shadowBlur = 6 * DPR;
    ctx.fillRect(0, h - 2 * DPR, w * prog, 2 * DPR);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(200,225,245,.5)";
    ctx.font = `400 ${10 * DPR}px Consolas,monospace`;
    ctx.textAlign = "right";
    ctx.fillText(String(Math.floor(prog * 100)).padStart(2, "0") + "%", w - 14 * DPR, h - 10 * DPR);

    /* fade in from black at the very start */
    if (t < .8) {
      ctx.fillStyle = `rgba(0,0,0,${1 - t / .8})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (prog >= 1 && !done) {
      done = true;
      onDone();
    }

    raf = requestAnimationFrame(loop);
  }

  raf = requestAnimationFrame(loop);

  return function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
