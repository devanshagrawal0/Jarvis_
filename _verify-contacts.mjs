// Drives the contacts widget the way a person does: add someone with several channels, watch a bad
// value get refused, fix it, edit, remove a channel, then delete. Anything that only checks the
// panel renders would have passed on day one — the widget existed and could not save.
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

const rows = () => page.$$eval(".cc-row strong", (nodes) => nodes.map((n) => n.textContent.replace("★", "").trim()));
const message = () => page.$eval(".cc-msg", (n) => `${n.dataset.tone}: ${n.textContent}`).catch(() => "");
const field = (key) => `#cc-${key}`;

// Saving is a round trip. Waiting a fixed number of milliseconds made every assertion after a save
// measure the state before it — the save worked and the check said it had not, which is the exact
// shape of a test that lies in both directions.
async function saveAndWait() {
  // Do NOT remove the existing banner to detect a new one: React reconciles against its own tree,
  // so a node torn out from under it is simply never re-rendered and the wait hangs forever.
  // Wait for the text to change instead.
  const previous = await message();
  await page.evaluate(() => [...document.querySelectorAll(".cc-actions .cc-btn")].find((b) => /^Save/.test(b.textContent.trim()))?.click());
  await page.waitForFunction((before) => {
    const node = document.querySelector(".cc-msg");
    const now = node ? `${node.dataset.tone}: ${node.textContent}` : "";
    return now && now !== before;
  }, previous, { timeout: 15000 });
  // The list reloads after a successful save; settle before reading it.
  await page.waitForTimeout(500);
  return message();
}

await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5500);
await page.evaluate(() => document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id: "contacts", focus: true } })));
await page.waitForSelector(".cc-center", { timeout: 15000 });
// Wait for the fetch to land, not for a guessed number of milliseconds. The first run of this
// script read an empty list because the panel had rendered and the data had not arrived, which made
// every later assertion measure the wrong thing — including one that reported a delete "worked"
// because the row it was looking for had never existed.
await page.waitForFunction(() => {
  const centre = document.querySelector(".cc-center");
  if (!centre) return false;
  return document.querySelector(".cc-row") !== null || /No contacts yet/.test(centre.textContent || "");
}, { timeout: 20000 });

check("the widget opens", await page.$(".cc-center") !== null);
const before = await rows();
check("the existing address book loaded before the test touched it", !before.includes(NAME), before.join(", ") || "(empty)");

// ── every channel the store accepts must have a field ──────────────────────
await page.click(".cc-bar .cc-btn");
await page.waitForTimeout(500);
const fields = await page.$$eval(".cc-chan-edit input", (n) => n.length);
check("the editor offers every channel", fields === 15, `${fields} fields`);

// ── a bad value is refused, with the store's own reason ────────────────────
await page.fill(".cc-field input", NAME);
await page.fill(field("email"), "not-an-email");
const refusal = await saveAndWait();
check("a bad value is refused", refusal.startsWith("error"), refusal);
check("the refusal says what was wrong", /email address/i.test(refusal), refusal);
check("nothing was created by the refused save", !(await rows()).includes(NAME));

// ── fix it and save for real, across three channel kinds ───────────────────
await page.fill(field("email"), "fixture@example.com");
await page.fill(field("instagram"), "zz_fixture");
await page.fill(field("whatsapp"), "+15550001111");
await page.fill(".cc-field textarea", "Created by _verify-contacts.mjs");
const saved = await saveAndWait();
check("a valid contact saves", (await rows()).includes(NAME), saved || (await rows()).join(", "));

const channelLabels = await page.$$eval(".cc-chan article span", (n) => n.map((x) => x.textContent));
check("handle, address and phone channels all persist", channelLabels.length === 3, channelLabels.join(" | "));
check("notes persist", (await page.$eval(".cc-note p", (n) => n.textContent).catch(() => "")).includes("_verify-contacts"));

// ── edit: rename, drop a channel ───────────────────────────────────────────
await page.evaluate(() => [...document.querySelectorAll(".cc-actions .cc-btn")].find((b) => b.textContent.trim() === "Edit")?.click());
await page.waitForSelector(".cc-chan-edit input", { timeout: 10000 });
await page.fill(field("whatsapp"), "");            // clearing must actually remove it
await saveAndWait();
const afterEdit = await page.$$eval(".cc-chan article span", (n) => n.map((x) => x.textContent));
check("a cleared channel is removed, not silently kept", afterEdit.length === 2, afterEdit.join(" | "));

// ── search ─────────────────────────────────────────────────────────────────
await page.fill(".cc-bar input", "zz_fixture");
await page.waitForTimeout(400);
check("search finds a person by handle", (await rows()).includes(NAME), (await rows()).join(", "));
await page.fill(".cc-bar input", "");
await page.waitForTimeout(400);

// ── delete asks first, then works (this route used to answer 415 forever) ──
const selectedFixture = await page.evaluate((name) => {
  const row = [...document.querySelectorAll(".cc-row")].find((r) => r.textContent.includes(name));
  if (!row) return false;
  row.click();
  return true;
}, NAME);
await page.waitForTimeout(700);
// Refuse to arm a delete unless the dossier on screen is demonstrably the fixture. The first draft
// of this script clicked "Delete" on whatever happened to be selected when its own row was missing,
// which pointed a destructive action at a real contact. A test may not be able to do that.
const dossierName = await page.$eval(".cc-id h3", (n) => n.textContent.trim()).catch(() => "");
if (!selectedFixture || dossierName !== NAME) {
  fail.push(`REFUSING to test delete — the dossier shows "${dossierName}", not the fixture. Nothing was deleted.`);
  console.log(`\n${"=".repeat(64)}`);
  for (const item of pass) console.log(`  PASS  ${item}`);
  for (const item of fail) console.log(`  FAIL  ${item}`);
  await browser.close();
  process.exit(1);
}
const buttons = () => page.$$eval(".cc-actions .cc-btn", (n) => n.map((x) => x.textContent.trim()));
await page.evaluate(() => [...document.querySelectorAll(".cc-actions .cc-btn")].find((b) => b.textContent.trim() === "Delete")?.click());
await page.waitForTimeout(400);
check("delete asks before destroying", (await buttons()).some((label) => label.startsWith("Delete Zz")), (await buttons()).join(", "));
await page.evaluate(() => [...document.querySelectorAll(".cc-actions .cc-btn")].find((b) => b.textContent.trim().startsWith("Delete Zz"))?.click());
await page.waitForFunction((name) => ![...document.querySelectorAll(".cc-row strong")].some((n) => n.textContent.includes(name)), NAME, { timeout: 15000 }).catch(() => {});
check("delete works", !(await rows()).includes(NAME), (await message()) || (await rows()).join(", "));
check("nothing else was disturbed", (await rows()).length === before.length, `${before.length} before, ${(await rows()).length} after`);

console.log(`\n${"=".repeat(64)}`);
for (const item of pass) console.log(`  PASS  ${item}`);
for (const item of fail) console.log(`  FAIL  ${item}`);
console.log(`${"=".repeat(64)}\n${fail.length ? `${fail.length} CHECK(S) FAILED` : `all ${pass.length} checks passed`}`);

await browser.close();
process.exit(fail.length ? 1 : 0);
