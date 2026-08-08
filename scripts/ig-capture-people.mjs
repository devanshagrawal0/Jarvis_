// SUPERVISED, READ-ONLY capture of the real followers/following modal structure — Wave 1.
//
// Opens the owner's own profile at the followers (or following) URL, which pops the list modal, and
// dumps how the rows and scroll container are ACTUALLY built, so the harvest is written against
// reality (the inbox proved assumptions can be wrong). Opening your own followers list changes
// nothing — it is a read.
//
//   node scripts/ig-capture-people.mjs followers   (or: following)

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");
const { parsePeople } = require("../server/instagram/read-parsers.js");

const which = process.argv[2] === "following" ? "following" : "followers";
const USER = "devanshagrawal__";
const service = createBrowserAutomationService({ runtimeDir: "runtime", headless: true });
const taskId = "ig-capture-people";
const brief = (e) => ({ role: e.role, tag: e.tag, name: (e.name || "").slice(0, 40), href: e.href || "" });

try {
  await service.navigate({ taskId, url: `https://www.instagram.com/${USER}/`, waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 4000));

  // The "<N> following"/"<N> followers" count is a JS-triggered link (href "#") that opens the list
  // modal — navigating to the URL alone did not render it. Click it, then read the modal.
  // Target the SPECIFIC count link (role=link, name is exactly "<N> following"), not a big container
  // whose concatenated name merely contains those words — clicking the container did nothing.
  const exactCount = which === "following" ? /^\d[\d,]*\s+following$/i : /^\d[\d,]*\s+followers?$/i;
  let pre = await service.snapshot({ taskId, limit: 250 });
  const countLink = (pre.elements || []).find(
    (e) => String(e.role || "").toLowerCase() === "link" && exactCount.test(String(e.name || "").trim()),
  );
  if (countLink && countLink.ref) {
    console.log(`(clicking "${countLink.name}" to open the ${which} list — read-only)`);
    await service.click({ taskId, ref: countLink.ref });
    await new Promise((r) => setTimeout(r, 5000));
  } else {
    console.log(`(could not find the ${which} count link)`);
  }
  const snap = await service.snapshot({ taskId, limit: 250 });
  try {
    const shot = await service.screenshot({ taskId, name: "ig-people-capture" });
    console.log("SCREENSHOT:", shot?.path || JSON.stringify(shot));
  } catch (e) { console.log("screenshot failed:", e.message); }
  console.log("DIALOG present:", (snap.elements || []).some((e) => String(e.role || "").toLowerCase() === "dialog"));
  console.log("PAGE TEXT (first 500):", String(snap.pageText || "").slice(0, 500));

  console.log("URL   :", snap.url);
  console.log("TITLE :", snap.title);
  if (/accounts\/login/.test(String(snap.url || ""))) { console.log("!! logged out"); }
  else {
    const els = snap.elements || [];
    const profileLinks = els.filter((e) => {
      const href = String(e.href || "");
      return /^https:\/\/www\.instagram\.com\/[^/]+\/?$/.test(href) || /^\/[^/]+\/?$/.test(href);
    });
    console.log(`\nElements: ${els.length} | profile-like links: ${profileLinks.length}`);
    console.log("Sample profile-link rows (real structure):");
    for (const e of profileLinks.slice(0, 10)) console.log("   ", JSON.stringify(brief(e)));

    const people = parsePeople(els);
    console.log(`\nparsePeople() -> ${people.length} people`);
    for (const p of people.slice(0, 10)) console.log("   -", p.username, "|", p.name);

    console.log("\n=== all link/button elements (to see the modal + scroll structure) ===");
    for (const e of els.filter((x) => ["link", "button"].includes(String(x.role || "").toLowerCase())).slice(0, 40)) {
      console.log("   ", JSON.stringify(brief(e)));
    }
  }
} catch (err) {
  console.error("CAPTURE FAILED:", err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
}
