// RESEARCH_LOG.md writer (scout blueprint §6) — one auditable log per scout per mission.
// Path: runtime/eclipse-artifacts/{missionId}/scouts/{scoutId}.md
const fs = require("fs");
const path = require("path");

function writeScoutLog({ artifactsDir, missionId, trace, claims }) {
  if (!artifactsDir) return null;
  const dir = path.join(artifactsDir, missionId, "scouts");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${trace.scoutId}.md`);
  const b = trace.brief;
  const md = [
    `# Scout log — ${trace.scoutId} · ${b.angle || "(no angle)"}`,
    `mission: ${missionId} · spent: ${trace.spent.searches} searches / ${trace.spent.reads} reads`,
    ``,
    `## Brief`,
    `objective: ${b.objective}`,
    `owns: ${(b.reqIds || []).join(", ") || "-"}`,
    `boundary: ${(b.boundary || []).join(" ; ") || "-"}`,
    ``,
    `## Knowledge check`,
    trace.kbHits.length ? trace.kbHits.map((k) => `- reused (support ${k.support}): ${k.text}`).join("\n") : `- no settled facts reused`,
    ``,
    `## Question queue (initial)`,
    trace.queue.map((q, i) => `${i + 1}. ${q}`).join("\n") || "-",
    ``,
    `## Searches`,
    `| query | results | kind |`,
    `|---|---|---|`,
    trace.searches.map((s) => `| ${s.q.slice(0, 90)} | ${s.results}${s.error ? " (err)" : ""} | ${s.counter ? "counter" : s.gap ? "gap" : "sweep"} |`).join("\n") || "| - | - | - |",
    ``,
    `## Reads`,
    `| url | class | date | claims |`,
    `|---|---|---|---|`,
    trace.reads.map((r) => `| ${r.url.slice(0, 80)} | ${r.class || "?"} | ${r.date || "-"} | ${r.error ? "ERR: " + r.error : r.claims} |`).join("\n") || "| - | - | - | - |",
    ``,
    `## Skipped`,
    trace.skipped.map((s) => `- ${s.what} "${String(s.value).slice(0, 80)}" — ${s.why}`).join("\n") || `- nothing skipped`,
    ``,
    `## Claim-candidates`,
    claims.map((c, i) => `${i + 1}. ${c.text}\n   > "${c.quote.slice(0, 200)}"\n   — ${c.sourceUri} · ${c.sourceClass} · ${c.pubDate || "undated"} · independent-sources: ${c.sourcesIndependent || 1}${c.singleSource ? " · SINGLE-SOURCE" : ""}`).join("\n") || "(none)",
    ``,
    `## Conflicts`,
    trace.conflicts.map((c) => `- "${c.a}" vs ${c.b}`).join("\n") || `- none detected (contradiction pass ran: ${trace.searches.some((s) => s.counter) ? "yes" : "no"})`,
    ``,
    `## NOT FOUND`,
    trace.notFound.map((n) => `- ${n}`).join("\n") || `- (nothing explicitly unfindable)`,
    ``,
    `## Self-check`,
    trace.selfCheck
      ? `covered: ${(trace.selfCheck.covered || []).join(" | ") || "-"}\nweak: ${(trace.selfCheck.weak || []).join(" | ") || "-"}\nmissing: ${(trace.selfCheck.missing || []).join(" | ") || "-"}`
      : `(self-check unavailable)`,
    ``,
  ].join("\n");
  fs.writeFileSync(p, md, "utf8");
  return p;
}

module.exports = { writeScoutLog };
