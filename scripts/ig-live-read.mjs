// SUPERVISED, READ-ONLY live look at the real Instagram inbox — Wave 1 validation.
//
// It navigates to the DM inbox and takes ONE snapshot, then runs the parser on the real page so we
// can see whether the parser's assumptions match reality. It does NOT click, type, open a thread, or
// send anything — navigating to the inbox and reading the rendered page changes nothing on the
// account (opening a specific thread would send a read receipt; we never do that here).

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createBrowserAutomationService } = require("../server/browser-service.js");
const { parseInbox } = require("../server/instagram/read-parsers.js");

const service = createBrowserAutomationService({ runtimeDir: "runtime", headless: true });
const taskId = "ig-live-read";

const brief = (e) => ({ role: e.role, tag: e.tag, name: (e.name || "").slice(0, 60), text: (e.text || "").slice(0, 60), href: e.href || "" });

try {
  await service.navigate({ taskId, url: "https://www.instagram.com/direct/inbox/", waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 4000));

  // If Instagram shows the "Continue as <you>" profile picker, click it to proceed into the session.
  // This only selects the owner's own profile — it sends nothing and opens no thread.
  let gate = await service.snapshot({ taskId, limit: 250 });
  const cont = (gate.elements || []).find((e) => /continue/i.test(e.name || "") && /devansh/i.test(e.name || ""));
  if (cont && cont.ref) {
    console.log(`(clicking "${cont.name}" to pass the profile-picker — sends nothing)`);
    await service.click({ taskId, ref: cont.ref });
    await new Promise((r) => setTimeout(r, 4000));
    await service.navigate({ taskId, url: "https://www.instagram.com/direct/inbox/", waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 5000));
  }

  const snap = await service.snapshot({ taskId, limit: 250 });

  console.log("URL   :", snap.url);
  console.log("TITLE :", snap.title);
  if (/accounts\/login/.test(String(snap.url || ""))) {
    console.log("\n!! Redirected to login — the browser session is not logged in. Stopping.");
  } else {
    const els = snap.elements || [];
    const threadLinks = els.filter((e) => /\/direct\/t\/\d+/.test(String(e.href || "")));

    console.log(`\nElements read: ${els.length}`);
    console.log(`Thread links (href /direct/t/<id>): ${threadLinks.length}`);
    console.log("Sample thread-link elements (real structure):");
    for (const e of threadLinks.slice(0, 4)) console.log("   ", JSON.stringify(brief(e)));

    const parsed = parseInbox(snap);
    console.log(`\nparseInbox() -> ${parsed.count} threads`);
    for (const t of parsed.threads.slice(0, 9)) {
      console.log(`   - ${(t.name || "?").padEnd(22)} ${t.unread ? "[UNREAD]" : "        "} ${t.time || ""}  |  ${(t.label || "").slice(0, 55)}`);
    }

    if (threadLinks.length === 0) {
      // The parser's assumption (rows are anchors with /direct/t/ hrefs) is wrong. Dump ALL the
      // interactive elements and the full inbox text so the parser can be rebuilt against reality.
      console.log("\n=== ALL interactive elements (real structure) ===");
      const rows = els.filter((e) => ["link", "button"].includes(String(e.role || "").toLowerCase()));
      for (const e of rows) console.log("   ", JSON.stringify(brief(e)));
      console.log("\n=== FULL inbox text ===");
      console.log(String(snap.pageText || "").slice(0, 2000));
    }
  }
} catch (err) {
  console.error("READ FAILED:", err?.stack || err);
  process.exitCode = 1;
} finally {
  try { await service.close?.(); } catch { /* best effort */ }
}
