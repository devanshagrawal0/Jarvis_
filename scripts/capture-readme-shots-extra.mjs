// Second capture pass: the surfaces the first pass could not reach, because they sit behind
// in-room navigation rather than behind the room key itself.
//
//   node scripts/capture-readme-shots-extra.mjs [outDir]
//
// Requires the dev server on :5173 and the backend on :8799.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "docs/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("  PAGEERR:", e.message.slice(0, 100)));

const shot = async (name, note) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ${kb > 40 ? "OK " : "!! "} ${name}.png (${kb} KB)${note ? ` — ${note}` : ""}`);
};

const enterRoom = async (room, settleMs = 11000) => {
  await page.evaluate((r) => {
    if (r) localStorage.setItem("jarvis.activeRoom", r);
    else localStorage.removeItem("jarvis.activeRoom");
  }, room);
  await page.reload({ waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
};

// Click the first element whose trimmed text matches, across the selectors given.
const clickText = async (text, selectors = "button, [role='tab'], a, li, div[class*='nav'], div[class*='item']") =>
  page.evaluate(([t, sel]) => {
    const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === t);
    if (!el) return false;
    el.click();
    return true;
  }, [text, selectors]);

await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 });

// ── HELIX interior surfaces ────────────────────────────────────────────────
console.log("→ helix surfaces");
await enterRoom("helix");
for (const [label, slug, extraTab] of [
  ["Command Center", "05-helix-command", null],
  ["Evidence", "06-helix-evidence", null],
  ["Analyze", "07-helix-analyze", null],
]) {
  if (await clickText(label)) {
    await page.waitForTimeout(6000);
    await shot(slug, label);
  } else console.log(`  (nav "${label}" not found)`);
}

// Explore → Graph is the 3D knowledge graph; it lazy-loads, so give it longer.
if (await clickText("Explore")) {
  await page.waitForTimeout(4000);
  if (await clickText("Graph")) {
    await page.waitForTimeout(12000);
    await shot("08-helix-knowledge-graph", "3D force-directed graph");
  } else console.log("  (Graph tab not found)");
}

// ── A spatial widget open over the globe ───────────────────────────────────
console.log("→ widget over the globe");
await enterRoom(null, 9000);
const opened = await page.evaluate(() => {
  // The launcher is the grid button bottom-right; widgets also respond to this event.
  document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: "memory" } }));
  return true;
});
await page.waitForTimeout(5000);
if (opened) await shot("09-widget-memory", "spatial widget frame");

// ── Phone app (its own vite entry point) ───────────────────────────────────
console.log("→ phone app");
await page.setViewportSize({ width: 420, height: 900 });
await page.goto("http://localhost:5173/phone.html", { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(6000);
await shot("10-phone", "phone surface");

await browser.close();
console.log(`\n${fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length} screenshots total in ${OUT}/`);
