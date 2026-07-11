// Debug screenshot of the standalone globe room page.
// Usage: node scripts/globe-room-shot.mjs [url] [outPath]
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5175/globe-room.html";
const out = process.argv[3] ?? "globe-room-shot.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const logs = [];
page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.screenshot({ path: out });

console.log("=== CONSOLE ===");
for (const line of logs) console.log(line);
console.log("=== SAVED ===", out);
await browser.close();
