// SUPERVISED, READ-ONLY: open the notifications/activity panel and read it — Wave 1.
//
// The Notifications nav is a JS-triggered flyout (no clean URL). Click it, snapshot the panel, dump
// the real structure, and run parseNotifications so we can validate the parser against reality and
// actually report what's there. Opening notifications changes nothing.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");
const { parseNotifications, classifyNotification } = require("../server/instagram/read-parsers.js");

const service = createBrowserAutomationService({ runtimeDir: "runtime", headless: true });
const taskId = "ig-read-notif";
const brief = (e) => ({ role: e.role, tag: e.tag, name: (e.name || "").slice(0, 70), href: (e.href || "").slice(0, 40) });

try {
  await service.navigate({ taskId, url: "https://www.instagram.com/", waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 4000));

  let pre = await service.snapshot({ taskId, limit: 250 });
  const notifNav = (pre.elements || []).find(
    (e) => String(e.role || "").toLowerCase() === "link" && /notifications/i.test(e.name || ""),
  );
  if (notifNav && notifNav.ref) {
    console.log(`(clicking "${notifNav.name}" to open the notifications panel — read-only)`);
    await service.click({ taskId, ref: notifNav.ref });
    await new Promise((r) => setTimeout(r, 4000));
  } else {
    console.log("(could not find the Notifications nav link)");
  }

  const snap = await service.snapshot({ taskId, limit: 250 });
  console.log("URL:", snap.url, "| DIALOG:", (snap.elements || []).some((e) => String(e.role).toLowerCase() === "dialog"));

  const parsed = parseNotifications(snap);
  console.log(`\nparseNotifications() -> ${parsed.count} events`);
  for (const e of parsed.events.slice(0, 15)) console.log(`   - ${String(e.type).padEnd(15)} @${e.username || "?"}  |  ${e.text.slice(0, 55)}`);

  console.log("\n=== raw rows that look like notifications (name mentions a verb) ===");
  const verbRe = /(started following|requested to follow|liked|commented|replied|mentioned|tagged)/i;
  for (const e of (snap.elements || []).filter((x) => verbRe.test(x.name || ""))) {
    console.log("   ", JSON.stringify(brief(e)), "->", classifyNotification(e.name || ""));
  }
  console.log("\n=== PAGE TEXT (first 900) ===");
  console.log(String(snap.pageText || "").slice(0, 900));
} catch (err) {
  console.error("READ FAILED:", err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
}
