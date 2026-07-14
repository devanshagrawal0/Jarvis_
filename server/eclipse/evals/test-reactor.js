// P2·W8 Artifact Reactor test. Run: node server/eclipse/evals/test-reactor.js. Zero Gemini.
const assert = require("assert");
const { react, buildContentGraph, renderMarkdown, renderHTML, renderComposerSpec } = require("../artifact/reactor");

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

const mission = { missionId: "m1", prompt: "Compare A vs B and recommend one.", effort: "totality" };
const validated = [
  { claim: "A supports durable checkpoints", confidence: 0.9, evidence: [{ sourceUri: "https://a.dev/x", quote: "A persists checkpoints" }] },
  { claim: "B lacks native persistence", confidence: 0.7, evidence: [{ sourceUri: "https://b.dev/y", quote: "B has no built-in persistence" }] },
];
const synthesis = "Recommend A: it has durable checkpointing where B does not.";
const evidence = [{ evidenceId: "ev1" }, { evidenceId: "ev2" }];

console.log("ECLIPSE P2·W8 — Artifact Reactor");

ok("content graph: sections + numbered sources, every finding cited", () => {
  const g = buildContentGraph({ mission, validated, synthesis, evidence });
  assert.equal(g.title.length > 0, true);
  const headings = g.sections.map((s) => s.heading);
  assert.deepEqual(headings, ["Summary", "Findings"]);
  assert.equal(g.sources.length, 2);
  const findings = g.sections.find((s) => s.heading === "Findings").blocks;
  assert.ok(findings.every((b) => b.citations.length > 0), "every finding cited");
  assert.deepEqual(findings[0].citations, [1]);
});

ok("dedupes repeated source URIs across findings", () => {
  const g = buildContentGraph({ mission, validated: [
    { claim: "c1", confidence: 0.8, evidence: [{ sourceUri: "https://same", quote: "q" }] },
    { claim: "c2", confidence: 0.8, evidence: [{ sourceUri: "https://same", quote: "q" }] },
  ], synthesis: "" });
  assert.equal(g.sources.length, 1);
});

ok("markdown render has findings, citation markers, and sources", () => {
  const md = renderMarkdown(buildContentGraph({ mission, validated, synthesis, evidence }));
  assert.ok(md.includes("## Summary") && md.includes("## Findings") && md.includes("## Sources"));
  assert.ok(/\[1\]/.test(md) && /\[2\]/.test(md));
  assert.ok(md.includes("https://a.dev/x"));
});

ok("html render is escaped + links citations to sources", () => {
  const html = renderHTML(buildContentGraph({ mission: { ...mission, prompt: "A <b> & B" }, validated, synthesis, evidence }));
  assert.ok(html.includes("&lt;b&gt;") && html.includes("&amp;"), "escaped");
  assert.ok(html.includes('href="#s1"') && html.includes('id="s1"'), "citation anchors");
});

ok("composer spec is a neutral block list for DOCX/PPTX", () => {
  const spec = renderComposerSpec(buildContentGraph({ mission, validated, synthesis, evidence }), { format: "pptx" });
  assert.equal(spec.format, "pptx");
  const kinds = spec.blocks.map((b) => b.kind);
  assert.ok(kinds.includes("title") && kinds.includes("heading") && kinds.includes("bullet") && kinds.includes("sources"));
});

ok("react() bundles all formats + content-addressed hashes + honest manifest", () => {
  const r = react({ mission, validated, synthesis, evidence });
  assert.ok(r.markdown && r.html && r.composerSpec);
  assert.equal(r.hashes.markdown.length, 64);
  assert.equal(r.manifest.everyFindingCited, true);
  assert.equal(r.manifest.citedSources, 2);
  // determinism: same input → same hash
  const r2 = react({ mission, validated, synthesis, evidence });
  assert.equal(r.hashes.graph, r2.hashes.graph);
});

ok("honest empty case: no validated → no fabricated findings", () => {
  const g = buildContentGraph({ mission, validated: [], synthesis: "" });
  const findings = g.sections.find((s) => s.heading === "Findings").blocks;
  assert.equal(findings[0].type, "paragraph");
  assert.ok(/nothing is asserted/i.test(findings[0].text));
  assert.equal(g.sources.length, 0);
});

console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
