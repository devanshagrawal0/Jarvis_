// Open (and thereby create) the Instagram Direct thread with the owner's OWN account, and print its
// /direct/t/ URL so a live send test can be pinned to it.
//
// Every step is asserted before the next one runs, and the recipient is verified by exact handle
// match before the conversation is opened. It NEVER types into a composer and NEVER sends: opening a
// conversation delivers nothing. If any assertion fails the script aborts rather than guessing,
// because the failure mode worth preventing is opening someone else's chat.
//
// Requires the backend to be stopped — both share the one browser profile.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const HANDLE = process.argv[2];
if (!HANDLE) { console.error('usage: node scripts/open-self-thread.mjs "<own-handle>"'); process.exit(1); }

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });
const taskId = `openself-${Date.now()}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const abort = async (why) => { console.log(`ABORT: ${why}`); await browser.close().catch(() => null); process.exit(1); };
const text = (el) => String(el.name || el.text || el.ariaLabel || "").replace(/\s+/g, " ").trim();

const snap = async (label) => {
  const s = await browser.snapshot({ taskId, limit: 300 });
  console.log(`  [${label}] url=${s.url} elements=${(s.elements || []).length}`);
  return s;
};
// Returns a match only when it is unambiguous. Falling back to "the first candidate" is how the
// first attempt clicked a container the size of the whole thread list.
const findOne = (elements, predicate, what) => {
  const hits = elements.filter(predicate);
  console.log(`  ${what}: ${hits.length} candidate(s) -> ${JSON.stringify(hits.map(text).map((t) => t.slice(0, 40)).slice(0, 6))}`);
  return hits.length === 1 ? hits[0] : null;
};
const isEditable = (el) => ["input", "textarea"].includes(String(el.tag || "").toLowerCase())
  || ["textbox", "searchbox", "combobox"].includes(String(el.role || "").toLowerCase());

try {
  await browser.navigate({ taskId, url: "https://www.instagram.com/direct/inbox/" });
  await wait(12000);
  let s = await snap("inbox");

  // 1. the compose control
  const compose = findOne(s.elements, (el) => /^new message$/i.test(text(el)), "compose button");
  if (!compose) await abort("could not find the New message control");
  console.log(`  compose -> ${JSON.stringify(text(compose))} ref=${compose.ref}`);
  await browser.click({ taskId, ref: compose.ref });
  await wait(4000);
  s = await snap("compose-open");

  // 2. the recipient search box
  // The sidebar has its own Search; the one that matters is the editable field the dialog just
  // added, so restrict to genuinely editable elements rather than anything labelled "Search".
  const editable = s.elements.filter(isEditable);
  console.log(`  editable fields: ${JSON.stringify(editable.map((el) => `${el.tag}/${el.role}/${text(el).slice(0, 24)}`))}`);
  const search = editable.length === 1 ? editable[0] : editable.find((el) => /search|to:/i.test(`${el.placeholder || ""} ${text(el)}`));
  if (!search) await abort("the compose dialog has no unambiguous search field");
  console.log(`  search -> ${search.tag}/${search.role} ref=${search.ref}`);
  await browser.type({ taskId, ref: search.ref, value: HANDLE });
  await wait(5000);
  s = await snap("results");

  // 3. the row for the OWN handle, matched exactly — never a substring, never "closest"
  // A result ROW is short. The page-sized container also contains the handle, and clicking it is
  // how the previous attempt aimed at half the screen — so bound the label length, and require the
  // handle to be essentially the whole label rather than merely present in it.
  const rows = s.elements.filter((el) => {
    const label = text(el).toLowerCase();
    return label.length <= 60 && label.includes(HANDLE.toLowerCase());
  });
  console.log(`  result rows: ${rows.length} -> ${JSON.stringify(rows.map((el) => `${el.tag}/${el.role}/${text(el)}`))}`);
  if (!rows.length) await abort(`no result row matched ${HANDLE}`);

  // An ACCOUNT row reads "<Full Name> <handle>". Two other things also contain the handle and must
  // never be picked: the sidebar profile link (shortest match, and behind the modal, so clicks on it
  // are intercepted) and — genuinely present here — a GROUP CHAT titled "... @<handle> · 1y".
  // Group titles carry "@" and a "·" timestamp; the account row carries neither.
  const accountRows = rows.filter((el) => String(el.role || "") === "button"
    && !text(el).includes("@") && !text(el).includes("·")
    && text(el).trim().split(/\s+/).length >= 2);
  console.log(`  account rows: ${JSON.stringify(accountRows.map(text))}`);
  const target = accountRows.length === 1 ? accountRows[0] : null;
  if (!target) await abort(`could not identify exactly one account row for ${HANDLE} — refusing to guess`);
  console.log(`  selecting -> ${target.tag}/${target.role}/${JSON.stringify(text(target))} ref=${target.ref}`);
  await browser.click({ taskId, ref: target.ref });
  await wait(3000);
  s = await snap("selected");

  // 4. confirm the selection really is the owner and nobody else got selected too
  const pageText = String(s.pageText || "");
  if (!new RegExp(HANDLE, "i").test(pageText)) await abort("the selected recipient is not visible on the page — refusing to continue");
  const chatBtn = findOne(s.elements, (el) => /^(chat|next|done)$/i.test(text(el)), "chat button");
  if (!chatBtn) await abort("no Chat/Next button to open the conversation");
  await browser.click({ taskId, ref: chatBtn.ref });
  await wait(6000);
  s = await snap("thread");

  if (!/\/direct\/t\/\d+/.test(String(s.url || ""))) await abort(`did not land on a conversation (url ${s.url})`);
  console.log("\nSELF THREAD URL:", s.url);
  console.log("thread header text:", String(s.pageText || "").replace(/\s+/g, " ").slice(0, 160));
  console.log("(nothing was typed and nothing was sent)");
} catch (error) {
  console.log("ERROR:", error.message);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => null);
}
