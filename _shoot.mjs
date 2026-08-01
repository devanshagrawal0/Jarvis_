import { chromium } from "playwright";

const OUT = process.argv[2] || "shot.png";
const TAB = process.argv[3] || "Live Markets";

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1728, height: 980 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);

// open APEX, then wait for the room's tab bar to actually exist (boot animation can take a while)
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text: "open apex" } })));
  try { await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("Live Markets")), { timeout: 8000 }); break; } catch {}
}
await page.waitForTimeout(1500);

// click the requested tab
await page.evaluate((name) => { const t = [...document.querySelectorAll(".tabs .tab")].find((x) => x.textContent.trim() === name); if (t) t.click(); }, TAB);

// wait for the terminal + a painted chart canvas
await page.waitForFunction(() => !!document.querySelector(".ax-term"), { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(7000);
if (process.argv[4] === "oracle") { await page.waitForFunction(() => !!document.querySelector(".axo-regime"), { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500); }
if (process.argv[4] === "oracle-full") { await page.waitForFunction(() => !!document.querySelector(".axo-regime"), { timeout: 20000 }).catch(() => {}); await page.evaluate(() => document.querySelector(".axo-expand")?.click()); await page.waitForTimeout(1800); }
if (process.argv[4] === "oracle-tm") {
  await page.waitForFunction(() => !!document.querySelector(".axo-regime"), { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => document.querySelector(".axo-expand")?.click()); await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector(".axv-tm-run"); if (b) b.click(); });
  await page.waitForFunction(() => !!document.querySelector(".axv-tm-hit"), { timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector(".axv-tm")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(600);
}
else if (process.argv[4]) { await page.keyboard.type(process.argv[4]); await page.waitForTimeout(800); }

await page.screenshot({ path: OUT, fullPage: false });
console.log("saved", OUT, "termPresent=", await page.evaluate(() => !!document.querySelector(".ax-term")));
await b.close();
