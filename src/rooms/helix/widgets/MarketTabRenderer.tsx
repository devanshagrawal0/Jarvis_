// src/rooms/helix/widgets/MarketTabRenderer.tsx
// Wave 2-A-2: Market tab — price strip, sparkline, tech chips, signal card, Kalshi book.
// R6: No data fetching. All data from tabData prop.

import React, { useRef, useEffect, useCallback } from "react";
import type { MarketTabData } from "./types";
import { setupHiDPICanvas } from "./canvasUtils";

const SIGNAL_COLOR: Record<string, string> = {
  BUY:  "#4aff9e",
  SELL: "#ff6b6b",
  HOLD: "#ffe14a",
  WAIT: "#94a3b8",
};

function PriceStrip({ d }: { d: NonNullable<MarketTabData["priceData"]> }) {
  const chg = d.change24h ?? 0;
  const up  = chg >= 0;
  return (
    <div className="hxw-price-strip">
      <span className="hxw-ps-symbol">{d.symbol}</span>
      <span className="hxw-ps-price">${typeof d.price === "number" ? d.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : d.price}</span>
      <span className="hxw-ps-chg" style={{ color: up ? "#4aff9e" : "#ff6b6b", background: up ? "rgba(74,255,158,0.10)" : "rgba(255,107,107,0.10)" }}>
        {up ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%
      </span>
      {d.note && <span className="hxw-ps-note">{d.note}</span>}
    </div>
  );
}

function Sparkline({ price, change24h }: { price: number; change24h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const W = 340, H = 72;
    const ctx = setupHiDPICanvas(canvas, W, H);

    // Simulate 30 candles using a simple random-walk anchored at price ± change
    const startPrice = price / (1 + change24h / 100);
    const pts: number[] = [];
    let cur = startPrice;
    for (let i = 0; i < 30; i++) {
      cur += (Math.sin(i * 0.7) * 0.003 + (i === 29 ? (price - cur) / (30 - i) : 0)) * cur;
      pts.push(cur);
    }
    pts[pts.length - 1] = price;

    const min = Math.min(...pts), max = Math.max(...pts);
    const range = max - min || 1;
    const pad = 8;
    const xStep = (W - pad * 2) / (pts.length - 1);
    const yOf = (v: number) => pad + ((max - v) / range) * (H - pad * 2);

    // Area fill
    ctx.beginPath();
    ctx.moveTo(pad, yOf(pts[0]));
    pts.forEach((v, i) => ctx.lineTo(pad + i * xStep, yOf(v)));
    ctx.lineTo(pad + (pts.length - 1) * xStep, H);
    ctx.lineTo(pad, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const up = change24h >= 0;
    grad.addColorStop(0, up ? "rgba(74,255,158,0.25)" : "rgba(255,107,107,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pad, yOf(pts[0]));
    pts.forEach((v, i) => ctx.lineTo(pad + i * xStep, yOf(v)));
    ctx.strokeStyle = up ? "#4aff9e" : "#ff6b6b";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Endpoint dot with glow
    const ex = pad + (pts.length - 1) * xStep;
    const ey = yOf(pts[pts.length - 1]);
    ctx.shadowColor = up ? "#4aff9e" : "#ff6b6b";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = up ? "#4aff9e" : "#ff6b6b";
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [price, change24h]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={ref} className="hxw-sparkline" />;
}

function TechChips({ d }: { d: NonNullable<MarketTabData["priceData"]> }) {
  const rsi = d.rsi;
  let rsiColor = "#ffe14a", rsiLabel = "RSI neutral";
  if (rsi !== undefined) {
    if (rsi < 30)      { rsiColor = "#4aff9e"; rsiLabel = `RSI ${rsi} oversold`; }
    else if (rsi > 70) { rsiColor = "#ff6b6b"; rsiLabel = `RSI ${rsi} overbought`; }
    else               { rsiLabel = `RSI ${rsi}`; }
  }

  const maPos = d.maPosition;
  const maColor = maPos === "above" ? "#4aff9e" : maPos === "below" ? "#ff6b6b" : "#94a3b8";

  return (
    <div className="hxw-tech-chips">
      {rsi !== undefined && (
        <span className="hxw-tech-chip" style={{ borderColor: rsiColor + "55", color: rsiColor }}>{rsiLabel}</span>
      )}
      {maPos && (
        <span className="hxw-tech-chip" style={{ borderColor: maColor + "55", color: maColor }}>MA {maPos}</span>
      )}
      {d.volume && (
        <span className="hxw-tech-chip" style={{ borderColor: "#94a3b844", color: "#94a3b8" }}>Vol {d.volume.toLocaleString()}</span>
      )}
    </div>
  );
}

function SignalCard({ signal, score, tickers }: { signal: string; score: number; tickers: string[] }) {
  const color = SIGNAL_COLOR[signal] ?? "#94a3b8";
  return (
    <div className="hxw-signal-card" style={{ borderColor: color + "44" }}>
      <div className="hxw-sc-top">
        <span className="hxw-sc-signal" style={{ color, textShadow: `0 0 8px ${color}88` }}>{signal}</span>
        {tickers.length > 0 && <span className="hxw-sc-tickers">{tickers.join(", ")}</span>}
      </div>
      <div className="hxw-sc-bar-wrap">
        <div className="hxw-sc-bar" style={{ width: `${score * 100}%`, background: color, boxShadow: `0 0 4px ${color}66` }} />
      </div>
      <div className="hxw-sc-pct" style={{ color }}>{Math.round(score * 100)}% conviction</div>
    </div>
  );
}

function KalshiBook({ d }: { d: NonNullable<MarketTabData["kalshiData"]> }) {
  return (
    <div className="hxw-kalshi-book">
      <div className="hxw-kb-hdr">Kalshi Book</div>
      <div className="hxw-kb-row">
        <span className="hxw-kb-yes">YES {(d.yes_ask * 100).toFixed(0)}¢</span>
        <span className="hxw-kb-vol">Vol {d.volume.toLocaleString()}</span>
        <span className="hxw-kb-no">NO {(d.no_ask * 100).toFixed(0)}¢</span>
      </div>
      <div className="hxw-kb-close">Closes {new Date(d.close_time).toLocaleDateString()}</div>
    </div>
  );
}

interface Props { data: MarketTabData | null }

export function MarketTabRenderer({ data }: Props) {
  if (!data) {
    return <div className="hxw-empty">No market data available.</div>;
  }
  return (
    <div className="hxw-market">
      {data.priceData
        ? <PriceStrip d={data.priceData} />
        : <div className="hxw-unavail">Price unavailable</div>
      }
      {data.priceData && (
        <Sparkline price={data.priceData.price} change24h={data.priceData.change24h} />
      )}
      {data.priceData && <TechChips d={data.priceData} />}
      <SignalCard signal={data.signal} score={data.signalScore} tickers={data.tickers} />
      {data.kalshiData && <KalshiBook d={data.kalshiData} />}
    </div>
  );
}
