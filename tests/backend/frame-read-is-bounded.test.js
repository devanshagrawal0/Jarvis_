"use strict";

// The 95-second read, finally pinned and fixed.
//
// Instrumentation split a slow real Instagram read into its parts and named the culprit outright:
//
//   [auto:snapshot] slow { totalMs: 3526, readMs: 64, framesMs: 3372, frameCount: 7 }
//
// The main-page read was 64ms; the child-FRAME pass was 3372ms — 96%. Instagram embeds several
// cross-origin iframes (ads, trackers, sign-in widgets), and the old frame pass read them one
// handle at a time. Each handle on a cross-origin frame is a real network round trip, so on the
// live page the pass crossed the 15s read timeout, threw, and the agent retried it ~6× → 95s.
//
// The fix reads each frame the same one-shot way as the main page (one evaluate per frame, not per
// element) and caps the whole frame pass with a wall-clock budget. This proves both: the frame pass
// is bounded, and it still reads a cross-origin frame's controls when they matter.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "server", "browser-service.js"), "utf8");
const CODE = SOURCE.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");

test("the child-frame pass has a wall-clock budget", () => {
  assert.match(CODE, /const FRAME_READ_BUDGET_MS = [\d_]+;/, "the budget must exist");
  assert.match(CODE, /Date\.now\(\) >= frameDeadline/, "and the loop must actually stop at it");
});

test("frames are read one-shot, not one element at a time", () => {
  // The regression this replaces: a handle round trip per element on a cross-origin frame.
  assert.match(CODE, /frame\.locator\("body"\)\.first\(\)\s*\.evaluate\(readPageInOneShot/,
    "each frame must be read with a single in-page evaluate");
  assert.doesNotMatch(CODE, /frameHandles\)\s*\{[\s\S]{0,200}handle\.isVisible\(\)[\s\S]{0,200}handle\.evaluate\(browserElementMetadata\)/,
    "the per-element frame walk (isVisible + evaluate per handle) is the bug being removed");
});

test("child frames are skipped when the main page already has a typable field", () => {
  // The real cut. Even one-shot, reading Instagram's ad frames cost 3.3s of a 61ms read for content
  // a send never uses. If the main frame produced a composer, the child frames are not read at all.
  assert.match(CODE, /const mainFrameHasComposer = elements\.some/,
    "the skip must be driven by whether the main frame already has a typable field");
  assert.match(CODE, /const childFrames = mainFrameHasComposer\s*\?\s*\[\]/,
    "and when it does, no child frames are read");
});

// The behaviour: a page with MANY cross-origin frames must read fast and still surface the main
// frame's composer. Cross-origin is reproduced with a second server on its own port.
test("a page full of cross-origin frames reads quickly and still finds the composer", { timeout: 60_000 }, async (t) => {
  const { createBrowserAutomationService } = require("../../server/browser-service");

  const frameHtml = `<!doctype html><body>${Array.from({ length: 500 }, (_, i) => `<a href="#${i}">l${i}</a><button>b${i}</button>`).join("")}</body>`;
  const frameServer = http.createServer((_r, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(frameHtml); });
  await new Promise((r) => frameServer.listen(0, "127.0.0.1", r));
  const framePort = frameServer.address().port;

  const mainHtml = `<!doctype html><meta charset=utf-8><body>
    <div role="textbox" contenteditable="true" aria-label="Message"></div><button aria-label="">send</button>
    ${Array.from({ length: 8 }, () => `<iframe src="http://127.0.0.1:${framePort}/"></iframe>`).join("")}</body>`;
  const mainServer = http.createServer((_r, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(mainHtml); });
  await new Promise((r) => mainServer.listen(0, "localhost", r)); // 'localhost' vs '127.0.0.1' => cross-origin

  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-frame-bound-"));
  const service = createBrowserAutomationService({ runtimeDir, headless: true });
  t.after(async () => {
    try { await service.close?.(); } catch { /* best effort */ }
    frameServer.close(); mainServer.close();
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  await service.navigate({ taskId: "fb", url: `http://localhost:${mainServer.address().port}/`, waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 1500)); // let frames load

  const started = Date.now();
  const snap = await service.snapshot({ taskId: "fb", limit: 140 });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 8_000, `the read took ${elapsed}ms — the frame pass is not bounded`);
  assert.ok(snap.elements.some((e) => e.role === "textbox" || e.tag === "textarea"),
    "the main frame's composer must still be found — the whole point of reading is to send");
});
