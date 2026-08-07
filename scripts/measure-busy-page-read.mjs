// Why is our read 376ms on a 6000-element test page but 48s on Instagram?
//
// Theory: Instagram keeps its own main thread busy (React re-renders, presence, animations), and
// our read runs an in-page function on that SAME thread, so it queues behind Instagram's work. The
// 4 seconds the owner saw is Instagram PAINTING; the main thread stays busy well after.
//
// This builds a page that simulates that condition — many animated/transformed nodes PLUS a
// requestAnimationFrame loop that forces layout every frame (like a framework reconciling) — and
// reads it through the shipped snapshot path. If it reproduces the slowness, the cause is
// main-thread contention and the fix is to make the read do less work on that thread. If it stays
// fast, the cause is elsewhere (iframes, innerText) and we look there instead. Either way: measured.
//
//   node scripts/measure-busy-page-read.mjs [rows] [busy(0|1)]

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");

const rows = Number(process.argv[2] || 3000);
const busy = process.argv[3] !== "0"; // default: busy main thread on

// Complex, animated rows + a composer + send button + header, like a real chat surface. The busy
// loop reads offsetHeight of a moving element every frame, forcing a layout each frame so the main
// thread never goes idle — the same pressure a re-rendering app puts on it.
const html = `<!doctype html><meta charset="utf-8"><title>Busy Thread</title>
<style>
  .row{transform:translateZ(0);will-change:transform;animation:pulse 2s infinite;filter:blur(0)}
  @keyframes pulse{0%{opacity:.9}50%{opacity:1}100%{opacity:.9}}
  .mover{position:fixed;top:0;left:0;width:10px;height:10px}
</style>
<body>
<header>group name here 3 active today</header>
<div id="mover" class="mover"></div>
<div id="list">${Array.from({ length: rows }, (_, i) =>
  `<div role="button" tabindex="0" class="row"><span>Person ${i}</span><span>message body number ${i} with some length to it</span><svg width="16" height="16"></svg></div>`
).join("")}</div>
<div role="textbox" contenteditable="true" aria-label="Message"></div>
<button aria-label=""><svg width="16" height="16"></svg></button>
<script>
  ${busy ? `
  const mover = document.getElementById('mover');
  let x = 0;
  function spin(){
    x = (x + 3) % 300;
    mover.style.transform = 'translateX(' + x + 'px)';
    // Force layout every frame the way a reconciling framework does — keeps the main thread hot.
    void document.getElementById('list').offsetHeight;
    for (const el of document.querySelectorAll('.row')) { void el.offsetTop; }
    requestAnimationFrame(spin);
  }
  requestAnimationFrame(spin);
  ` : ""}
</script>
</body>`;

const server = http.createServer((_r, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-busy-read-"));
const service = createBrowserAutomationService({ runtimeDir, headless: true });

try {
  await service.navigate({ taskId: "busy", url: origin, waitUntil: "commit" });
  await new Promise((r) => setTimeout(r, 1500)); // let the busy loop get going

  const samples = [];
  for (let i = 0; i < 3; i += 1) {
    const t = Date.now();
    const snap = await service.snapshot({ taskId: "busy", limit: 80 });
    samples.push(Date.now() - t);
    if (i === 0) console.log(`  (elements=${snap.elements.length}, candidates=${snap.elementCandidates})`);
  }
  console.log(`rows=${rows}  busy-main-thread=${busy}`);
  console.log(`read times: ${samples.map((s) => s + "ms").join(", ")}   median ${[...samples].sort((a, b) => a - b)[1]}ms`);
  console.log(busy
    ? "If these are seconds not milliseconds, main-thread contention is the cause."
    : "Baseline with an idle main thread for comparison.");
} catch (error) {
  console.error("FAILED:", error?.stack || error);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  server.close();
}
