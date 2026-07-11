// src/rooms/helix/widgets/CodeTabRenderer.tsx
// Wave 2-A-2: Code tab — language badge, syntax block, steps, issues, improvements.
// R6: No data fetching. Pure display component.

import React from "react";
import type { CodeTabData } from "./types";

const LANG_KEYWORDS: Record<string, RegExp> = {
  typescript: /\b(const|let|var|function|class|interface|type|export|import|from|return|if|else|for|while|async|await|new|this|void|null|undefined|true|false|extends|implements|readonly|enum|namespace|declare)\b/g,
  javascript: /\b(const|let|var|function|class|export|import|from|return|if|else|for|while|async|await|new|this|null|undefined|true|false)\b/g,
  python:     /\b(def|class|import|from|return|if|elif|else|for|while|async|await|with|as|lambda|None|True|False|and|or|not|in|is|pass|break|continue|raise|try|except|finally)\b/g,
  rust:       /\b(fn|let|mut|pub|use|mod|struct|enum|impl|trait|return|if|else|for|while|async|await|match|Some|None|Ok|Err|true|false|self|Self|super|crate)\b/g,
  go:         /\b(func|var|const|type|struct|interface|package|import|return|if|else|for|range|switch|case|default|defer|go|chan|select|nil|true|false)\b/g,
  sql:        /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP BY|ORDER BY|HAVING|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|AS|AND|OR|NOT|IN|IS|NULL|DISTINCT|LIMIT|OFFSET)\b/gi,
};
const DEFAULT_KW = /\b(if|else|for|while|return|function|class|const|let|var|import|export|true|false|null)\b/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightCode(code: string, lang: string): string {
  const escaped = escapeHtml(code);
  const kw = LANG_KEYWORDS[lang.toLowerCase()] || DEFAULT_KW;
  // Reset lastIndex for global regexes
  kw.lastIndex = 0;
  return escaped.replace(kw, '<span class="hxw-kw">$&</span>');
}

function SyntaxBlock({ code, language }: { code: string; language: string }) {
  if (!code) {
    return <div className="hxw-no-code">No code block detected</div>;
  }
  const lines = code.split("\n");
  const highlighted = highlightCode(code, language);
  const hlLines = highlighted.split("\n");

  return (
    <div className="hxw-syntax-wrap">
      <div className="hxw-syntax-header">
        <span className="hxw-lang-badge">{language}</span>
        <span className="hxw-line-count">{lines.length} lines</span>
      </div>
      <div className="hxw-syntax-body">
        <div className="hxw-line-nums" aria-hidden>
          {lines.map((_, i) => <span key={i}>{i + 1}</span>)}
        </div>
        <pre
          className="hxw-code"
          dangerouslySetInnerHTML={{ __html: hlLines.join("\n") }}
        />
      </div>
    </div>
  );
}

function ItemList({ items, label, dotColor }: { items: string[]; label: string; dotColor: string }) {
  if (!items.length) return null;
  return (
    <div className="hxw-item-list">
      <div className="hxw-il-hdr">{label}</div>
      {items.map((item, i) => (
        <div key={i} className="hxw-il-row">
          <span className="hxw-il-dot" style={{ background: dotColor }} />
          <span className="hxw-il-text">{item}</span>
        </div>
      ))}
    </div>
  );
}

interface Props { data: CodeTabData | null }

export function CodeTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No code data available.</div>;
  return (
    <div className="hxw-code-tab">
      <div className="hxw-code-meta">
        <span className="hxw-lang-badge hxw-lang-badge--lg">{data.language || "unknown"}</span>
        <span className="hxw-prob-type">{data.problemType}</span>
      </div>
      <SyntaxBlock code={data.code} language={data.language} />
      <ItemList items={data.explanation} label="Steps" dotColor="#4a9eff" />
      <ItemList items={data.issues}      label="Issues" dotColor="#ff6b6b" />
      <ItemList items={data.improvements} label="Improvements" dotColor="#4aff9e" />
    </div>
  );
}
