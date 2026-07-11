/* APEX Home v3 — explain-everything tooltips + metric glossary.
   <Tip text="...">label</Tip> shows a floating hover card; <Info k="vix"/>
   renders a small ⓘ that explains a known metric from the glossary. */

import { useRef, useState } from "react";

export const GLOSSARY: Record<string, string> = {
  regime: "APEX's market-regime score (0–100): a composite of index momentum, VIX level, and market breadth. ≥66 risk-on, ≤34 risk-off.",
  fearGreed: "Fear & Greed: the same composite mapped to sentiment — high = greed (complacent), low = fear (stressed).",
  vix: "CBOE Volatility Index — the market's 30-day expected volatility ('fear gauge'). Under ~15 calm, over ~20 elevated, over ~30 fear.",
  breadth: "Market breadth — the share of US stocks advancing vs declining today. Above 50% = more names up than down.",
  momentum: "Average % change of the major indices (S&P, Nasdaq, Dow) so far today.",
  pe: "Price / Earnings — share price divided by earnings per share. Higher = pricier relative to profits.",
  eps: "Earnings Per Share — company profit allocated to each share.",
  beta: "Beta — sensitivity to the overall market. 1.0 moves with the market; >1 amplifies, <1 dampens.",
  divYield: "Dividend Yield — annual dividends as a % of the share price.",
  mktcap: "Market Capitalization — total value of a company's shares (price × shares outstanding).",
  adRatio: "Advance/Decline ratio — advancers divided by decliners. Above 1 = broad strength.",
  gap: "Gap — the % difference between today's open and yesterday's close.",
  range52: "52-week range — the lowest and highest price over the past year; the marker shows where price sits within it.",
  btcDom: "Bitcoin Dominance — Bitcoin's share of the total crypto market cap.",
  insider: "Insider transactions — buys/sells by company officers/directors, filed with the SEC (via Finnhub).",
  ivrv: "IV vs RV — implied (option-priced) volatility vs realized (actual) volatility; the spread is the volatility risk premium.",
  rank: "News rank — the engine's impact score combining recency, source corroboration, credibility, and mapped ticker/sector impact.",
};

export function Tip({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const show = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ x: r.left + r.width / 2, y: r.top }); };
  return (
    <span ref={ref} className={"ax-tip-anchor" + (className ? " " + className : "")} onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && <span className="ax-tip" style={{ left: pos.x, top: pos.y }}>{text}</span>}
    </span>
  );
}

export function Info({ k }: { k: string }) {
  const text = GLOSSARY[k];
  if (!text) return null;
  return <Tip text={text}><span className="ax-info">ⓘ</span></Tip>;
}
