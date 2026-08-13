import { chromium } from "playwright";

const OUT = process.argv[2] || "stage-shot.png";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));

await page.goto("http://localhost:8799", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3500);

const MODE = process.argv[3] || "note";
const PAYLOAD = MODE === "random"
  ? { title: "Random Information", content: "**Random Insights & Observations**\n\n• **Quantum Computing**: Practical quantum advantage is increasingly targeted at simulating molecular dynamics for drug discovery, where classical supercomputers hit computational brickwalls.\n\n• **Oceanic Physics**: The ocean absorbs over 90% of the trapped solar energy on Earth, with deep currents taking centuries to complete a single global turnover loop.\n\n• **Aviation Logistics**: Modern commercial airliners log millions of data points per second across their engines, allowing predictive maintenance alerts before ground crews even approach the gate.\n\n• **Linguistics**: English has retained core Germanic grammatical roots while drawing over 60% of its vocabulary from Latin and French origins." }
  : MODE === "briefing"
  ? { title: "Stocks Today", content: "## Market Briefing\n\n**S&P 500** +0.6% — led by tech, breadth improving into the close.\n\n**Nasdaq** +0.9% — semiconductors strong on AI demand chatter.\n\n**Nvidia** +2.1% · **Apple** flat pre-earnings · **Tesla** -1.4% on a delivery miss.\n\n**Oil** +0.8%; energy names firm. **10Y yield** ticked up to 4.28%.\n\n**Takeaway:** risk-on tone, but watch tomorrow's CPI print for the next leg." }
  : { title: "Note", content: "This is a quick two-line note on your Stage surface.\n\nAll systems are online and ready for your command." };
await page.evaluate((p) => {
  try { localStorage.setItem("jarvis.spatial-widgets.v1", "{}"); } catch {}
  document.dispatchEvent(new CustomEvent("jarvis:ui", { detail: { type: "stage-show", data: p } }));
}, PAYLOAD);

await page.waitForSelector(".jr-stage", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1400);

const el = await page.$(".jr-stage");
if (el) {
  const box = await el.boundingBox();
  const pad = 46;
  await page.screenshot({ path: OUT, clip: {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(1500, box.width + pad * 2), height: Math.min(950, box.height + pad * 2),
  } });
  console.log("saved", OUT, "stageBox", JSON.stringify(box));
} else {
  await page.screenshot({ path: OUT });
  console.log("saved fullpage (no .jr-stage found)", OUT);
}
await b.close();
