// Captures the screenshots used by README.md.
//
// Rooms are persisted in `localStorage["jarvis.activeRoom"]` (JarvisUI.tsx:160-167), so each room
// is opened by writing that key and reloading rather than by racing the command-bar event — the
// boot animation makes event dispatch flaky. WebGL is forced through SwiftShader so the globe and
// the 3D surfaces actually render headless.
//
//   node scripts/capture-readme-shots.mjs [outDir]
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
page.on("pageerror", (e) => console.log("  PAGEERR:", e.message.slice(0, 110)));

const shot = async (name, note) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`  ${kb > 40 ? "✓" : "⚠"} ${name}.png (${kb} KB)${note ? ` — ${note}` : ""}`);
  return kb;
};

// Open a room by persisting it, then reloading into it.
const enterRoom = async (room, settleMs = 9000) => {
  await page.evaluate((r) => {
    if (r) localStorage.setItem("jarvis.activeRoom", r);
    else localStorage.removeItem("jarvis.activeRoom");
  }, room);
  await page.reload({ waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
};

// Report what actually rendered, so a blank shot is obvious rather than silently shipped.
const describe = async () => page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".tabs .tab, [role='tab']")].map((t) => t.textContent.trim()).filter(Boolean);
  return {
    textLen: document.body.innerText.length,
    canvases: document.querySelectorAll("canvas").length,
    tabs: tabs.slice(0, 20),
  };
});

console.log("→ landing (globe shell)");
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 });
await enterRoom(null, 11000);             // clear any saved room, land on the globe
console.log("  ", JSON.stringify(await describe()));
await shot("01-globe", "landing shell");

const rooms = [
  { key: "apex", name: "02-apex" },
  { key: "helix", name: "03-helix" },
  { key: "arbiter", name: "04-arbiter" },
];

for (const room of rooms) {
  console.log(`→ ${room.key}`);
  await enterRoom(room.key, 12000);
  const info = await describe();
  console.log("  ", JSON.stringify(info));
  await shot(room.name, `${info.tabs.length} tabs`);

  // Walk this room's tabs, capturing each distinct surface.
  for (const [i, tab] of info.tabs.slice(0, 6).entries()) {
    const ok = await page.evaluate((t) => {
      const el = [...document.querySelectorAll(".tabs .tab, [role='tab']")].find((x) => x.textContent.trim() === t);
      if (!el) return false;
      el.click();
      return true;
    }, tab);
    if (!ok) continue;
    await page.waitForTimeout(7000);      // charts/canvases need time to paint
    const slug = tab.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await shot(`${room.name}-${String(i + 1).padStart(2, "0")}-${slug}`, `tab: ${tab}`);
  }
}

await enterRoom(null, 3000);              // leave the app on the globe
await browser.close();

const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"));
console.log(`\nWrote ${files.length} screenshots to ${OUT}/`);
