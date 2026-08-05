// Read-only. Proves a same-name choice is actually answerable against the live site.
//
//   node scripts/verify-enrichment.mjs "tg"
//
// Ranks the inbox rows matching a name, then runs the real enrichment the picker card uses, and
// asserts the result could distinguish two people: different accounts, different threads, different
// faces. It opens conversation rows and reads pages; it never types, submits, or sends.
//
// Requires the backend stopped — both share the one browser profile.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUERY = process.argv[2] || "";
if (!QUERY) { console.error('usage: node scripts/verify-enrichment.mjs "<name>"'); process.exit(1); }

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const { rankCandidates } = await import("../server/automation/entity-resolver.js");
const { enrichCandidates } = await import("../server/automation/identity-enrichment.js");

const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const INBOX = "https://www.instagram.com/direct/inbox/";
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });

const pass = [];
const fail = [];
const check = (name, ok, detail = "") => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ""}`);

try {
  await browser.navigate({ url: INBOX, taskId: "enrich" });
  await browser.wait({ taskId: "enrich", milliseconds: 3500 });
  const inbox = await browser.snapshot({ taskId: "enrich", limit: 240 });
  const rows = rankCandidates(QUERY, inbox.elements || [], { threshold: 0.5, limit: 6 })
    .filter((item) => ["button", "link"].includes(String(item.role || "").toLowerCase()));

  console.log(`\n${rows.length} inbox row(s) match ${JSON.stringify(QUERY)} — all identical to a machine:\n`);
  for (const row of rows) console.log(`  ${JSON.stringify(String(row.name || row.text || "").slice(0, 70))}`);
  check("the ambiguity is real", rows.length > 1, `${rows.length} row(s)`);

  const enriched = await enrichCandidates({ browserService: browser, taskId: "enrich", candidates: rows, inboxUrl: INBOX });

  console.log(`\nafter enrichment — what the picker will show:\n`);
  for (const item of enriched) {
    console.log(`  ${item.label}`);
    console.log(`     handle : ${item.handle ? `@${item.handle}` : "(not exposed)"}`);
    console.log(`     thread : ${item.threadUrl || "-"}`);
    console.log(`     avatar : ${item.avatarUrl ? `${item.avatarUrl.slice(0, 72)}…` : "(none)"}`);
  }

  const handles = enriched.map((item) => item.handle).filter(Boolean);
  const threads = enriched.map((item) => item.threadUrl).filter(Boolean);
  const avatars = enriched.map((item) => item.avatarUrl).filter(Boolean);

  check("every candidate resolved to an account", handles.length === enriched.length, `${handles.length}/${enriched.length}`);
  check("the accounts are different", new Set(handles).size === handles.length, handles.join(", "));
  check("the threads are different", new Set(threads).size === threads.length, `${new Set(threads).size} distinct`);
  // The failure that made the first attempt worthless: one avatar reported for every person.
  check("the faces are different", avatars.length === 0 || new Set(avatars).size === avatars.length,
    avatars.length ? `${new Set(avatars).size} distinct of ${avatars.length}` : "no avatars captured");
  check("no candidate reports the owner's own account", !handles.some((handle) => handle.toLowerCase() === "accountowner"));
} finally {
  await browser.close().catch(() => null);
}

console.log(`\n${"=".repeat(58)}`);
for (const item of pass) console.log(`  PASS  ${item}`);
for (const item of fail) console.log(`  FAIL  ${item}`);
console.log(`${"=".repeat(58)}\n${fail.length ? `${fail.length} CHECK(S) FAILED` : "The choice is answerable."}`);
process.exit(fail.length ? 1 : 0);
