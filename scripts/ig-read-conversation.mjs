// SUPERVISED read of ONE conversation's messages — Wave 1.
//
// Opens a thread from the inbox by the participant's name and reads the messages. Chosen thread is
// one where the owner's message is the latest, so opening it marks nothing new as read — no new
// "Seen" receipt for anyone. (Opening a thread with unread messages WOULD send a read receipt; that
// is a social side effect, not a ban risk.)
//
//   node scripts/ig-read-conversation.mjs [nameContains]

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");

const NAME = (process.argv[2] || "aj").toLowerCase();
const service = createBrowserAutomationService({ runtimeDir: "runtime", headless: true });
const taskId = "ig-read-convo";
const brief = (e) => ({ role: e.role, tag: e.tag, name: (e.name || "").slice(0, 60), text: (e.text || "").slice(0, 60) });

try {
  await service.navigate({ taskId, url: "https://www.instagram.com/direct/inbox/", waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 5000));

  // Find the thread row (role=button div, label starts with the name and has a "· time" marker).
  const inbox = await service.snapshot({ taskId, limit: 250 });
  const row = (inbox.elements || []).find((e) => {
    if (String(e.role || "").toLowerCase() !== "button") return false;
    const label = String(e.name || "").toLowerCase();
    return label.startsWith(NAME) && /·\s*\d|active now|unread|new messages/.test(label);
  });
  if (!row || !row.ref) { console.log(`Could not find a thread starting with "${NAME}".`); }
  else {
    console.log(`Opening thread: "${row.name}"`);
    await service.click({ taskId, ref: row.ref });
    await new Promise((r) => setTimeout(r, 5000));
  }

  const snap = await service.snapshot({ taskId, limit: 250 });
  console.log("URL:", snap.url, "| TITLE:", snap.title);

  console.log("\n=== conversation page text (messages live here) ===");
  console.log(String(snap.pageText || "").slice(0, 1200));

  console.log("\n=== interactive elements (to find the composer + message structure) ===");
  for (const e of (snap.elements || []).filter((x) => ["button", "textbox", "link"].includes(String(x.role || "").toLowerCase())).slice(0, 25)) {
    console.log("   ", JSON.stringify(brief(e)));
  }
} catch (err) {
  console.error("READ FAILED:", err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
}
