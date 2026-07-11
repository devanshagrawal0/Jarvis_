// src/rooms/helix/widgets/GenericTabRenderer.tsx
// Wave 2-B-2: Generic fallback renderer for unknown/custom types.
// Renders structured sections from GenericTabData.sections[].
// R7: This is the ONLY catch-all renderer. Specific renderers never fall through to it.

import React from "react";
import type { GenericTabData, GenericSection } from "./types";

function TextSection({ section }: { section: GenericSection }) {
  return (
    <div className="hxw-gen-section">
      <div className="hxw-gen-sec-hdr">{section.title}</div>
      <p className="hxw-gen-text">{String(section.content)}</p>
    </div>
  );
}

function ListSection({ section }: { section: GenericSection }) {
  const items = Array.isArray(section.content) ? section.content as string[] : [String(section.content)];
  return (
    <div className="hxw-gen-section">
      <div className="hxw-gen-sec-hdr">{section.title}</div>
      <ul className="hxw-gen-list">
        {items.map((item, i) => (
          <li key={i} className="hxw-gen-list-item">{String(item)}</li>
        ))}
      </ul>
    </div>
  );
}

function MetricSection({ section }: { section: GenericSection }) {
  const items = Array.isArray(section.content) ? section.content : [];
  return (
    <div className="hxw-gen-section">
      <div className="hxw-gen-sec-hdr">{section.title}</div>
      <div className="hxw-metrics-grid">
        {(items as { label?: string; value?: unknown }[]).map((m, i) => (
          <div key={i} className="hxw-metric-cell">
            <span className="hxw-metric-val">{String(m?.value ?? "—")}</span>
            <span className="hxw-metric-lbl">{String(m?.label ?? "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuoteSection({ section }: { section: GenericSection }) {
  const quotes = Array.isArray(section.content) ? section.content as string[] : [String(section.content)];
  return (
    <div className="hxw-gen-section">
      <div className="hxw-gen-sec-hdr">{section.title}</div>
      <div className="hxw-quote-cards">
        {quotes.map((q, i) => (
          <blockquote key={i} className="hxw-quote-card">"{q}"</blockquote>
        ))}
      </div>
    </div>
  );
}

function TableSection({ section }: { section: GenericSection }) {
  const rows = Array.isArray(section.content) ? section.content as unknown[][] : [];
  if (!rows.length) return null;
  const headers = rows[0] as string[];
  const body    = rows.slice(1);
  return (
    <div className="hxw-gen-section">
      <div className="hxw-gen-sec-hdr">{section.title}</div>
      <div className="hxw-table-wrap">
        <table className="hxw-table">
          <thead><tr>{headers.map((h, i) => <th key={i}>{String(h)}</th>)}</tr></thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri}>{(row as unknown[]).map((cell, ci) => <td key={ci}>{String(cell ?? "—")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderSection(section: GenericSection, i: number) {
  switch (section.type) {
    case "text":   return <TextSection   key={i} section={section} />;
    case "list":   return <ListSection   key={i} section={section} />;
    case "metric": return <MetricSection key={i} section={section} />;
    case "quote":  return <QuoteSection  key={i} section={section} />;
    case "table":  return <TableSection  key={i} section={section} />;
    case "chart":  return <ListSection   key={i} section={section} />;  // degrade gracefully
    default:       return null;  // unknown section type — skip silently (R7)
  }
}

interface Props { data: GenericTabData | null }

export function GenericTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No data available.</div>;
  return (
    <div className="hxw-generic-tab">
      <div className="hxw-generic-hdr">
        <span className="hxw-generic-icon">{data.icon || "◆"}</span>
        <span className="hxw-generic-label">{data.label}</span>
      </div>
      {(!data.sections || data.sections.length === 0)
        ? <div className="hxw-empty">No sections generated.</div>
        : data.sections.map((s, i) => renderSection(s, i))
      }
    </div>
  );
}
