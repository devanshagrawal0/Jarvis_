// src/rooms/helix/widgets/PeopleTabRenderer.tsx
// Wave 2-B-1: People tab — EntityCard, FactList, RelatedChips.
// R6: No data fetching. Pure display component.

import React from "react";
import type { PeopleTabData } from "./types";

function EntityCard({ name, org }: { name: string | null; org: string | null }) {
  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  return (
    <div className="hxw-entity-card">
      <div className="hxw-ec-avatar">{initial}</div>
      <div className="hxw-ec-info">
        {name && <div className="hxw-ec-name">{name}</div>}
        {org  && <div className="hxw-ec-org">{org}</div>}
      </div>
    </div>
  );
}

// Extract potential entity names from facts (simple heuristic: capitalized multi-word phrases)
function extractRelated(facts: string[]): string[] {
  const seen = new Set<string>();
  const related: string[] = [];
  facts.forEach(f => {
    const matches = f.match(/[A-Z][a-z]+(?: [A-Z][a-z]+)+/g) || [];
    matches.forEach(m => {
      if (!seen.has(m) && m.length > 4) { seen.add(m); related.push(m); }
    });
  });
  return related.slice(0, 6);
}

interface Props { data: PeopleTabData | null }

export function PeopleTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No people data available.</div>;

  const related = extractRelated(data.facts);

  return (
    <div className="hxw-people-tab">
      {(data.name || data.org) && <EntityCard name={data.name} org={data.org} />}
      {data.summary && <p className="hxw-people-summary">{data.summary}</p>}
      {data.facts.length > 0 && (
        <div className="hxw-fact-list">
          <div className="hxw-fl-hdr">Key Facts</div>
          {data.facts.map((f, i) => (
            <div key={i} className="hxw-fl-item">
              <span className="hxw-fl-bullet">•</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}
      {related.length > 0 && (
        <div className="hxw-related-chips">
          <div className="hxw-rc-hdr">Related</div>
          <div className="hxw-rc-row">
            {related.map((r, i) => (
              <span key={i} className="hxw-chip hxw-chip--related">{r}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
