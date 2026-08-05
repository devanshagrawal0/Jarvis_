// Read-only. Opens each inbox row matching a name and reports who it actually is.
//
//   node scripts/identify-candidates.mjs "tg"
//
// This is the data a disambiguation picker needs: for every row sharing the queried name, the
// conversation it opens, the header it shows, and the handle behind it. It clicks conversation rows
// and reads pages. It never types, submits, or sends.
//
// Requires the backend stopped — both share the one browser profile.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUERY = process.argv[2] || "";
if (!QUERY) { console.error('usage: node scripts/identify-candidates.mjs "<name>"'); process.exit(1); }

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const { rankCandidates } = await import("../server/automation/entity-resolver.js");

const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const INBOX = "https://www.instagram.com/direct/inbox/";
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });

const clip = (value, max = 90) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

try {
  await browser.navigate({ url: INBOX, taskId: "identify" });
  await browser.wait({ taskId: "identify", milliseconds: 3500 });
  const inbox = await browser.snapshot({ taskId: "identify", limit: 240 });

  // The owner's own handle, so it can be excluded when looking for the other party in a thread.
  const ownerEntry = (inbox.elements || []).find((item) => /^button$/i.test(String(item.role || "")) && /^[a-z0-9._]+$/i.test(String(item.name || "").trim()));
  const owner = String(ownerEntry?.name || "").trim().toLowerCase();
  console.log(`owner account: ${owner || "(unknown)"}`);

  // Conversation rows only — landmarks and page furniture are not people.
  const rows = rankCandidates(QUERY, inbox.elements || [], { threshold: 0.5, limit: 8 })
    .filter((item) => ["button", "link"].includes(String(item.role || "").toLowerCase()));

  console.log(`\n${rows.length} row(s) in the inbox match ${JSON.stringify(QUERY)}:\n`);
  for (const row of rows) console.log(`  ${row.ref}  score ${row.matchScore}  ${JSON.stringify(clip(row.name || row.text))}`);
  if (!rows.length) { console.log("  (none — the name is not in the inbox at all)"); }

  for (const row of rows) {
    console.log(`\n── ${row.ref}: ${clip(row.name || row.text, 60)} ───────────────`);
    await browser.navigate({ url: INBOX, taskId: "identify" });
    await browser.wait({ taskId: "identify", milliseconds: 2500 });
    const fresh = await browser.snapshot({ taskId: "identify", limit: 240 });
    // Refs are per-snapshot, so match the row again by its label rather than reusing the old ref.
    const again = (fresh.elements || []).find((item) => clip(item.name || item.text) === clip(row.name || row.text));
    if (!again) { console.log("   row not found on re-observation (the inbox reordered)"); continue; }

    await browser.click({ taskId: "identify", ref: again.ref });
    await browser.wait({ taskId: "identify", milliseconds: 2500 });
    const thread = await browser.snapshot({ taskId: "identify", limit: 240 });

    // The counterpart's handle, not the owner's. An earlier version matched the first profile-shaped
    // link on the page, which is the owner's own account in the nav chrome — it reported the same
    // handle for every thread and told the owner nothing.
    const RESERVED = new Set(["direct", "explore", "reels", "accounts", "p", "stories", "your_activity", "settings", "inbox"]);
    const handleOf = (href) => String(href || "").replace(/^https?:\/\/(www\.)?instagram\.com/i, "").split("/").filter(Boolean)[0] || "";
    const handles = [...new Set((thread.elements || [])
      .map((item) => handleOf(item.href))
      .filter((handle) => handle && !RESERVED.has(handle.toLowerCase()) && handle.toLowerCase() !== owner))];

    const avatar = (thread.elements || []).find((item) => item.imageUrl && /^https?:/i.test(item.imageUrl)
      && !/logo|sprite|static/i.test(item.imageUrl));

    console.log(`   thread url : ${thread.url}`);
    console.log(`   handle(s)  : ${handles.length ? handles.slice(0, 3).join(", ") : "(not exposed on this page)"}`);
    console.log(`   avatar     : ${avatar ? clip(avatar.imageUrl, 95) : "(none captured)"}`);
    console.log(`   last lines : ${clip(String(thread.pageText || "").split(/\s{2,}|\n/).filter(Boolean).slice(-3).join(" | "), 120)}`);
  }
  console.log("");
} finally {
  await browser.close().catch(() => null);
}
