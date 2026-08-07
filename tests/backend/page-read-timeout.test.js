"use strict";

// A live run hung for ten minutes and produced no output at all.
//
// Concentrating the whole page read into one `evaluate` made it 37x faster on the real Instagram
// page — 71,292ms to 1,919ms — and also made it total. `evaluate` has no timeout of its own and
// waits on the page's main thread, so a busy or dialog-blocked tab meant the read simply never came
// back. It held the exclusive browser lock the entire time, so nothing else could run either, and
// the run recorded not one line: no error, no failure, nothing to read afterwards.
//
// A read that cannot fail cannot be diagnosed. This pins that it is bounded, and that a blocked
// page produces an error rather than an empty page — reporting "no elements" would send the agent
// off looking for another way to do something it had already half done.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "server", "browser-service.js"), "utf8");
// Executable lines only — a commented-out timeout would otherwise satisfy every match below.
const CODE = SOURCE.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");

test("the page read is bounded", () => {
  assert.match(CODE, /const PAGE_READ_TIMEOUT_MS = [\d_]+;/, "the bound must exist");
  assert.match(CODE, /Promise\.race\(\[[\s\S]{0,600}readPageInOneShot[\s\S]{0,600}PAGE_READ_TIMEOUT_MS/,
    "the read itself must be raced against that bound, not merely declare one");
});

test("a blocked page raises an error rather than reporting an empty page", () => {
  assert.match(CODE, /reject\(browserError\(`Reading the page timed out/,
    "timing out must reject; resolving to null would be read as 'this page has nothing on it'");
});

test("the bound is long enough for a real page and short enough to notice", () => {
  const value = Number(/const PAGE_READ_TIMEOUT_MS = ([\d_]+);/.exec(CODE)[1].replace(/_/g, ""));
  assert.ok(value >= 5_000, `${value}ms would abort legitimate reads — a 1500-row page measures 179ms, but sites stall`);
  assert.ok(value <= 30_000, `${value}ms is long enough to look like the ten-minute hang this replaces`);
});

// The behaviour, not the wiring. A page whose main thread never yields is exactly the condition that
// hung the live run; `evaluate` on it cannot return, so only the bound can end it.
test("a page that never yields is abandoned, not waited on", { timeout: 120_000 }, async (t) => {
  const { createBrowserAutomationService } = require("../../server/browser-service");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    // Loads and settles normally, then wedges its own main thread a moment later — so navigation
    // succeeds and the READ is what cannot complete. That is the shape of the live hang.
    response.end('<!doctype html><body><button>hi</button><script>setTimeout(function(){for(;;){}},600)</script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-read-timeout-"));
  // Forced hidden. `headless` defaults to FALSE unless JARVIS_BROWSER_HEADLESS=1, so a test that
  // simply asks for a browser opens a real window on the owner's screen — which is what this one
  // did, while wedging its own tab in an infinite loop.
  const service = createBrowserAutomationService({ runtimeDir, headless: true });
  const taskId = "page-read-timeout";
  t.after(async () => {
    try { await service.close?.(); } catch { /* best effort */ }
    server.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  await service.navigate({ taskId, url: `http://127.0.0.1:${server.address().port}/` });
  await new Promise((resolve) => setTimeout(resolve, 1_200)); // let the page wedge itself

  const started = Date.now();
  const outcome = await service.snapshot({ taskId, limit: 10 }).then(() => null, (error) => error);
  const elapsed = Date.now() - started;

  // Before the bound existed this call never returned at all, so "it came back, as a failure, in
  // bounded time" is the whole assertion — and none of those three is free.
  //
  // Deliberately NOT asserting which failure. Wedging a thread this completely makes Playwright tear
  // the page down, so the message here is "target page has been closed" rather than the timeout's
  // own. Pinning the wording would be pinning an artefact of how hard this test wedges the page,
  // not the behaviour; the timeout's message and its placement are covered by the source assertions
  // above, which mutation-test cleanly. What must never come back is silence, or an empty page.
  assert.ok(outcome instanceof Error, `the read returned normally from a wedged page in ${elapsed}ms — an empty page reads as "nothing to do here"`);
  assert.ok(elapsed < 40_000, `took ${elapsed}ms — nothing bounded it`);
});
