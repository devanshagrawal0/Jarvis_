// Read-only. Opens an already-authenticated page in the JARVIS profile and prints what the
// snapshot actually contains, so composer detection stops being guesswork against a test fixture.
//
//   node scripts/inspect-composer.mjs <url>
//
// It navigates and observes. It never types, clicks, or submits anything.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2];
if (!url) { console.error("usage: node scripts/inspect-composer.mjs <url>"); process.exit(1); }

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const { isComposerLabel } = await import("../server/universal-browser-agent.js");

const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });

try {
  await browser.navigate({ url, taskId: "inspect" });
  await browser.wait({ taskId: "inspect", milliseconds: 3500 });
  const snap = await browser.snapshot({ taskId: "inspect", limit: 240 });

  console.log(`url        : ${snap.url}`);
  console.log(`title      : ${snap.title}`);
  console.log(`elements   : ${snap.elements?.length} kept of ${snap.elementCandidates} candidates, truncated=${snap.truncated}\n`);

  const typables = (snap.elements || []).filter((e) => {
    const role = String(e.role || "").toLowerCase();
    const tag = String(e.tag || "").toLowerCase();
    return role === "textbox" || role === "searchbox" || role === "combobox" || tag === "input" || tag === "textarea" || e.contentEditable != null;
  });

  console.log(`TYPABLE ELEMENTS (${typables.length}) — this is what the composer must be found among:`);
  for (const e of typables) {
    const label = [e.name, e.placeholder, e.ariaLabel, e.title].filter(Boolean).join(" | ");
    console.log(`  ${e.ref.padEnd(6)} tag=${String(e.tag).padEnd(9)} role=${String(e.role || "-").padEnd(10)} composerLabel=${isComposerLabel(label) ? "YES" : "no "}`);
    console.log(`         labels: ${JSON.stringify(label).slice(0, 200)}`);
    console.log(`         text  : ${JSON.stringify(String(e.text || "").slice(0, 90))}`);
  }

  console.log(`\nCONTROLS NEAR THE BOTTOM (last 18 in document order):`);
  for (const e of (snap.elements || []).slice(-18)) {
    const label = [e.name, e.text, e.ariaLabel, e.placeholder].filter(Boolean).join(" ").replace(/\s+/g, " ");
    console.log(`  ${e.ref.padEnd(6)} ${String(e.tag).padEnd(9)} ${String(e.role || "-").padEnd(10)} ${JSON.stringify(label).slice(0, 110)}`);
  }

  const dump = path.join(RUNTIME_DIR, "composer-inspection.json");
  fs.writeFileSync(dump, JSON.stringify({ url: snap.url, title: snap.title, truncated: snap.truncated, elementCandidates: snap.elementCandidates, elements: snap.elements }, null, 2));
  console.log(`\nfull snapshot written to ${path.relative(ROOT, dump)}`);
} finally {
  await browser.close().catch(() => null);
}
