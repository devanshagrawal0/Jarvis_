import { chromium } from "playwright";
const OUT = process.argv[2] || "bt.png";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1728, height: 980 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 200)); });

// retry goto until vite serves
for (let i = 0; i < 20; i++) { try { await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded", timeout: 8000 }); break; } catch { await page.waitForTimeout(1500); } }
await page.waitForTimeout(2500);
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: "open apex" } })));
  try { await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("Backtesting")), { timeout: 8000 }); break; } catch {}
}
await page.waitForTimeout(1000);
await page.evaluate(() => { const t = [...document.querySelectorAll(".tabs .tab")].find((x) => x.textContent.trim() === "Backtesting"); if (t) t.click(); });
await page.waitForFunction(() => !!document.querySelector(".ax-bte"), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
console.log("shell present:", await page.evaluate(() => !!document.querySelector(".ax-bte")));
// click Run Backtest
await page.evaluate(() => { const r = document.querySelector(".bte-run"); if (r) r.click(); });
const got = await page.waitForFunction(() => !!document.querySelector(".bte-kpi"), { timeout: 45000 }).then(() => true).catch(() => false);
console.log("results:", got);
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT, fullPage: false });
console.log("saved", OUT);
await b.close();
