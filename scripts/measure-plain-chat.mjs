// Is the slowness in the browser automation, or in Jarvis's talking brain?
// Two plain messages, no browser task involved. Run from inside the UI page so the session applies.
import { chromium } from "playwright";

const UI = process.env.JARVIS_UI || "http://localhost:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(UI, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const out = await page.evaluate(async () => {
  const rows = [];
  for (const message of ["hi", "what is 2+2", "hi"]) {
    const t = performance.now();
    let status = 0, timing = {};
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });
      status = r.status;
      const j = await r.json().catch(() => ({}));
      timing = j.timing || j.result?.timing || {};
    } catch (e) {
      status = -1;
      timing = { error: String(e.message || e) };
    }
    rows.push({ message, ms: Math.round(performance.now() - t), status, timing });
  }
  return rows;
});

for (const r of out) {
  console.log(
    `${JSON.stringify(r.message).padEnd(14)} ${String(r.ms).padStart(7)}ms  http ${r.status}` +
    `  model=${r.timing.modelMs ?? "?"}ms calls=${r.timing.totalModelCalls ?? "?"}` +
    ` fallbacks=${r.timing.fallbackAttempts ?? "?"} budget=${r.timing.budgetMs ?? "?"}`
  );
}
await browser.close();
