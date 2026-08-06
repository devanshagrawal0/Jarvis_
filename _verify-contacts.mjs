// Drives the contacts widget the way a person does: add someone with several channels, watch a bad
// value get refused, fix it, edit, remove a channel, then delete. Anything that only checked "the
// panel renders" would have passed on day one — the widget existed and could not save.
//
// Also asserts the layout budget. The first version of this panel spent over 400px of a 700px
// window on a hero that restated the window title and four tiles reading "1 / 0 / 1 / 0"; the list
// of actual people scrolled in what was left. That is a real defect and it needs a real check, or
// it comes back the next time someone adds "just one more" summary strip.
//
// Writes to the real contact store, then removes exactly what it created.
//
//   node _verify-contacts.mjs

import { chromium } from "playwright";

const NAME = "Zz Verify Fixture";
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.on("pageerror", (error) => console.log("PAGEERR:", error.message));

const pass = [];
const fail = [];
const check = (name, ok, detail = "") => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ""}`);

// :not(.cc-face) matters — a row holds two spans, the monogram and the text, and both contain a
// <b>. Without it every count is doubled and "2 before, 2 after" can hide a real change.
const rows = () => page.$$eval(".cc-row > span:not(.cc-face) > b", (nodes) => nodes.map((n) => n.textContent.replace("●", "").trim()));
const message = () => page.$eval(".cc-note-bar", (n) => `${n.dataset.tone}: ${n.textContent}`).catch(() => "");
const field = (key) => `#cc-${key}`;

// Saving is a round trip. Waiting a fixed number of milliseconds made every assertion after a save
// measure the state before it — the save worked and the check said it had not. Do NOT detect a new
// banner by removing the old node: React reconciles against its own tree and never re-renders it.
async function saveAndWait() {
  const previous = await message();
  await page.evaluate(() => [...document.querySelectorAll(".cc-save button")].find((b) => /^Save/.test(b.textContent.trim()))?.click());
  await page.waitForFunction((before) => {
    const node = document.querySelector(".cc-note-bar");
    const now = node ? `${node.dataset.tone}: ${node.textContent}` : "";
    return now && now !== before;
  }, previous, { timeout: 15000 });
  await page.waitForTimeout(500);
  return message();
}

await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5500);
await page.evaluate(() => document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: "contacts", focus: true } })));
await page.waitForSelector(".cc", { timeout: 15000 });
// Wait until the DOM agrees with the server about how many people exist.
//
// Waiting for "a row, or the empty state" looked like waiting for data and was not: "No contacts
// yet" is what the panel says BEFORE the first fetch lands, so the wait passed instantly and the
// baseline was read as zero. Every later count then compared against the wrong number.
await page.waitForFunction(async () => {
  const response = await fetch("/api/contacts");
  if (!response.ok) return false;
  const body = await response.json();
  return document.querySelectorAll(".cc-row").length === (body.contacts || []).length;
}, { timeout: 25000 });

check("the widget opens", await page.$(".cc") !== null);
const before = await rows();
check("the existing address book loaded before the test touched it", !before.includes(NAME), before.join(", ") || "(empty)");

// ── the layout budget ──────────────────────────────────────────────────────
const space = await page.evaluate(() => {
  const root = document.querySelector(".cc").getBoundingClientRect();
  const panes = document.querySelector(".cc-panes").getBoundingClientRect();
  return { total: Math.round(root.height), content: Math.round(panes.height) };
});
const contentShare = space.content / space.total;
check("chrome does not eat the panel", contentShare > 0.85, `${Math.round(contentShare * 100)}% content (${space.total - space.content}px chrome of ${space.total}px)`);

// ── every channel the store accepts must have a field ──────────────────────
await page.evaluate(() => [...document.querySelectorAll(".cc-tools button")].find((b) => b.textContent.trim() === "New")?.click());
await page.waitForSelector("[data-channel]", { timeout: 10000 });
const fields = await page.$$eval("[data-channel] input", (n) => n.length);
check("the editor offers every channel", fields === 15, `${fields} fields`);

// ── a bad value is refused, with the store's own reason ────────────────────
await page.fill("#cc-name", NAME);
await page.fill(field("email"), "not-an-email");
const refusal = await saveAndWait();
check("a bad value is refused", refusal.startsWith("error"), refusal);
check("the refusal says what was wrong", /email address/i.test(refusal), refusal);
check("nothing was created by the refused save", !(await rows()).includes(NAME));

// ── fix it and save for real, across three channel kinds ───────────────────
await page.fill(field("email"), "fixture@example.com");
await page.fill(field("instagram"), "zz_fixture");
await page.fill(field("whatsapp"), "+15550001111");
await page.fill("#cc-notes", "Created by _verify-contacts.mjs");
const saved = await saveAndWait();
check("a valid contact saves", (await rows()).includes(NAME), saved || (await rows()).join(", "));

const labels = await page.$$eval(".cc-def > span", (n) => n.map((x) => x.textContent));
check("handle, address and phone channels all persist", labels.length === 3, labels.join(" | "));
check("notes persist", (await page.$eval(".cc-sub p", (n) => n.textContent).catch(() => "")).includes("_verify-contacts"));

// ── edit: drop a channel ───────────────────────────────────────────────────
await page.evaluate(() => [...document.querySelectorAll(".cc-head nav button")].find((b) => b.textContent.trim() === "Edit")?.click());
await page.waitForSelector("[data-channel] input", { timeout: 10000 });
await page.fill(field("whatsapp"), "");            // clearing must actually remove it
await saveAndWait();
const afterEdit = await page.$$eval(".cc-def > span", (n) => n.map((x) => x.textContent));
check("a cleared channel is removed, not silently kept", afterEdit.length === 2, afterEdit.join(" | "));

// ── search ─────────────────────────────────────────────────────────────────
await page.fill(".cc-tools input", "zz_fixture");
await page.waitForTimeout(400);
check("search finds a person by handle", (await rows()).includes(NAME), (await rows()).join(", "));
await page.fill(".cc-tools input", "");
await page.waitForTimeout(400);

// ── delete asks first, then works (this route used to answer 415 forever) ──
const selectedFixture = await page.evaluate((name) => {
  const row = [...document.querySelectorAll(".cc-row")].find((r) => r.textContent.includes(name));
  if (!row) return false;
  row.click();
  return true;
}, NAME);
await page.waitForTimeout(700);
// Refuse to arm a delete unless the dossier on screen is demonstrably the fixture. An earlier draft
// clicked "Delete" on whatever happened to be selected when its own row was missing, which pointed
// a destructive action at a real contact. A test may not be able to do that.
const dossierName = await page.$eval(".cc-head h3", (n) => n.textContent.trim()).catch(() => "");
if (!selectedFixture || dossierName !== NAME) {
  fail.push(`REFUSING to test delete — the dossier shows "${dossierName}", not the fixture. Nothing was deleted.`);
  console.log(`\n${"=".repeat(64)}`);
  for (const item of pass) console.log(`  PASS  ${item}`);
  for (const item of fail) console.log(`  FAIL  ${item}`);
  await browser.close();
  process.exit(1);
}
const buttons = () => page.$$eval(".cc-head nav button", (n) => n.map((x) => x.textContent.trim()));
await page.evaluate(() => [...document.querySelectorAll(".cc-head nav button")].find((b) => b.textContent.trim() === "Delete")?.click());
await page.waitForTimeout(400);
check("delete asks before destroying", (await buttons()).some((label) => label.startsWith("Delete Zz")), (await buttons()).join(", "));
await page.evaluate(() => [...document.querySelectorAll(".cc-head nav button")].find((b) => b.textContent.trim().startsWith("Delete Zz"))?.click());
await page.waitForFunction((name) => ![...document.querySelectorAll(".cc-row > span > b")].some((n) => n.textContent.includes(name)), NAME, { timeout: 15000 }).catch(() => {});
check("delete works", !(await rows()).includes(NAME), (await message()) || (await rows()).join(", "));
check("nothing else was disturbed", (await rows()).length === before.length, `${before.length} before, ${(await rows()).length} after`);

console.log(`\n${"=".repeat(64)}`);
for (const item of pass) console.log(`  PASS  ${item}`);
for (const item of fail) console.log(`  FAIL  ${item}`);
console.log(`${"=".repeat(64)}\n${fail.length ? `${fail.length} CHECK(S) FAILED` : `all ${pass.length} checks passed`}`);

await browser.close();
process.exit(fail.length ? 1 : 0);
