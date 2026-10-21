// Read the handle Instagram itself considers logged in on the saved profile.
//
// Needed so a live send test can be aimed at the owner's own account rather than a third party.
// Read-only: it navigates and reads, and clicks nothing. Requires the backend to be stopped,
// because both share the one browser profile.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });

const taskId = `whoami-${Date.now()}`;
try {
  await browser.navigate({ taskId, url: "https://www.instagram.com/" });
  await new Promise((r) => setTimeout(r, 4000));
  const snap = await browser.snapshot({ taskId, limit: 240 });
  const url = String(snap.url || "");
  console.log("url:", url);
  if (/\/accounts\/login/.test(url)) {
    console.log("STATUS: not logged in");
    process.exit(2);
  }
  // The profile link in the nav is the account's own handle; nothing else on the page is as direct.
  const elements = Array.isArray(snap.elements) ? snap.elements : [];
  const candidates = elements
    .map((el) => String(el.href || ""))
    .filter((href) => /^https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+\/?$/.test(href))
    .map((href) => href.replace(/\/$/, "").split("/").pop())
    .filter((handle) => !["explore", "reels", "direct", "accounts", "p", "stories"].includes(handle));
  const profileEl = elements.find((el) => /profile/i.test(String(el.name || el.ariaLabel || "")) && el.href);
  console.log("STATUS: logged in");
  console.log("profile-nav handle:", profileEl ? String(profileEl.href).replace(/\/$/, "").split("/").pop() : "(none)");
  console.log("handle candidates:", JSON.stringify([...new Set(candidates)].slice(0, 8)));
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => null);
}
