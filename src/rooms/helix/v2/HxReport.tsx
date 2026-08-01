// HELIX structured-report renderer (Research Engine W5).
//
// WHY THIS EXISTS: W3 gave synthesis a real schema and W4 made the pipeline produce it, but
// the Ask surface still printed `result.answer` — a flattened string. Every table, every
// ranked list, every inference flag and every citation was computed server-side and then
// thrown away at the last step. This component is where that work becomes visible.
//
// Two hard rules, both inherited from the pipeline's honesty contract:
//   1. A section that draws a CONCLUSION is visually distinct from one that reports a
//      sourced fact. `inference` sections get a badge and a different border — analysis
//      must never be mistakable for evidence.
//   2. Degradation is shown, not hidden. If the architect failed or evidence was thin, the
//      report says so at the top instead of quietly looking complete.
import React from "react";
import { Donut, Radar } from "./hxCharts";
import type {
  HelixReport, ReportSection, ProseSection, TableSection, ChartSection,
  RankedSection, StepsSection, ComparisonSection,
} from "./helix-report-types";

/** Citation chips. Numbers resolve against the report's `sources` list. */
function Cites({ ids, onCite }: { ids?: number[]; onCite?: (n: number) => void }) {
  if (!ids?.length) return null;
  return (
    <div className="hxr-cites">
      {ids.slice(0, 12).map((n) => (
        <button key={n} className="hxr-cite" onClick={() => onCite?.(n)} title={`Jump to source E${n}`}>E{n}</button>
      ))}
      {ids.length > 12 && <span className="hxr-cite-more">+{ids.length - 12}</span>}
    </div>
  );
}

function SectionHead({ s }: { s: ReportSection }) {
  if (!s.heading) return null;
  return (
    <div className="hxr-sec-h">
      <h3 className="hxr-sec-t">{s.heading}</h3>
      {/* The inference badge is the honesty affordance: this is our reasoning, not a source. */}
      {s.inference && <span className="hxr-inf" title="This section is inference drawn from the evidence, not a directly sourced fact">Inference</span>}
      {s.confidence && <span className={"hxr-conf hxr-conf-" + s.confidence}>{s.confidence}</span>}
    </div>
  );
}

function Body({ s }: { s: ReportSection }) {
  switch (s.type) {
    case "summary":
    case "prose":
      return <p className="hxr-prose">{(s as ProseSection).text}</p>;

    case "table": {
      const t = s as TableSection;
      if (!t.rows?.length) return null;
      // Wide tables scroll inside their own container — the page never scrolls sideways.
      return (
        <div className="hxr-tablewrap">
          <table className="hxr-table">
            <thead><tr>{(t.columns || []).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={i}>{row.map((cell, j) => <td key={j}>{String(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "chart": {
      const c = s as ChartSection;
      if (!c.series?.length) return null;
      const max = Math.max(...c.series.map((x) => Math.abs(x.value)), 1);
      const total = c.series.reduce((a, x) => a + Math.abs(x.value), 0) || 1;

      // Reuse the room's existing SVG primitives where they fit — no new dependency.
      if (c.chart === "radar" && c.series.length >= 3) {
        return (
          <Radar axes={c.series.map((x) => x.label)}
                 series={[{ name: "value", color: "var(--v-accent)", values: c.series.map((x) => Math.abs(x.value) / max) }]} />
        );
      }
      if (c.chart === "donut") {
        // A donut communicates share-of-whole; pair each ring with its own label so the
        // reader never has to guess which slice a number belongs to.
        return (
          <div className="hxr-donuts">
            {c.series.slice(0, 5).map((x, i) => (
              <div className="hxr-donut" key={i}>
                <Donut value={Math.abs(x.value) / total} size={78} stroke={8}
                       label={`${Math.round((Math.abs(x.value) / total) * 100)}%`} sub={x.label} />
              </div>
            ))}
          </div>
        );
      }
      // Default: labelled horizontal bars. hxCharts has no multi-category bar primitive
      // (BarMini renders a single value), so this is the one shape the room was missing.
      // Zero-baselined and value-labelled — a bar chart that lies about its baseline is worse
      // than no chart.
      return (
        <div className="hxr-bars">
          {c.series.map((x, i) => (
            <div className="hxr-bar-row" key={i}>
              <span className="hxr-bar-l" title={x.label}>{x.label}</span>
              <span className="hxr-bar-track"><span className="hxr-bar-fill" style={{ width: `${Math.max(2, (Math.abs(x.value) / max) * 100)}%` }} /></span>
              <span className="hxr-bar-v">{x.value}</span>
            </div>
          ))}
        </div>
      );
    }

    case "steps": {
      const st = s as StepsSection;
      if (!st.items?.length) return null;
      return (
        <ol className="hxr-steps">
          {st.items.map((it, i) => (
            <li key={i}>
              <span className="hxr-step-n">{i + 1}</span>
              <div className="hxr-step-b">
                <div className="hxr-step-t">{it.text}</div>
                {it.detail && <div className="hxr-step-d">{it.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      );
    }

    case "comparison": {
      const cm = s as ComparisonSection;
      if (!cm.matrix?.length) return null;
      return (
        <div className="hxr-tablewrap">
          <table className="hxr-table">
            {/* No whitespace between these tags: a text node inside <tr> is invalid HTML and
                React warns about it at runtime. */}
            <thead><tr><th />{(cm.options || []).map((o, i) => <th key={i}>{o}</th>)}</tr></thead>
            <tbody>
              {cm.matrix.map((row, i) => (
                <tr key={i}>
                  <th scope="row" className="hxr-rowh">{cm.criteria?.[i] ?? ""}</th>
                  {row.map((cell, j) => <td key={j}>{String(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // ranked / risks / nextSteps / futureScope / openQuestions all share the list shape.
    default: {
      const r = s as RankedSection;
      if (!r.items?.length) return null;
      return (
        <ul className={"hxr-list" + (s.type === "risks" ? " hxr-list-risk" : "")}>
          {r.items.map((it, i) => (
            <li key={i}>
              <span className="hxr-li-t">{it.text}</span>
              {it.detail && <span className="hxr-li-d">{it.detail}</span>}
            </li>
          ))}
        </ul>
      );
    }
  }
}

/** Render the report as Markdown. Used by Copy-as-Markdown so a report can leave HELIX
 *  intact — including its citations, which is the whole point of citing them. */
export function reportToMarkdown(r: HelixReport): string {
  const out: string[] = [`# ${r.title}`, ""];
  if (r.meta?.degraded) out.push(`> **Partial result.** ${r.meta.degraded}`, "");
  if (r.tldr) out.push(r.tldr, "");
  for (const s of r.sections || []) {
    out.push(`## ${s.heading || s.type}${s.inference ? " _(inference)_" : ""}`, "");
    if (s.type === "summary" || s.type === "prose") out.push((s as ProseSection).text || "", "");
    else if (s.type === "table") {
      const t = s as TableSection;
      const cols = t.columns || [];
      out.push(`| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`);
      for (const row of t.rows || []) out.push(`| ${row.map((c) => String(c)).join(" | ")} |`);
      out.push("");
    } else if (s.type === "chart") {
      for (const p of (s as ChartSection).series || []) out.push(`- ${p.label}: ${p.value}`);
      out.push("");
    } else if (s.type === "comparison") {
      const c = s as ComparisonSection;
      out.push(`| | ${(c.options || []).join(" | ")} |`, `| --- | ${(c.options || []).map(() => "---").join(" | ")} |`);
      (c.matrix || []).forEach((row, i) => out.push(`| ${c.criteria?.[i] ?? ""} | ${row.join(" | ")} |`));
      out.push("");
    } else {
      const items = (s as RankedSection).items || [];
      const ordered = s.type === "steps";
      items.forEach((it, i) => out.push(`${ordered ? `${i + 1}.` : "-"} **${it.text}**${it.detail ? ` — ${it.detail}` : ""}`));
      out.push("");
    }
    if (s.citations?.length) out.push(`_Cited: ${s.citations.map((n) => `[E${n}]`).join(" ")}_`, "");
  }
  if (r.limitations?.length) {
    out.push("## What this report could not verify", "");
    for (const l of r.limitations) out.push(`- ${l}`);
    out.push("");
  }
  if (r.sources?.length) {
    out.push("## Sources", "");
    for (const s of r.sources) out.push(`${s.n}. ${s.title}${s.url ? ` — ${s.url}` : ""}${s.corroborations ? ` (+${s.corroborations} corroborating)` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

const slug = (s: string, i: number) => `hxr-s${i}-${(s || "section").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}`;

/** Does this section have anything to show? Mirrors the checks in Body(), so the TOC and the
 *  body can never disagree about which sections exist. */
function hasBody(s: ReportSection): boolean {
  switch (s.type) {
    case "summary": case "prose": return !!(s as ProseSection).text?.trim();
    case "table": return !!(s as TableSection).rows?.length;
    case "chart": return !!(s as ChartSection).series?.length;
    case "comparison": return !!(s as ComparisonSection).matrix?.length;
    default: return !!(s as RankedSection).items?.some((i) => i?.text?.trim());
  }
}

export function HxReport({ report, onCite }: { report: HelixReport; onCite?: (n: number) => void }) {
  const degraded = report.meta?.degraded;
  const [copied, setCopied] = React.useState(false);
  // Filter ONCE, here — the TOC and the body must agree about which sections exist, or the
  // TOC ends up linking to anchors that were never rendered.
  const sections = (report.sections || []).filter(hasBody);
  // The TOC earns its place only on a report long enough to need one.
  const showToc = sections.length >= 4;

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(reportToMarkdown(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the button simply doesn't confirm */ }
  };

  return (
    <article className="hxr">
      <header className="hxr-head">
        <div className="hxr-head-top">
          <h2 className="hxr-title">{report.title}</h2>
          <button className="hxr-copy" onClick={copyMd} title="Copy the whole report as Markdown, citations included">
            {copied ? "Copied ✓" : "Copy as Markdown"}
          </button>
        </div>
        <div className="hxr-meta">
          {report.meta?.evidenceCount != null && <span>{report.meta.evidenceCount} evidence</span>}
          {report.meta?.subquestions != null && <span>{report.meta.subquestions} sub-questions</span>}
          {report.meta?.rounds != null && <span>{report.meta.rounds} round{report.meta.rounds === 1 ? "" : "s"}</span>}
          {!!report.sources?.length && <span>{report.sources.length} sources</span>}
        </div>
      </header>

      {showToc && (
        <nav className="hxr-toc" aria-label="Report contents">
          {sections.map((s, i) => (
            <a className="hxr-toc-a" key={i} href={`#${slug(s.heading || s.type, i)}`}
               onClick={(e) => { e.preventDefault(); document.getElementById(slug(s.heading || s.type, i))?.scrollIntoView({ block: "start", behavior: "smooth" }); }}>
              {s.heading || s.type}
            </a>
          ))}
        </nav>
      )}

      {/* Never let a degraded run look like a complete one. */}
      {degraded && (
        <div className="hxr-degraded" role="status">
          <strong>Partial result.</strong> {degraded}
        </div>
      )}

      {report.tldr && <p className="hxr-tldr">{report.tldr}</p>}

      {/* `sections` is already filtered by hasBody — a heading with no content is dead chrome
          that reads as a loading failure. The server filters these too; this is the backstop
          for a malformed payload. */}
      {sections.map((s, i) => (
        <section className={"hxr-sec" + (s.inference ? " hxr-sec-inf" : "")} key={i} id={slug(s.heading || s.type, i)}>
          <SectionHead s={s} />
          <Body s={s} />
          <Cites ids={s.citations} onCite={onCite} />
        </section>
      ))}

      {/* W6: what verification found. A supported-claim ratio is only meaningful next to the
          claims that FAILED, so the flags sit in the same block as the number. */}
      {!!report.verification?.claimsChecked && (
        <section className="hxr-sec hxr-verify">
          <div className="hxr-sec-h">
            <h3 className="hxr-sec-t">Verification</h3>
            <span className="hxr-vscore">
              {report.verification.supported}/{report.verification.claimsChecked} claims supported
              {/* Never let a truncated sample read as full coverage. */}
              {report.verification.claimsAvailable && report.verification.claimsAvailable > report.verification.claimsChecked
                && ` (sample of ${report.verification.claimsAvailable})`}
            </span>
          </div>
          <div className="hxr-vbar" role="img"
               aria-label={`${report.verification.supported} supported, ${report.verification.unsupported} unsupported, ${report.verification.contradicted} contradicted`}>
            {(["supported", "unsupported", "contradicted"] as const).map((k) => {
              const n = report.verification![k];
              if (!n) return null;
              return <span key={k} className={"hxr-vseg hxr-v-" + k} style={{ flexGrow: n }} title={`${n} ${k}`} />;
            })}
          </div>
          {!!report.verification.coveChecked && (
            <p className="hxr-vnote">
              {report.verification.coveChecked} claim{report.verification.coveChecked === 1 ? "" : "s"} the evidence
              could not support {report.verification.coveChecked === 1 ? "was" : "were"} re-checked against a fresh search
              {/* Spell out the outcome — otherwise a confirmed claim just silently rejoins the
                  supported count and the second pass looks like it did nothing. */}
              {[
                report.verification.coveConfirmed ? `${report.verification.coveConfirmed} confirmed` : "",
                report.verification.coveRefuted ? `${report.verification.coveRefuted} refuted` : "",
                report.verification.coveUnverifiable ? `${report.verification.coveUnverifiable} still unverifiable` : "",
              ].filter(Boolean).join(", ") ? ` — ${[
                report.verification.coveConfirmed ? `${report.verification.coveConfirmed} confirmed` : "",
                report.verification.coveRefuted ? `${report.verification.coveRefuted} refuted` : "",
                report.verification.coveUnverifiable ? `${report.verification.coveUnverifiable} still unverifiable` : "",
              ].filter(Boolean).join(", ")}` : ""}.
            </p>
          )}
          {!!report.verification.flags.length && (
            <ul className="hxr-list hxr-list-risk">
              {report.verification.flags.map((f, i) => (
                <li key={i}>
                  <span className="hxr-li-t">{f.verdict === "contradicted" ? "Contradicted" : "Unsupported"}
                    {f.heading ? ` · ${f.heading}` : ""}</span>
                  <span className="hxr-li-d">{f.claim}{f.note ? ` — second-pass check found: ${f.note}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!!report.contradictions?.length && (
        <section className="hxr-sec hxr-verify">
          <div className="hxr-sec-h"><h3 className="hxr-sec-t">Sources disagree</h3></div>
          <ul className="hxr-list hxr-list-risk">
            {report.contradictions.map((c, i) => (
              <li key={i}>
                <span className="hxr-li-t">{c.values.join("  vs  ")}</span>
                <span className="hxr-li-d">{c.sample || c.topic}{c.sources.length ? ` — reported by ${c.sources.join(", ")}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!report.limitations?.length && (
        <section className="hxr-sec hxr-lim">
          <div className="hxr-sec-h"><h3 className="hxr-sec-t">What this report could not verify</h3></div>
          <ul className="hxr-list">{report.limitations.map((l, i) => <li key={i}><span className="hxr-li-t">{l}</span></li>)}</ul>
        </section>
      )}

      {!!report.sources?.length && (
        <section className="hxr-sec">
          <div className="hxr-sec-h"><h3 className="hxr-sec-t">Sources</h3></div>
          <ol className="hxr-srcs">
            {report.sources.map((s) => (
              <li key={s.n} id={`hxr-src-${s.n}`}>
                <span className="hxr-src-n">E{s.n}</span>
                {s.url
                  ? <a className="hxr-src-a" href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>
                  : <span className="hxr-src-a">{s.title}</span>}
                {!!s.corroborations && s.corroborations > 0 && (
                  <span className="hxr-src-c" title="Independent outlets carrying the same claim">+{s.corroborations} corroborating</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
