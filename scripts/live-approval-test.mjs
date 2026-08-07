// Live end-to-end test of the approval path, through the real UI.
//
// This is the reported failure re-run for real: ask JARVIS to send a message, wait for the approval
// card, press Approve, and see whether anything happens. It drives the actual React surface at
// :5173 against the actual backend, so it exercises the commit gate, the confirmation store, the
// HTTP approve route, the action-fabric continuation, and the card — the whole chain, not a mock.
//
//   node scripts/live-approval-test.mjs "<recipient>" "<message>"
//
// Recipient comes from the command line so no account name lives in the repository. Aim it at your
// own account: this sends a real, unrecallable message.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SHOT_DIR || path.join(ROOT, "runtime", "live-approval");
fs.mkdirSync(OUT, { recursive: true });

const RECIPIENT = process.argv[2];
const MESSAGE = process.argv[3] || `jarvis approval test ${new Date().toISOString().slice(11, 19)}`;
// The handle to confirm if the run stops to ask which person was meant. Without it the run only
// proceeds when there is exactly one candidate — it will not choose between people on its own.
const CONFIRM_HANDLE = process.argv[4] || "";
const UI = process.env.JARVIS_UI || "http://localhost:5173";
const API = process.env.JARVIS_API || "http://127.0.0.1:8799";
if (!RECIPIENT) { console.error('usage: node scripts/live-approval-test.mjs "<recipient>" ["<message>"]'); process.exit(1); }

const REQUEST = `send ${JSON.stringify(MESSAGE)} to ${RECIPIENT} on instagram`;
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
const log = (...a) => console.log(at(), ...a);
const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`shot -> ${file}`);
  return file;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });

// Every backend call this run makes, so "nothing happened" can be distinguished from "the call was
// made and the answer was dropped" — which is exactly what the bug turned out to be.
const calls = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!/\/api\//.test(url)) return;
  let body = "";
  try { body = (await res.text()).slice(0, 4000); } catch { /* streamed */ }
  calls.push({ atMs: Date.now() - t0, url: url.replace(API, ""), status: res.status(), body });
  if (/confirmations|capabilities|jarvis/.test(url)) log(`  ← ${res.status()} ${url.replace(API, "").slice(0, 70)}`);
});
page.on("console", (m) => { if (m.type() === "error") log("  page error:", m.text().slice(0, 140)); });

const cardState = () => page.evaluate(() => {
  const el = document.querySelector(".jr-approval");
  if (!el) return null;
  const q = (sel) => el.querySelector(sel)?.textContent?.trim() || "";
  return {
    head: q(".jr-approval-head"),
    intent: q(".jr-approval-intent"),
    tool: q(".jr-approval-tool"),
    caveat: q(".jr-approval-caveat"),
    facts: [...el.querySelectorAll(".jr-approval-fact")].map((f) => f.textContent.trim()),
    dump: q(".jr-approval-summary"),
    approveLabel: el.querySelector(".jr-approve")?.textContent?.trim() || "",
    approveDisabled: el.querySelector(".jr-approve")?.disabled ?? null,
  };
});
// A run that cannot tell two people apart does not fail — it asks. That question renders as a
// contact-choice card, NOT an approval card, and this harness only ever watched for the approval
// card. So every "which one did you mean?" looked identical to "nothing happened", and at least one
// run was recorded as a failure when it had actually asked a perfectly good question.
const choiceState = () => page.evaluate(() => {
  const el = document.querySelector(".jr-contact-choice");
  if (!el) return null;
  return {
    title: el.querySelector(".jr-card-title")?.textContent?.trim() || "",
    body: el.querySelector(".jr-card-body")?.textContent?.trim() || "",
    candidates: [...el.querySelectorAll(".jr-contact-option")].map((option) => ({
      name: option.querySelector(".jr-contact-name")?.textContent?.trim() || "",
      handle: option.querySelector(".jr-contact-handle")?.textContent?.trim() || "",
      detail: option.querySelector(".jr-contact-detail")?.textContent?.trim() || "",
      hasAvatar: Boolean(option.querySelector("img.jr-contact-avatar")),
    })),
  };
});

const waitFor = async (fn, ms, label) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await page.waitForTimeout(1500);
  }
  log(`TIMEOUT waiting for ${label} after ${ms / 1000}s`);
  return null;
};

log(`request: ${REQUEST}`);
await page.goto(UI, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);                      // boot sequence + widget mount
await shot(page, "01-loaded");

// The backend rejects the FIRST mutation from a brand-new session (`session.isNew`), so a fresh
// automation browser gets a 401 on submit unless it has already made a GET. A real person never
// hits this because the app has been open and polling; this harness has not.
const established = await page.evaluate(async () => {
  const first = await fetch("/api/confirmations/pending", { credentials: "same-origin" });
  await new Promise((r) => setTimeout(r, 600));
  const second = await fetch("/api/confirmations/pending", { credentials: "same-origin" });
  return { first: first.status, second: second.status };
});
log(`session established: ${JSON.stringify(established)}`);
await page.waitForTimeout(1000);

const input = page.locator("textarea.jcb-input");
await input.waitFor({ state: "visible", timeout: 30000 });
await input.click();
await input.fill(REQUEST);
await page.keyboard.press("Enter");
log("submitted");

// ── 1. the card ─────────────────────────────────────────────────────────────
// A real run is a chain of DOM snapshots and planner calls against a live site; the first attempt
// gave up at 4 minutes while the agent was still working through the inbox.
// Either outcome is a real answer: the run either reaches the send and asks for approval, or it
// cannot tell two people apart and asks which one. Watching for only one of them is how a working
// question got filed as a broken run.
const settled = await waitFor(async () => (await cardState()) || (await choiceState()), 600000, "the approval card or an identity question");
let choice = settled && settled.candidates ? settled : null;
let cardAfterPick = null;
if (choice) {
  await shot(page, "02-identity-question");
  log(`IDENTITY QUESTION at ${at()}: ${choice.title}`);
  choice.candidates.forEach((candidate, index) => {
    log(`  [${index + 1}] ${candidate.name} ${candidate.handle} ${candidate.detail}${candidate.hasAvatar ? "  (photo)" : ""}`);
  });

  // Answering it is the point of the flow: the owner recognises the person, picks, and the choice
  // is remembered so the question is never asked again. Only ever picks a candidate the caller
  // named, or the sole candidate — choosing for the owner among several is the one thing this card
  // exists to prevent.
  const wanted = CONFIRM_HANDLE.replace(/^@/, "").toLowerCase();
  const index = wanted
    ? choice.candidates.findIndex((candidate) => candidate.handle.replace(/^@/, "").toLowerCase() === wanted)
    : (choice.candidates.length === 1 ? 0 : -1);
  if (index < 0) {
    log(wanted ? `No candidate matched ${CONFIRM_HANDLE} — nothing picked, nothing sent.` : "Several candidates and none named — nothing picked, nothing sent.");
    fs.writeFileSync(path.join(OUT, "transcript.json"), JSON.stringify({ request: REQUEST, choice, calls }, null, 2));
    await browser.close();
    process.exit(0);
  }
  const pickedAt = Date.now();
  log(`picking [${index + 1}] ${choice.candidates[index].handle} — this saves the contact and re-runs the send`);
  await page.locator(".jr-contact-option").nth(index).click();
  cardAfterPick = await waitFor(cardState, 600000, "the approval card after picking");
  log(`after picking: ${cardAfterPick ? "approval card" : "TIMEOUT"} in ${((Date.now() - pickedAt) / 1000).toFixed(1)}s`);
  if (!cardAfterPick) {
    await shot(page, "03-no-card-after-pick");
    fs.writeFileSync(path.join(OUT, "transcript.json"), JSON.stringify({ request: REQUEST, choice, calls }, null, 2));
    await browser.close();
    process.exit(1);
  }
}
const card = cardAfterPick || settled;
if (!card) {
  await shot(page, "02-no-card");
  log("RESULT: no approval card appeared. Transcript:");
  console.log(JSON.stringify(calls.slice(-8), null, 2));
  await browser.close();
  process.exit(1);
}
await shot(page, "02-card");
log("CARD:");
console.log(JSON.stringify(card, null, 2));

// ── 2. approve ──────────────────────────────────────────────────────────────
const before = calls.length;
await page.locator(".jr-approve").first().click();
log("clicked Approve");
await page.waitForTimeout(1200);
await shot(page, "03-approving");
log(`busy label now: ${JSON.stringify(await page.locator(".jr-approve").first().textContent().catch(() => ""))}`);

// Settled = the card is gone (finished, one way or the other) or a NEW card replaced it.
const outcome = await waitFor(async () => {
  const now = await cardState();
  if (!now) return { kind: "card-cleared" };
  if (now.intent !== card.intent || now.facts.join() !== card.facts.join()) return { kind: "second-card", card: now };
  if (now.approveLabel && !/working/i.test(now.approveLabel) && now.approveDisabled === false) {
    const approve = calls.slice(before).find((c) => /\/approve$/.test(c.url));
    if (approve) return { kind: "same-card-still-there", approve };
  }
  return null;
}, 600000, "the run to settle after approval");

await page.waitForTimeout(2500);
await shot(page, "04-after-approve");

const responseText = await page.evaluate(() => document.querySelector(".jr-response, .jr-panel")?.textContent?.slice(-1200) || "");
const approveCall = calls.slice(before).find((c) => /\/approve$/.test(c.url));

log("\n=== OUTCOME ===");
log(`settled as        : ${outcome?.kind || "TIMEOUT"}`);
log(`approve HTTP      : ${approveCall ? `${approveCall.status}` : "NO CALL WAS MADE"}`);
if (approveCall) log(`approve body      : ${approveCall.body.slice(0, 600)}`);
if (outcome?.kind === "second-card") log(`second card       : ${JSON.stringify(outcome.card, null, 2)}`);
log(`panel tail        : ${responseText.replace(/\s+/g, " ").slice(-400)}`);

fs.writeFileSync(path.join(OUT, "transcript.json"), JSON.stringify({ request: REQUEST, card, outcome, calls }, null, 2));
log(`transcript -> ${path.join(OUT, "transcript.json")}`);

// ── 3. did the message actually arrive ──────────────────────────────────────
try {
  const pending = await (await fetch(`${API}/api/confirmations/pending`)).json().catch(() => ({}));
  log(`pending confirmations left: ${(pending.confirmations || []).length}`);
} catch { /* session-gated from here is fine */ }

await browser.close();
