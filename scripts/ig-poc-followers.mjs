// PROOF OF CONCEPT — scroll-harvest the following list, SAFELY.
//
// Proves the list-reader wiring works on the real modal by collecting MORE than the first on-screen
// batch. Deliberately capped small (default 50, not all 830) and human-paced, because scrolling a
// big follow list is the most rate-limit-prone read. Read-only: opening and scrolling your own
// following list changes nothing.
//
//   node scripts/ig-poc-followers.mjs [cap]

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const path = require("node:path");
const { harvestList } = require("../server/instagram/list-reader.js");

const CAP = Number(process.argv[2] || 50);
const USER = "devanshagrawal__";
const profileDir = path.join(process.cwd(), "runtime", "browser-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => Math.round(a + (b - a) * Math.random());

const context = await chromium.launchPersistentContext(profileDir, { headless: true });
try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`https://www.instagram.com/${USER}/`, { waitUntil: "domcontentloaded" });
  await sleep(3500);

  // Open the following list via the exact count link.
  const link = page.getByRole("link", { name: /^\d[\d,]*\s+following$/i }).first();
  await link.click();
  await sleep(3500);

  // Mark the scrollable container inside the dialog so we can scroll exactly it.
  const hasScroller = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;
    for (const d of dialog.querySelectorAll("div")) {
      const s = getComputedStyle(d);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && d.scrollHeight > d.clientHeight + 10) {
        d.setAttribute("data-ig-scroller", "1");
        return true;
      }
    }
    return false;
  });
  if (!hasScroller) { console.log("No scroll container found in the dialog."); }

  const RESERVED = new Set(["explore", "reels", "reel", "direct", "p", "stories", "accounts", "about", "legal", USER, "popular"]);
  const driver = {
    rows: () => page.evaluate((reserved) => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return [];
      const out = [];
      for (const a of dialog.querySelectorAll('a[href^="/"]')) {
        const m = (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (m && !reserved.includes(m[1])) out.push({ key: m[1], username: m[1] });
      }
      return out;
    }, [...RESERVED]),
    scrollHeight: () => page.evaluate(() => document.querySelector("[data-ig-scroller]")?.scrollHeight || 0),
    scrollStep: () => page.evaluate(() => { const el = document.querySelector("[data-ig-scroller]"); if (el) el.scrollTop = el.scrollHeight; }),
    settle: () => sleep(jitter(1500, 2600)), // human-paced between scroll batches
  };

  const started = Date.now();
  const result = await harvestList(driver, { maxItems: CAP, stallLimit: 3, maxScrolls: 40 });
  console.log(`\nHarvested ${result.count} people in ${result.scrolls} scrolls (${((Date.now() - started) / 1000).toFixed(1)}s), complete=${result.complete}, cappedOut=${result.cappedOut}`);
  console.log("First 20:", result.items.slice(0, 20).map((p) => p.username).join(", "));
  console.log(`\n(capped at ${CAP} on purpose — the full 830 is a bigger scroll we do only when you want it)`);
} catch (err) {
  console.error("POC FAILED:", err?.stack || err);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
