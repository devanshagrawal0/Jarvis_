// Screenshot the Jarvis home screen (and just the widget rail) so UI work can be judged by looking
// at it rather than by reading the JSX.
//
//   node _shoot-home.mjs out.png [http://localhost:5173]

import { chromium } from "playwright";

const OUT = process.argv[2] || "home.png";
const URL = process.argv[3] || "http://localhost:5173";

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (error) => console.log("PAGEERR:", error.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(6000);

await page.screenshot({ path: OUT, fullPage: false });
console.log("saved", OUT);

// The rail on its own, tightly cropped, because that is what is being redesigned.
const rail = await page.$(".jw-rail") || await page.$("[data-widget-rail]");
if (rail) {
  await rail.screenshot({ path: OUT.replace(/\.png$/, "-rail.png") });
  console.log("saved", OUT.replace(/\.png$/, "-rail.png"));
} else {
  // Pre-redesign there is no class to grab — crop the bottom band instead.
  await page.screenshot({ path: OUT.replace(/\.png$/, "-rail.png"), clip: { x: 0, y: 620, width: 1440, height: 200 } });
  console.log("saved cropped band", OUT.replace(/\.png$/, "-rail.png"));
}

await browser.close();
