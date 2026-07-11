// src/rooms/helix/widgets/ComparisonTabRenderer.tsx
// Wave 2-B-1: Comparison tab — CompareTable, WinnerBadge.
// R6: No data fetching. Pure display component.

import React from "react";
import type { ComparisonTabData, ComparisonRow } from "./types";

function WinnerBadge({ winner, itemA, itemB }: { winner: string | null; itemA: string | null; itemB: string | null }) {
  if (!winner) return null;
  return (
    <div className="hxw-winner-badge">
      <span className="hxw-wb-icon">⊞</span>
      <span className="hxw-wb-label">Recommendation:</span>
      <span className="hxw-wb-text">{winner}</span>
    </div>
  );
}

function CellValue({ value }: { value: string | undefined | null }) {
  if (!value || value === "undefined" || value === "null") {
    return <span className="hxw-ct-dash">—</span>;
  }
  return <>{value}</>;
}

function scoreColor(value: string): string {
  if (!value) return "transparent";
  const lower = value.toLowerCase();
  if (/\b(yes|high|good|great|excellent|fast|better|best|more|strong|✓|true)\b/.test(lower)) return "rgba(74,255,158,0.12)";
  if (/\b(no|low|bad|poor|slow|worse|worst|less|weak|✗|false)\b/.test(lower))               return "rgba(255,107,107,0.12)";
  return "transparent";
}

function CompareTable({ rows, itemA, itemB }: { rows: ComparisonRow[]; itemA: string | null; itemB: string | null }) {
  if (!rows.length) return <div className="hxw-empty">No comparison attributes found.</div>;
  return (
    <div className="hxw-table-wrap">
      <table className="hxw-compare-table">
        <thead>
          <tr>
            <th className="hxw-ct-attr">Attribute</th>
            <th className="hxw-ct-val">{itemA || "Option A"}</th>
            <th className="hxw-ct-val">{itemB || "Option B"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="hxw-ct-attr-cell">{row.attribute || "—"}</td>
              <td className="hxw-ct-val-cell" style={{ background: scoreColor(row.valueA) }}>
                <CellValue value={row.valueA} />
              </td>
              <td className="hxw-ct-val-cell" style={{ background: scoreColor(row.valueB) }}>
                <CellValue value={row.valueB} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Props { data: ComparisonTabData | null }

export function ComparisonTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No comparison data available.</div>;
  return (
    <div className="hxw-comparison-tab">
      <WinnerBadge winner={data.winner} itemA={data.itemA} itemB={data.itemB} />
      <CompareTable rows={data.attributes} itemA={data.itemA} itemB={data.itemB} />
    </div>
  );
}
