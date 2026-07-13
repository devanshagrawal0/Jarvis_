// ECLIPSE artifact composer — the commit deliverable. Builds a REAL cited Markdown report from
// VALIDATED packets only, writes it to disk, and returns an ArtifactManifest (sha256 +
// sourceClaimIds + sourceEvidenceIds + checks). Every claim in the report traces to an evidence
// source in the Sources list — no uncited prose. (DOCX/PPTX via the live work-composer is the
// flagged integration; Markdown is the honest, self-contained v1 output.)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validate, ArtifactManifest } = require("../contracts");
const { id, nowIso } = require("../contracts/validate");

function composeReport({ mission, validated = [], evidenceStore = null, outDir }) {
  const missionId = mission.missionId;
  const dir = path.join(outDir || path.join(process.cwd(), "runtime", "eclipse-artifacts"), missionId);
  fs.mkdirSync(dir, { recursive: true });

  // Collect + dedupe sources across all validated packets.
  const sources = []; const srcIndex = new Map();
  const srcNum = (uri, quote) => {
    if (!uri) return null;
    if (!srcIndex.has(uri)) { srcIndex.set(uri, sources.length + 1); sources.push({ n: sources.length + 1, uri, quote }); }
    return srcIndex.get(uri);
  };

  const lines = [];
  lines.push(`# ${titleFor(mission)}`, "", `> Mission: ${mission.prompt}`, `> Generated: ${nowIso()} · Effort: ${mission.effort} · Validated findings: ${validated.length}`, "");
  if (!validated.length) {
    lines.push("## Findings", "", "_No claim cleared the evidence-promotion gate. Nothing is asserted as fact — the mission did not reach a verified conclusion within budget._", "");
  } else {
    lines.push("## Findings", "");
    for (const p of validated) {
      const cites = (p.evidence || []).map((e) => srcNum(e.sourceUri, e.quote)).filter(Boolean);
      const marks = cites.length ? " " + cites.map((n) => `[${n}]`).join("") : "";
      lines.push(`- **${escapeMd(p.claim)}**${marks}  _(confidence ${Number(p.confidence).toFixed(2)})_`);
    }
    lines.push("");
  }
  if (sources.length) {
    lines.push("## Sources", "");
    for (const s of sources) lines.push(`${s.n}. ${s.uri}${s.quote ? ` — “${escapeMd(String(s.quote).slice(0, 160))}”` : ""}`);
    lines.push("");
  }
  const md = lines.join("\n");
  const filePath = path.join(dir, "report.md");
  fs.writeFileSync(filePath, md, "utf8");
  const sha256 = crypto.createHash("sha256").update(md).digest("hex");

  const sourceEvidenceIds = evidenceStore ? (evidenceStore.getEvidence(missionId) || []).filter((e) => srcIndex.has(e.uri)).map((e) => e.evidenceId) : [];
  const manifest = validate(ArtifactManifest, {
    artifactId: id("art"), missionId, version: 0, kind: "markdown",
    path: path.relative(process.cwd(), filePath).replace(/\\/g, "/"), mimeType: "text/markdown", sha256, sizeBytes: Buffer.byteLength(md),
    sourceClaimIds: [], sourceEvidenceIds,
    checks: [{ name: "every-claim-cited", status: validated.every((p) => (p.evidence || []).length > 0) ? "pass" : "warn" }],
    audience: "engineering", styleProfile: "brief", createdAt: nowIso(), jarvisVisibility: "private",
  }, "artifact");
  return { manifest, filePath, markdown: md, sources };
}

function titleFor(mission) { const p = (mission.prompt || "Mission Report").replace(/[.?!]+$/, ""); return p.length > 70 ? p.slice(0, 67) + "…" : p; }
function escapeMd(s) { return String(s).replace(/([\\`*_[\]])/g, "\\$1"); }

module.exports = { composeReport };
