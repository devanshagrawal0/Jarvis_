"use strict";

// End-to-end verification of the messaging automation pipeline against a real browser.
//
// Everything else in this suite tests modules in isolation. That is how a green suite coexisted
// with an automation lane that had never once delivered a message: unit tests proved functions
// behaved, and nobody proved a message landed. These tests drive the REAL browser-service against
// a real Chromium instance loading a real page, and assert on the page's own record of what it
// received.
//
// The fixture (tests/fixtures/chat-harness/index.html) reproduces the conditions that actually
// defeated the automation, not convenient ones: the composer is last in the DOM behind a 60-row
// conversation list, it is a contenteditable div rather than an input, every row carries a
// decorative avatar that duplicates its label, and searching surfaces a GROUP thread containing
// the queried person ahead of the 1:1 thread.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createBrowserAutomationService } = require("../../server/browser-service");
const { resolveEntity, hintsForOutcome } = require("../../server/automation/entity-resolver");
const { deterministicDecision } = require("../../server/universal-browser-agent");

const FIXTURE = path.join(__dirname, "..", "fixtures", "chat-harness", "index.html");

// Serve the fixture over http:// rather than file://, so the page runs under a normal origin.
function startServer() {
  const html = fs.readFileSync(FIXTURE);
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

let ctx = null;

test.before(async () => {
  const { server, url } = await startServer();
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-harness-"));
  const browser = createBrowserAutomationService({
    runtimeDir,
    headless: true,
    channel: undefined,          // bundled Chromium, not the owner's Chrome profile
    interactiveLogin: false,
  });
  ctx = { server, url, runtimeDir, browser };
  await browser.navigate({ url, taskId: "harness" });
});

test.after(async () => {
  if (!ctx) return;
  try { await ctx.browser.close(); } catch { /* already closed */ }
  await new Promise((r) => ctx.server.close(r));
  try { fs.rmSync(ctx.runtimeDir, { recursive: true, force: true }); } catch { /* locked */ }
});

const findRef = (snapshot, predicate) => (snapshot.elements || []).find(predicate);
// browser-service resolves `name` from aria-label first (browser-service.js:113), so it is the
// stable identity for an element. Concatenating name + text instead produced "Tg Tg Active 1m ago"
// and broke every equality match — a defect in the test, which is what a harness is for.
const nameOf = (el) => String(el?.name || "").trim();
const labelOf = (el) => [el.name, el.text, el.ariaLabel, el.placeholder].filter(Boolean).join(" ");

test("the snapshot reaches the composer despite a long conversation list", async () => {
  // This is the composer-blindness bug, verified against a real DOM rather than a shim.
  await ctx.browser.navigate({ url: ctx.url, taskId: "harness" });
  const list = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });
  const row = findRef(list, (el) => nameOf(el) === "Tg");
  assert.ok(row, "the 1:1 Tg thread must be visible in the inbox snapshot");

  await ctx.browser.click({ taskId: "harness", ref: row.ref });
  const open = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });

  const composer = findRef(open, (el) => nameOf(el) === "Message");
  assert.ok(composer, "the composer must appear in the snapshot — this is the bug that made sends impossible");
  const send = findRef(open, (el) => nameOf(el) === "Send");
  assert.ok(send, "the send control must survive truncation alongside the composer");
});

test("decorative avatars do not consume the element budget", async () => {
  await ctx.browser.navigate({ url: ctx.url, taskId: "harness" });
  const snap = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });
  const decorative = (snap.elements || []).filter((el) => /^img$/i.test(el.tag || "") && /^Contact \d+$/.test(labelOf(el).trim()));
  assert.equal(decorative.length, 0,
    "avatars repeating their row's own name carry no new information and were eating half the budget");
});

test("searching for a person surfaces the group first, and the resolver refuses it", async () => {
  // The exact trap: the group thread containing Tg outranks the 1:1 thread in search results.
  await ctx.browser.navigate({ url: ctx.url, taskId: "harness" });
  const base = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });
  const search = findRef(base, (el) => /^input$/i.test(el.tag || "") && nameOf(el) === "Search");
  assert.ok(search, "the fixture must expose a search field");

  await ctx.browser.type({ taskId: "harness", ref: search.ref, value: "tg" });
  const results = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });

  const rows = (results.elements || []).filter((el) => /button/i.test(el.role || "") && /tg/i.test(nameOf(el)));
  assert.ok(rows.length >= 2, "search should return both the group and the individual");
  assert.match(nameOf(rows[0]), /Anjali/, "precondition: the group ranks first, as it did on Instagram");

  // Both the group and the individual match. The individual must win.
  const picked = resolveEntity("tg", rows, { singleRecipient: true });
  assert.equal(picked.status, "resolved");
  assert.equal(nameOf(picked.match), "Tg",
    "the 1:1 thread must be chosen over the group that also contains Tg");

  // And when the group is the ONLY match — the real Instagram case — it must refuse outright.
  const groupsOnly = rows.filter((el) => /Anjali/.test(nameOf(el)));
  const refused = resolveEntity("tg", groupsOnly, { singleRecipient: true });
  assert.notEqual(refused.status, "resolved", "a single-recipient send must never resolve to a group");
  assert.match(refused.reason, /group/i);
});

test("the agent opens the thread already in the inbox instead of searching", async () => {
  // The strategy error behind the original failure. The inbox already contained a 1:1 thread with
  // the named person, and the agent typed the name into search anyway — where the group thread
  // outranked the individual. Searching was never necessary; it was the step that created the
  // hazard the resolver then had to refuse.
  //
  // This asserts the choice against a REAL snapshot of the inbox, so it stays honest about
  // truncation and element ordering rather than testing a curated list of four elements.
  await ctx.browser.navigate({ url: ctx.url, taskId: "harness" });
  const inbox = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });

  const search = findRef(inbox, (el) => /^input$/i.test(el.tag || "") && nameOf(el) === "Search");
  assert.ok(search, "precondition: a search field is available, so searching is a live option");
  const tg = findRef(inbox, (el) => nameOf(el) === "Tg");
  const group = findRef(inbox, (el) => /^Anjali Monga, Tg and Ignacio$/.test(nameOf(el)));
  assert.ok(tg && group, "precondition: both the individual and the group are visible in the inbox");

  const outcome = { entities: { people: ["tg"], messageValues: ["hi"] }, commit: { required: true } };
  const decision = deterministicDecision({
    outcome,
    snapshot: inbox,
    history: [],
    entityHints: hintsForOutcome(outcome, inbox),
  });

  assert.ok(decision, "the fast path should decide this without spending a planner call");
  const first = decision.actions[0];
  assert.equal(first.action, "click", "the thread is already present; typing into search is a detour into ambiguity");
  assert.notEqual(first.ref, search.ref, "it must not fill or click the search field");
  assert.notEqual(first.ref, group.ref, "and never the group thread");
  assert.equal(first.ref, tg.ref, "it must open the 1:1 thread that is already on screen");
});

test("a message actually lands in the correct thread", async () => {
  // The assertion this whole exercise existed to make. The page records what it received; we
  // check the page, not the agent's own report of success.
  await ctx.browser.navigate({ url: ctx.url, taskId: "harness" });
  const inbox = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });
  const row = findRef(inbox, (el) => nameOf(el) === "Tg");
  assert.ok(row, "the Tg thread must be selectable");
  await ctx.browser.click({ taskId: "harness", ref: row.ref });

  const open = await ctx.browser.snapshot({ taskId: "harness", limit: 140 });
  const composer = findRef(open, (el) => nameOf(el) === "Message");
  const send = findRef(open, (el) => nameOf(el) === "Send");
  assert.ok(composer && send, "composer and send must both be addressable");

  await ctx.browser.type({ taskId: "harness", ref: composer.ref, value: "hi" });

  // browser-service refuses click() on a consequential control — "Use browser_commit so the user
  // can approve it" — which is the commit gate enforced at the driver, below the agent. Going
  // through commit() is what the real automation does once approval is held.
  await assert.rejects(
    () => ctx.browser.click({ taskId: "harness", ref: send.ref }),
    /consequential action/i,
    "the send control must not be clickable through the ordinary path",
  );
  await ctx.browser.commit({ taskId: "harness", action: "click", ref: send.ref });

  // Read the thread itself, not the whole page, so an unrelated "hi" could never satisfy this.
  const thread = await ctx.browser.extract({ taskId: "harness", selector: "#msgs" });
  // The thread opens with one incoming "hey"; a successful send appends "hi" as its own line.
  const lines = thread.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.includes("hi"),
    `the sent text must appear in the thread as its own message, not merely be claimed as sent (thread: ${JSON.stringify(thread.content)})`);
  assert.equal(lines.at(-1), "hi", "and it must be the most recent message in the thread");

  // And the composer must have been cleared, which is what the page does on a real send.
  const composerAfter = await ctx.browser.extract({ taskId: "harness", selector: "#composer" });
  assert.equal(composerAfter.content.trim(), "", "a genuine send clears the composer");
});
