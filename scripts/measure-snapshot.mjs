// How long does one page observation actually take on the real messaging surface?
//
// Run timings showed 15-30s between "observed N controls" events, which is the dominant cost of a
// send — larger than the model, larger than page load. This measures `snapshot()` directly against
// a live thread so the number is observed rather than inferred.
//
//   node scripts/measure-snapshot.mjs "<thread-url>" [samples]
//
// Read-only: navigates and observes, clicks nothing, types nothing. Requires the backend stopped —
// both share the one browser profile.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const URL_ARG = process.argv[2];
const SAMPLES = Math.max(1, Math.min(Number(process.argv[3] || 3), 8));
if (!URL_ARG) { console.error('usage: node scripts/measure-snapshot.mjs "<thread-url>" [samples]'); process.exit(1); }

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });
const taskId = `snapmeasure-${Date.now()}`;

try {
  const navStarted = Date.now();
  await browser.navigate({ taskId, url: URL_ARG });
  console.log(`navigate: ${Date.now() - navStarted}ms`);
  await new Promise((r) => setTimeout(r, 6000)); // let the thread render before the first observation

  const times = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = Date.now();
    const snap = await browser.snapshot({ taskId, limit: 140 });
    const ms = Date.now() - started;
    times.push(ms);
    console.log(`snapshot ${i + 1}: ${String(ms).padStart(6)}ms   elements=${(snap.elements || []).length}   url=${String(snap.url || "").slice(0, 46)}`);
  }
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`\nmin ${sorted[0]}ms   median ${sorted[Math.floor(sorted.length / 2)]}ms   max ${sorted[sorted.length - 1]}ms`);
  console.log("Run timings showed 15000-30000ms per observation before this change.");
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => null);
}
