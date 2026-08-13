import { chromium } from "playwright";

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:8799", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3500);

const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: a line of a very long essay meant to overflow the panel and test the bottom cap against the command bar.`).join("\n\n");
await page.evaluate((c) => {
  document.dispatchEvent(new CustomEvent("jarvis:ui", { detail: { type: "stage-show", data: { title: "Essay on Modern Intelligence", content: c } } }));
}, long);
await page.waitForSelector(".jr-stage", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1200);

const m = await page.evaluate(() => {
  const stage = document.querySelector(".jr-stage");
  const cb = document.querySelector(".jcb-root");
  if (!stage || !cb) return { error: "missing", stage: !!stage, cb: !!cb };
  const s = stage.getBoundingClientRect(), c = cb.getBoundingClientRect();
  const body = stage.querySelector(".jr-stage-body");
  return {
    viewportH: window.innerHeight,
    stageBottom: Math.round(s.bottom),
    commandBarTop: Math.round(c.top),
    gap: Math.round(c.top - s.bottom),
    bottomStaysAboveBar: s.bottom <= c.top,
    bodyScrolls: body.scrollHeight > body.clientHeight + 2,
  };
});
console.log(JSON.stringify(m));
await b.close();
