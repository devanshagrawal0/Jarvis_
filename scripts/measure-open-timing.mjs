// Two questions, measured, no live message sent:
//   1. Is the browser actually kept warm — does opening a second page skip the launch cost?
//   2. Does a faster "stop waiting" setting open a heavy page any quicker?
//
// Uses the real browser service, headless, against a heavy public single-page app so the numbers
// reflect the code we ship rather than a toy page.

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");

const HEAVY = "https://www.instagram.com/"; // a heavy JS app; logged out, no account touched
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-open-timing-"));
const service = createBrowserAutomationService({ runtimeDir, headless: true });

const ms = () => Number(process.hrtime.bigint() / 1000000n);

try {
  // Q1 — launch cost is paid once, not per message.
  let t = ms();
  await service.navigate({ taskId: "msg-1", url: HEAVY, waitUntil: "domcontentloaded" });
  const firstOpen = ms() - t; // includes the one-time browser launch

  t = ms();
  await service.navigate({ taskId: "msg-2", url: HEAVY, waitUntil: "domcontentloaded" });
  const secondOpen = ms() - t; // browser already warm — should be much less

  console.log("Q1  keeping the browser open");
  console.log(`    first message (cold, includes launch): ${firstOpen} ms`);
  console.log(`    second message (warm):                 ${secondOpen} ms`);
  console.log(`    launch cost paid once, saved per later message: ~${Math.max(0, firstOpen - secondOpen)} ms\n`);

  // Q2 — does a faster wait setting open the page quicker? Same URL, warm browser, three settings,
  // three samples each, report the minimum (the uncontended floor).
  console.log("Q2  how long to open the page, by wait setting");
  for (const waitUntil of ["load", "domcontentloaded", "commit"]) {
    const samples = [];
    for (let i = 0; i < 3; i += 1) {
      t = ms();
      await service.navigate({ taskId: `probe-${waitUntil}-${i}`, url: HEAVY, waitUntil });
      samples.push(ms() - t);
    }
    const min = Math.min(...samples);
    const label = waitUntil === "load" ? "wait for everything (slowest)"
      : waitUntil === "domcontentloaded" ? "wait for structure (CURRENT)"
      : "start as soon as it responds (fastest)";
    console.log(`    ${waitUntil.padEnd(16)} ${String(min).padStart(6)} ms   ${label}`);
  }
} catch (error) {
  console.error("FAILED:", error?.stack || error);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
