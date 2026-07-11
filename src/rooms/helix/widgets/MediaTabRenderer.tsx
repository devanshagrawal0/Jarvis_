// src/rooms/helix/widgets/MediaTabRenderer.tsx
// Wave 2-B-1: Media tab — MediaHeader, OutlineList, QuoteCards, SentimentBar.
// R6: No data fetching. Pure display component.

import React from "react";
import type { MediaTabData } from "./types";

const MEDIA_ICONS: Record<string, string> = {
  article: "◈",
  book:    "📖",
  video:   "▶",
  podcast: "🎙",
  paper:   "🔬",
};

function MediaHeader({ title, mediaType }: { title: string; mediaType: string }) {
  return (
    <div className="hxw-media-header">
      <span className="hxw-mh-icon">{MEDIA_ICONS[mediaType] || "◈"}</span>
      <div className="hxw-mh-info">
        <div className="hxw-mh-type">{mediaType}</div>
        {title && <div className="hxw-mh-title">{title}</div>}
      </div>
    </div>
  );
}

function SentimentBar({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const config = {
    POSITIVE: { color: "#4aff9e", pct: 80, label: "Positive" },
    NEUTRAL:  { color: "#ffe14a", pct: 50, label: "Neutral" },
    NEGATIVE: { color: "#ff6b6b", pct: 20, label: "Negative" },
  }[sentiment] || { color: "#94a3b8", pct: 50, label: sentiment };
  return (
    <div className="hxw-sentiment-bar">
      <span className="hxw-sb-label">{config.label}</span>
      <div className="hxw-sb-track">
        <div className="hxw-sb-fill" style={{ width: `${config.pct}%`, background: config.color }} />
      </div>
    </div>
  );
}

interface Props { data: MediaTabData | null }

export function MediaTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No media data available.</div>;
  return (
    <div className="hxw-media-tab">
      <MediaHeader title={data.title} mediaType={data.mediaType} />
      {data.summary && <p className="hxw-media-summary">{data.summary}</p>}
      <SentimentBar sentiment={data.sentiment} />
      {data.outline.length > 0 && (
        <div className="hxw-outline-list">
          <div className="hxw-ol-hdr">Outline</div>
          {data.outline.map((item, i) => (
            <div key={i} className="hxw-ol-item">
              <span className="hxw-ol-num">{i + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
      {data.quotes.length > 0 && (
        <div className="hxw-quote-cards">
          <div className="hxw-qc-hdr">Key Quotes</div>
          {data.quotes.map((q, i) => (
            <blockquote key={i} className="hxw-quote-card">
              "{q}"
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}
