// Read the notifications/activity panel via raw Playwright (force-click past the overlay that
// intercepted the normal click). Read-only.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const path = require("node:path");
const { classifyNotification } = require("../server/instagram/read-parsers.js");

const profileDir = path.join(process.cwd(), "runtime", "browser-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(profileDir, { headless: true });
try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  await sleep(3500);

  // Click the Notifications control by its icon's accessible name, forcing past any overlay.
  let opened = false;
  for (const sel of [
    'a:has(svg[aria-label="Notifications"])',
    'div[role="link"]:has(svg[aria-label="Notifications"])',
    'svg[aria-label="Notifications"]',
  ]) {
    try {
      await page.locator(sel).first().click({ force: true, timeout: 4000 });
      opened = true;
      break;
    } catch { /* try the next selector */ }
  }
  console.log("clicked notifications:", opened);
  await sleep(3500);

  // Read rows from the flyout: an account link + the notification text near it.
  const rows = await page.evaluate(() => {
    const out = [];
    // Notification rows are links to profiles, each row carrying verb text.
    for (const a of document.querySelectorAll('a[href^="/"]')) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (!m) continue;
      // climb to the row container and grab its text
      let row = a;
      for (let i = 0; i < 4 && row.parentElement; i += 1) row = row.parentElement;
      const text = (row.innerText || "").replace(/\s+/g, " ").trim();
      if (/following you|liked|commented|replied|mentioned|tagged|requested to follow/i.test(text)) {
        out.push({ username: m[1], text: text.slice(0, 120) });
      }
    }
    return out;
  });

  // dedupe by username+text
  const seen = new Set();
  const events = [];
  for (const r of rows) {
    const key = r.username + "|" + r.text.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ ...r, type: classifyNotification(r.text) });
  }

  console.log(`\nNotifications found: ${events.length}`);
  for (const e of events.slice(0, 20)) console.log(`   - ${String(e.type).padEnd(15)} @${e.username}  |  ${e.text.slice(0, 70)}`);

  if (events.length === 0) {
    const bodyText = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 800));
    console.log("\n(no rows classified) PAGE TEXT:", bodyText);
  }
} catch (err) {
  console.error("FAILED:", err?.stack || err);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
