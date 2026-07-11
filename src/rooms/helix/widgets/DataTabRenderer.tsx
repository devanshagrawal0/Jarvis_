// src/rooms/helix/widgets/DataTabRenderer.tsx
// Wave 2-A-3: Data/Quant tab — data table, chart canvas, formula block, metrics grid.
// R6: No data fetching. Pure display component.

import React, { useRef, useEffect, useCallback } from "react";
import type { DataTabData } from "./types";
import { setupHiDPICanvas } from "./canvasUtils";

function DataTable({ rows }: { rows: unknown[][] }) {
  if (!rows.length) return null;
  const headers = rows[0] as string[];
  const body    = rows.slice(1);
  return (
    <div className="hxw-table-wrap">
      <table className="hxw-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{String(h)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {(row as unknown[]).map((cell, ci) => (
                <td key={ci}>{String(cell ?? "—")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ChartProps {
  chartType: string;
  metrics: { label: string; value: string | number }[];
}

function ChartCanvas({ chartType, metrics }: ChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const numMetrics = metrics.filter(m => typeof m.value === "number" || !isNaN(Number(m.value)));

  const draw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas || !numMetrics.length) return;
    const W = 480, H = 160;
    const ctx = setupHiDPICanvas(canvas, W, H);

    const values = numMetrics.map(m => Number(m.value));
    const labels = numMetrics.map(m => m.label);
    const max = Math.max(...values, 1);
    const pad = { t: 12, b: 36, l: 12, r: 12 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    if (chartType === "line" || chartType === "scatter") {
      const xStep = plotW / Math.max(values.length - 1, 1);
      const yOf   = (v: number) => pad.t + (1 - v / max) * plotH;
      const xOf   = (i: number) => pad.l + i * xStep;

      // Area fill
      const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
      grad.addColorStop(0, "rgba(74,158,255,0.22)");
      grad.addColorStop(1, "rgba(74,158,255,0)");
      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(values[0]));
      values.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
      ctx.lineTo(xOf(values.length - 1), H - pad.b);
      ctx.lineTo(pad.l, H - pad.b);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      values.forEach((v, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v)));
      ctx.strokeStyle = "#4a9eff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Dots
      values.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(xOf(i), yOf(v), 3, 0, Math.PI * 2);
        ctx.fillStyle = "#4a9eff";
        ctx.fill();
      });
    } else {
      // Bar chart
      const barW  = (plotW / values.length) * 0.65;
      const gap   = (plotW / values.length) * 0.35;
      values.forEach((v, i) => {
        const x  = pad.l + i * (barW + gap) + gap / 2;
        const bH = (v / max) * plotH;
        const y  = H - pad.b - bH;
        const grad = ctx.createLinearGradient(0, y, 0, H - pad.b);
        grad.addColorStop(0, "#4a9eff");
        grad.addColorStop(1, "rgba(74,158,255,0.3)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, bH, 3);
        ctx.fill();
      });
    }

    // Labels
    ctx.fillStyle = "rgba(140,175,220,0.6)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    numMetrics.forEach((m, i) => {
      const xOf = chartType === "bar"
        ? pad.l + i * (plotW / values.length) + plotW / values.length / 2
        : pad.l + i * (plotW / Math.max(values.length - 1, 1));
      const lbl = m.label.length > 8 ? m.label.slice(0, 7) + "…" : m.label;
      ctx.fillText(lbl, xOf, H - 6);
    });
  }, [chartType, numMetrics]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [draw]);

  if (!numMetrics.length) return null;
  return <canvas ref={ref} className="hxw-chart-canvas" />;
}

function MetricsGrid({ metrics }: { metrics: { label: string; value: string | number }[] }) {
  if (!metrics.length) return null;
  return (
    <div className="hxw-metrics-grid">
      {metrics.map((m, i) => (
        <div key={i} className="hxw-metric-cell">
          <span className="hxw-metric-val">{String(m.value)}</span>
          <span className="hxw-metric-lbl">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

interface Props { data: DataTabData | null }

export function DataTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No data available.</div>;
  return (
    <div className="hxw-data-tab">
      {data.datasetName && (
        <div className="hxw-dataset-name">◈ {data.datasetName}</div>
      )}
      {data.summary && <p className="hxw-data-summary">{data.summary}</p>}
      {data.formula && (
        <pre className="hxw-formula-block">{data.formula}</pre>
      )}
      <MetricsGrid metrics={data.metrics} />
      {data.chartType !== "none" && (
        <ChartCanvas chartType={data.chartType} metrics={data.metrics} />
      )}
      {data.tables.length > 0 && <DataTable rows={data.tables as unknown[][]} />}
    </div>
  );
}
