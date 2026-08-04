// Captures the HELIX interior surfaces.
//
// HelixV2 reads its active surface from the URL hash as a query string (HelixV2.tsx:39-44,
// `#s=<surface>`) and the room itself from localStorage. Driving both directly is far more
// reliable than clicking sidebar items, which are icon+label composites whose textContent does
// not match the visible label.
//
//   node scripts/capture-helix-shots.mjs [outDir]

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
  console.log(`  ${kb > 60 ? "OK " : "!! "} ${name}.png (${kb} KB)${note ? ` — ${note}` : ""}`);
};

await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => localStorage.setItem("jarvis.activeRoom", "helix"));

const surfaces = [
  ["command", "05-helix-command", 9000, "Command Center — pipeline visualisation"],
  ["evidence", "06-helix-evidence", 8000, "Evidence"],
  ["analyze", "07-helix-analyze", 8000, "Analyze"],
  ["explore", "08-helix-explore", 8000, "Explore"],
];

for (const [key, name, wait, note] of surfaces) {
  console.log(`→ ${key}`);
  await page.goto(`http://localhost:5173/#s=${key}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(wait);
  const active = await page.evaluate(() => new URLSearchParams(location.hash.replace(/^#/, "")).get("s"));
  if (active !== key) console.log(`  (surface reads "${active}", expected "${key}")`);
  await shot(name, note);

  // Inside Explore, the Graph tab lazy-loads the 3D force-directed knowledge graph.
  if (key === "explore") {
    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll("button, [role='tab'], div, span")]
        .find((x) => x.textContent.trim() === "3D Graph" && x.children.length === 0);
      if (!el) return false;
      (el.closest("button, [role='tab'], div") || el).click();
      return true;
    });
    if (clicked) {
      await page.waitForTimeout(14000);   // WebGL scene + force simulation settling
      await shot("09-helix-knowledge-graph", "3D knowledge graph");
    } else {
      console.log("  (3D Graph tab not found)");
    }
  }
}

await browser.close();
console.log(`\n${fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length} screenshots in ${OUT}/`);
