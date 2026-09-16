import { chromium } from "playwright";
// Control tab screenshots: Command mode (portrait) and Takeover overlay. Base URL from argv[2]
// (dist on :8799, or the vite dev server on :5173), output prefix from argv[3].
const base = process.argv[2] || "http://127.0.0.1:8799";
const out = process.argv[3] || "D:/jarvis/_newpc/control";
const b = await chromium.launch({ headless: true, args: ["--headless=new", "--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 200)); });
await page.goto(`${base}/app.html`, { waitUntil: "load", timeout: 60000 });
await page.evaluate(() => { localStorage.setItem("jarvis.mobile.coach", "off"); });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Control" }).click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}-command.png` });
console.log("command:", await page.locator(".pc-line").innerText().catch(() => "?"), "| chips:", await page.locator(".chips-wrap .chip").count());
await page.getByRole("tab", { name: "Takeover" }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}-takeover.png` });
console.log("takeover:", await page.locator(".tk-read").innerText().catch(() => "?"), "|", await page.locator(".tk-msg").innerText().catch(() => ""));
await b.close();
