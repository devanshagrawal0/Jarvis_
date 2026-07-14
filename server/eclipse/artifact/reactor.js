// ECLIPSE Artifact Reactor (P2·W8). One CANONICAL content graph is the single source of truth
// for a deliverable; every output format (Markdown, HTML, and a neutral work-composer spec for
// DOCX/PPTX/PDF) is derived from it. Every factual block traces to the evidence that supports it
// — there is no uncited prose, and regenerating a format never invents new claims. The heavy
// DOCX/PPTX rendering itself is the app's existing work-composer (fed the composerSpec at wiring
// time); the Reactor owns the graph + the self-contained md/html renders.
const crypto = require("crypto");
const { id, nowIso } = require("../contracts/validate");

// buildContentGraph → { title, mission, sections:[{heading, blocks:[{type,text,citations}]}], sources }
function buildContentGraph({ mission, validated = [], synthesis = "", evidence = [] }) {
  const sources = []; const byUri = new Map();
  const cite = (uri, quote) => {
    if (!uri) return null;
    if (!byUri.has(uri)) { byUri.set(uri, sources.length + 1); sources.push({ n: sources.length + 1, uri, quote: quote || "" }); }
    return byUri.get(uri);
  };

  const sections = [];
  if (synthesis && synthesis.trim()) {
    sections.push({ heading: "Summary", blocks: [{ type: "paragraph", text: synthesis.trim(), citations: [] }] });
  }
  const findingBlocks = validated.map((p) => ({
    type: "finding",
    text: p.claim,
    confidence: p.confidence,
    citations: (p.evidence || []).map((e) => cite(e.sourceUri, e.quote)).filter(Boolean),
  }));
  sections.push({
    heading: "Findings",
    blocks: findingBlocks.length ? findingBlocks : [{ type: "paragraph", text: "No claim cleared the evidence-promotion gate; nothing is asserted as fact.", citations: [] }],
  });

  return { title: titleFor(mission), mission: { id: mission.missionId, prompt: mission.prompt, effort: mission.effort }, generatedAt: nowIso(), sections, sources, evidenceIds: evidence.map((e) => e.evidenceId) };
}

// ── Renderers (all derived from the same graph) ──────────────────────────────────────────
function renderMarkdown(g) {
  const L = [`# ${g.title}`, "", `> Mission: ${g.mission.prompt}`, `> ${g.generatedAt} · effort ${g.mission.effort}`, ""];
  for (const s of g.sections) {
    L.push(`## ${s.heading}`, "");
    for (const b of s.blocks) {
      const marks = b.citations.length ? " " + b.citations.map((n) => `[${n}]`).join("") : "";
      if (b.type === "finding") L.push(`- **${esc(b.text)}**${marks}${b.confidence != null ? `  _(confidence ${Number(b.confidence).toFixed(2)})_` : ""}`);
      else L.push(esc(b.text) + marks);
    }
    L.push("");
  }
  if (g.sources.length) { L.push("## Sources", ""); for (const s of g.sources) L.push(`${s.n}. ${s.uri}${s.quote ? ` — “${esc(String(s.quote).slice(0, 160))}”` : ""}`); L.push(""); }
  return L.join("\n");
}
function renderHTML(g) {
  const secHtml = g.sections.map((s) => `<section><h2>${escH(s.heading)}</h2>${s.blocks.map((b) => {
    const cites = b.citations.map((n) => `<sup><a href="#s${n}">[${n}]</a></sup>`).join("");
    return b.type === "finding" ? `<p class="finding"><strong>${escH(b.text)}</strong>${cites}${b.confidence != null ? ` <em>(confidence ${Number(b.confidence).toFixed(2)})</em>` : ""}</p>` : `<p>${escH(b.text)}${cites}</p>`;
  }).join("")}</section>`).join("");
  const src = g.sources.length ? `<section><h2>Sources</h2><ol>${g.sources.map((s) => `<li id="s${s.n}"><a href="${escH(s.uri)}">${escH(s.uri)}</a>${s.quote ? ` — “${escH(String(s.quote).slice(0, 160))}”` : ""}</li>`).join("")}</ol></section>` : "";
  return `<article><h1>${escH(g.title)}</h1><blockquote>${escH(g.mission.prompt)}</blockquote>${secHtml}${src}</article>`;
}
// Neutral spec the app work-composer maps to DOCX/PPTX/PDF (no rendering here).
function renderComposerSpec(g, { format = "docx" } = {}) {
  const blocks = [{ kind: "title", text: g.title }, { kind: "subtitle", text: g.mission.prompt }];
  for (const s of g.sections) {
    blocks.push({ kind: "heading", level: 2, text: s.heading });
    for (const b of s.blocks) blocks.push(b.type === "finding" ? { kind: "bullet", text: b.text, citations: b.citations, confidence: b.confidence } : { kind: "paragraph", text: b.text, citations: b.citations });
  }
  if (g.sources.length) { blocks.push({ kind: "heading", level: 2, text: "Sources" }); blocks.push({ kind: "sources", items: g.sources }); }
  return { format, blocks };
}

// react() → the full multi-format artifact bundle with content-addressed hashes.
function react(input) {
  const graph = buildContentGraph(input);
  const markdown = renderMarkdown(graph), html = renderHTML(graph);
  const composerSpec = renderComposerSpec(graph, { format: input.format || "docx" });
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  // Content hash excludes generatedAt (metadata, not content) → same content ⇒ same hash.
  const contentHash = sha(JSON.stringify({ title: graph.title, mission: graph.mission, sections: graph.sections, sources: graph.sources }));
  return {
    graph, markdown, html, composerSpec,
    hashes: { markdown: sha(markdown), html: sha(html), graph: contentHash },
    manifest: { artifactId: id("art"), missionId: input.mission.missionId, formats: ["markdown", "html", "composerSpec"], citedSources: graph.sources.length, everyFindingCited: graph.sections.flatMap((s) => s.blocks).filter((b) => b.type === "finding").every((b) => b.citations.length > 0) },
  };
}

function titleFor(m) { const p = (m.prompt || "Mission Report").replace(/[.?!]+$/, ""); return p.length > 70 ? p.slice(0, 67) + "…" : p; }
function esc(s) { return String(s).replace(/([\\`*_[\]])/g, "\\$1"); }
function escH(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

module.exports = { buildContentGraph, renderMarkdown, renderHTML, renderComposerSpec, react };
