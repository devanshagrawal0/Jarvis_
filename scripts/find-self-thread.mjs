// Find the Instagram Direct thread for the owner's OWN account, so a live send test can be pinned
// to an exact conversation instead of searching for a name that appears all over the page.
//
// Read-only with one exception: it may open a conversation (a click that navigates, not a commit).
// It never types and never sends. Requires the backend to be stopped — both share one profile.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const HANDLE = process.argv[2];
if (!HANDLE) { console.error('usage: node scripts/find-self-thread.mjs "<own-handle>"'); process.exit(1); }

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });
const taskId = `selfthread-${Date.now()}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await browser.navigate({ taskId, url: "https://www.instagram.com/direct/inbox/" });
  // Instagram renders the thread list well after load; a short wait reports an empty inbox for an
  // account that has plenty of conversations.
  await wait(14000);
  let snap = await browser.snapshot({ taskId, limit: 300 });
  console.log("inbox url:", snap.url);
  console.log("elements:", (snap.elements || []).length);
  console.log("page text head:", String(snap.pageText || "").replace(/\s+/g, " ").slice(0, 300));
  console.log("hrefs sample:", JSON.stringify((snap.elements || []).map((e) => String(e.href || "")).filter(Boolean).slice(0, 12), null, 1));

  const threadLinks = (snap.elements || [])
    .filter((el) => /\/direct\/t\/\d+/.test(String(el.href || "")))
    .map((el) => ({ ref: el.ref, name: String(el.name || el.text || "").replace(/\s+/g, " ").trim().slice(0, 60), href: String(el.href) }));
  console.log(`threads visible: ${threadLinks.length}`);

  // Instagram labels the self-thread with the account's own name or handle.
  const self = threadLinks.find((t) => new RegExp(HANDLE, "i").test(t.name) || /your notes|only you|\(you\)/i.test(t.name));
  if (self) {
    console.log("SELF THREAD FOUND");
    console.log("url:", self.href);
    console.log("label:", self.name);
    process.exit(0);
  }

  console.log("no self thread in the visible inbox — thread labels seen:");
  console.log(threadLinks.map((t) => `  ${t.name || "(unnamed)"}`).join("\n"));
  console.log("\nA self-thread has to exist before it can be pinned. Open a DM to yourself once in the");
  console.log("real Instagram app, then re-run this. Nothing here will create one, because creating it");
  console.log("means driving the compose flow, and that is one mis-click away from messaging someone else.");
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => null);
}
