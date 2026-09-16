import { chromium } from "playwright";
import fs from "node:fs";
// Use the Control tab like the owner would, from a phone-sized browser on the tailnet URL.
// Proof is the PC's own screen (captured via the backend) and the numbers the app shows.
const base = process.argv[2] || "https://nucbox-k8-plus.tail6f924a.ts.net";
const out = "D:/jarvis/_newpc/use";
const b = await chromium.launch({ channel: "msedge", headless: true, args: ["--headless=new", "--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
page.on("console", (m) => { if (m.type() === "error") log("console.error:", m.text().slice(0, 160)); });
const pcShot = async (name) => {
  const r = await page.evaluate(async () => (await fetch("/api/device-mesh/live/frame?w=1600&q=80")).json());
  if (r.frameUrl) { const buf = await page.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), r.frameUrl); fs.writeFileSync(`${out}-${name}.jpg`, Buffer.from(buf)); log("pc screen saved", name, r.dimensions); }
  else log("no pc frame", r.error);
};

await page.goto(`${base}/app.html`, { waitUntil: "load", timeout: 60000 });
await page.evaluate(() => { localStorage.setItem("jarvis.mobile.coach", "off"); localStorage.removeItem("jarvis.mobile.pc.v1"); });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2500);
log("build", await page.locator(".app").getAttribute("data-build"));
await page.getByRole("button", { name: "Control" }).click();
await page.waitForTimeout(9000);
log("pc line:", await page.locator(".pc-line").innerText());
log("app chips:", await page.locator(".chips-wrap .chip").allInnerTexts());
log("room chips:", await page.locator(".chips-row .chip").allInnerTexts());
log("glimpse img:", await page.locator(".glimpse img").count());
await page.screenshot({ path: `${out}-1-command.png` });

// search the installed apps like a user
await page.locator(".open-q").fill("note");
await page.waitForTimeout(400);
log("search 'note' →", await page.locator(".chips-wrap .chip").allInnerTexts());
await page.locator(".open-q").fill("");

// tell the PC something in plain words
const say = async (t) => {
  await page.locator(".dock .input").fill(t);
  await page.locator(".dock .input").press("Enter");
  const t0 = Date.now();
  await page.waitForFunction(() => { const turns = document.querySelectorAll(".turn.model"); const last = turns[turns.length - 1]; return last && !last.classList.contains("live") && (last.innerText || "").trim().length > 0; }, null, { timeout: 90000 }).catch(() => log("timeout waiting for reply"));
  const reply = await page.locator(".turn.model").last().innerText();
  log(`"${t}" → ${(Date.now() - t0) / 1000}s →`, reply.replace(/\s+/g, " ").slice(0, 300));
};
await say("open notepad on the pc");
await page.waitForTimeout(2500);
await pcShot("2-after-open-notepad");
await page.screenshot({ path: `${out}-2-command-thread.png` });

// Takeover: tap the glimpse
await page.locator(".frame").click();
const t0 = Date.now();
await page.waitForFunction(() => /fps/.test(document.querySelector(".tk-read")?.textContent || ""), null, { timeout: 40000 }).catch(() => log("no fps readout"));
log("takeover readout after", (Date.now() - t0) / 1000, "s:", await page.locator(".tk-read").innerText(), "|", await page.locator(".tk-msg").innerText().catch(() => ""));
await page.waitForTimeout(4000);
log("readout:", await page.locator(".tk-read").innerText());
const vid = await page.evaluate(() => { const v = document.querySelector(".tk-video"); return { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, paused: v.paused, ready: v.readyState }; });
log("video element:", JSON.stringify(vid));
await page.screenshot({ path: `${out}-3-takeover.png` });

// tap the middle of the PC screen (in the rotated frame the video covers the whole viewport)
const box = await page.locator(".tk-video").boundingBox();
log("video box", JSON.stringify(box));
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(800);
log("input rtt readout:", await page.locator(".tk-read").innerText(), "| err:", await page.locator(".tk-err").innerText().catch(() => ""));
// type through the keyboard field
await page.locator(".tk-btn[aria-label=\"Keyboard\"]").click();
await page.waitForTimeout(300);
await page.locator(".tk-kbd").focus();
await page.keyboard.type("hello from the phone", { delay: 20 });
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
await pcShot("4-after-typing");
await page.screenshot({ path: `${out}-4-takeover-keys.png` });
// two-finger scroll + right click are gesture-only; hotkey strip: Esc
await page.locator(".tk-keys .key", { hasText: "Esc" }).click();
await page.waitForTimeout(300);
log("stream status:", JSON.stringify((await page.evaluate(async () => (await fetch("/api/device-mesh/stream/status")).json())).stream));
await page.locator(".tk-btn.danger").click();
await page.waitForTimeout(1500);
log("after stop:", JSON.stringify((await page.evaluate(async () => (await fetch("/api/device-mesh/stream/status")).json())).stream.running));
await b.close();
