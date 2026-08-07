// Does reading the page in ONE call actually work, and is it actually faster?
//
// A live send measured 71s and 27s for two looks at a conversation — the bulk of a four-minute
// message. The page was never slow; the code asked the browser about each element separately.
// This builds a page shaped like a busy messaging thread (a long list of rows, plus a composer and
// a send control) and reads it through the shipped snapshot path.
//
//   node scripts/measure-page-read.mjs [rowCount] [samples]

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");

const rows = Number(process.argv[2] || 1500);
const samples = Number(process.argv[3] || 3);

// Shaped like a real thread: many role="button" rows that tie with each other, a contenteditable
// composer, and an icon-only send control with no accessible name.
const html = `<!doctype html><meta charset="utf-8"><title>Thread</title><body>
<header>group name here 3 active today</header>
<div id="list">${Array.from({ length: rows }, (_, i) =>
  `<div role="button" tabindex="0"><span>Person ${i}</span><span>message body number ${i}</span></div>`
).join("")}</div>
<div role="textbox" contenteditable="true" aria-label="Message">
</div>
<button aria-label=""><svg width="16" height="16"></svg></button>
</body>`;

// Served over HTTP rather than written to disk: the browser service refuses file:// URLs on
// purpose, and that rule is worth more than the convenience of a local file.
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-page-read-"));
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-page-read-runtime-"));

// Forced hidden. `headless` defaults to FALSE unless JARVIS_BROWSER_HEADLESS=1, so a measurement
// script that simply asks for a browser opens a real window on the owner's screen — which is
// exactly what these did, repeatedly, one of them wedging its own tab in an infinite loop.
const service = createBrowserAutomationService({ runtimeDir, headless: true });
const taskId = "measure-page-read";

try {
  await service.navigate({ taskId, url: origin });

  const timings = [];
  let last = null;
  for (let i = 0; i < samples; i += 1) {
    const started = Date.now();
    last = await service.snapshot({ taskId, limit: 80 });
    timings.push(Date.now() - started);
    console.log(`read ${i + 1}: ${String(timings[i]).padStart(6)}ms   elements=${last.elements.length}   candidates=${last.elementCandidates}`);
  }

  // Correctness, not just speed. A fast read that lost the composer would be worse than a slow one.
  const problems = [];
  const refs = last.elements.map((e) => e.ref);
  if (refs.join(",") !== last.elements.map((_, i) => `e${i + 1}`).join(",")) problems.push("refs are not sequential in document order");
  if (!last.elements.some((e) => e.role === "textbox" || e.tag === "textarea")) problems.push("the composer was not found");
  if (!last.elements.some((e) => e.tag === "button")) problems.push("no button survived ranking");
  if (last.elementCandidates < rows) problems.push(`only ${last.elementCandidates} candidates seen, expected >= ${rows}`);
  if (!/3 active today/.test(last.headerText || "")) problems.push("conversation header missing — the recipient check reads this");
  if (!last.pageText) problems.push("page text missing");
  if (last.elements.length > 80) problems.push("element budget exceeded");

  const median = [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)];
  console.log(`\nrows=${rows}  median ${median}ms  min ${Math.min(...timings)}ms  max ${Math.max(...timings)}ms`);
  console.log(problems.length ? `PROBLEMS:\n  - ${problems.join("\n  - ")}` : "correctness: refs ordered, composer found, button found, header + text present");
} catch (error) {
  // `finally { process.exit(0) }` discarded the exception AND reported success — the script ran,
  // printed nothing, and exited 0. A measurement that cannot fail measures nothing.
  console.error("FAILED:", error?.stack || error);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  server.close();
}
