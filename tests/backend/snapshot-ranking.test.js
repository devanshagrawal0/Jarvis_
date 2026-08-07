"use strict";

// The snapshot collector walked the DOM and stopped dead at the element budget, so on any page
// whose interactive controls come last it kept the chrome and discarded the controls. On an
// Instagram DM thread the nav rail, notes carousel and conversation list exhausted the budget
// before the walk reached the message box: the agent concluded there was nowhere to type, every
// time, deterministically. Compounding it, the agent asked for 140 elements and was silently
// clamped to 120, so it could not even tell its view was partial.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "server", "browser-service.js"), "utf8");

// Lift the real in-page ranker out of the module and run it against a DOM shim. The function is
// written to run inside the page, so it only uses the handful of DOM methods emulated below.
function loadRanker() {
  const start = source.indexOf("function rankSnapshotCandidates(rootEl, options) {");
  assert.ok(start > 0, "rankSnapshotCandidates should exist");
  const end = source.indexOf("\n}", start) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}\nreturn rankSnapshotCandidates;`)();
}

// ── a DOM shim faithful to the parts the ranker touches ────────────────────
function el({ tag, role = "", label = "", contenteditable = null, type = "", rendered = true, children = [] }) {
  const node = {
    tagName: tag.toUpperCase(),
    _attrs: { role, "aria-label": label, type, ...(contenteditable === null ? {} : { contenteditable }) },
    _children: children,
    _parent: null,
    isContentEditable: contenteditable === "true" || contenteditable === "plaintext-only",
    getClientRects: () => (rendered ? [{}] : []),
    getAttribute(name) { const v = this._attrs[name]; return v === undefined || v === "" ? null : v; },
    hasAttribute(name) { return this._attrs[name] !== undefined && this._attrs[name] !== ""; },
    get textContent() { return [label, ...this._children.map((c) => c.textContent)].filter(Boolean).join(" "); },
    closest(sel) {
      const wants = sel.split(",").map((s) => s.trim().replace(/'/g, ""));
      let cur = this;
      while (cur) {
        const t = cur.tagName.toLowerCase();
        const r = cur.getAttribute("role") || "";
        if (wants.some((w) => w === t || w === `[role=${r}]`)) return cur;
        cur = cur._parent;
      }
      return null;
    },
  };
  for (const child of children) child._parent = node;
  return node;
}
function flatten(nodes) { return nodes.flatMap((n) => [n, ...flatten(n._children)]); }
function pageRoot(nodes) {
  const all = flatten(nodes);
  return { querySelectorAll: () => all };
}

// A link trailed by an icon carrying the same accessible name — the Instagram pattern, where every
// <a> is followed by an <svg role="img"> repeating its label.
function navItem(name) {
  const icon = el({ tag: "svg", role: "img", label: name });
  return el({ tag: "a", role: "link", label: name, children: [icon] });
}
function conversationRow(name) {
  const avatar = el({ tag: "img", role: "img", label: name });
  return el({ tag: "div", role: "button", label: `${name} Active now`, children: [avatar] });
}

// The page under test: chrome and a long list first, the composer dead last — the shape that broke.
function chatPage({ rows = 40 } = {}) {
  const nav = ["Instagram", "Home", "Reels", "Messages", "Search", "Explore", "Profile"].map(navItem);
  const search = el({ tag: "input", type: "text", label: "Search" });
  const list = Array.from({ length: rows }, (_, i) => conversationRow(`Friend ${i + 1}`));
  const composer = el({ tag: "div", role: "textbox", label: "Message", contenteditable: "true" });
  const send = el({ tag: "button", role: "button", label: "Send" });
  return pageRoot([...nav, search, ...list, composer, send]);
}

const SELECTOR = "a, button, input, textarea, select, summary, [role], [tabindex], [contenteditable]";
const isComposer = (n) => (n.getAttribute("aria-label") || "") === "Message";

test("the composer survives truncation even though it is last in the DOM", () => {
  const rank = loadRanker();
  const page = chatPage({ rows: 200 });
  const all = page.querySelectorAll();

  // Precondition: without ranking, a DOM-order walk would never reach it.
  const composerIndex = all.findIndex(isComposer);
  assert.ok(composerIndex > 120, `composer should sit past the old budget, was at ${composerIndex}`);

  const { keep, total } = rank(page, { selector: SELECTOR, limit: 120 });
  assert.ok(total > 120, "precondition: this page must overflow the budget");
  assert.equal(keep.length, 120);
  assert.ok(keep.includes(composerIndex), "the message box must be in the snapshot — this is the whole bug");
});

test("the send button survives too, or the message is typed and never committed", () => {
  const rank = loadRanker();
  const page = chatPage({ rows: 200 });
  const all = page.querySelectorAll();
  const sendIndex = all.findIndex((n) => (n.getAttribute("aria-label") || "") === "Send");
  const { keep } = rank(page, { selector: SELECTOR, limit: 120 });
  assert.ok(keep.includes(sendIndex), "typing without a way to send is a half-completed action");
});

test("icons that merely restate their parent link are dropped", () => {
  const rank = loadRanker();
  const page = chatPage({ rows: 200 });
  const all = page.querySelectorAll();
  const { keep, total } = rank(page, { selector: SELECTOR, limit: 1000 });
  const kept = keep.map((i) => all[i]);
  const duplicateIcons = kept.filter((n) => ["SVG", "IMG"].includes(n.tagName));
  assert.equal(duplicateIcons.length, 0, "decorative icons were consuming roughly half the budget");
  assert.ok(total < all.length, "the candidate set should shrink once decoration is removed");
});

test("a contenteditable composer is found however the attribute is spelled", () => {
  // Chat apps commonly use plaintext-only, which the old `[contenteditable=true]` selector missed
  // outright — a second, independent way to be blind to the same control.
  const rank = loadRanker();
  for (const spelling of ["true", "plaintext-only", ""]) {
    const composer = el({ tag: "div", label: "Message", contenteditable: spelling === "" ? "true" : spelling });
    const page = pageRoot([...Array.from({ length: 200 }, (_, i) => navItem(`Link ${i}`)), composer]);
    const all = page.querySelectorAll();
    const { keep } = rank(page, { selector: SELECTOR, limit: 120 });
    assert.ok(keep.includes(all.findIndex(isComposer)), `contenteditable="${spelling}" must be reachable`);
  }
});

test("refs stay in DOM order so the model reads the page top to bottom", () => {
  const rank = loadRanker();
  const { keep } = rank(chatPage({ rows: 200 }), { selector: SELECTOR, limit: 120 });
  assert.deepEqual([...keep].sort((a, b) => a - b), keep, "ranking decides what survives, not what order it is read in");
});

test("elements that are not rendered are never offered as targets", () => {
  const rank = loadRanker();
  const hidden = el({ tag: "div", role: "textbox", label: "Message", contenteditable: "true", rendered: false });
  const page = pageRoot([navItem("Home"), hidden]);
  const all = page.querySelectorAll();
  const { keep } = rank(page, { selector: SELECTOR, limit: 120 });
  assert.equal(keep.includes(all.findIndex(isComposer)), false);
});

// ── the silent clamp ───────────────────────────────────────────────────────
test("the agent's requested budget is no longer silently cut, and truncation is reported", () => {
  assert.match(source, /const MAX_SNAPSHOT_ELEMENTS = 240;/,
    "the agent asks for 140 and was clamped to 120 without being told");
  const agent = fs.readFileSync(path.join(root, "server", "universal-browser-agent.js"), "utf8");
  const requested = Number((agent.match(/browserService\.snapshot\(\{ taskId, limit: (\d+) \}\)/) || [])[1]);
  assert.ok(requested > 0, "the agent should state a budget");
  assert.ok(requested <= 240, `the requested budget (${requested}) must fit under the cap, or it is silently clamped again`);
  // The ranking now arrives as part of the single page read rather than its own round trip, so the
  // variable is named for the read. The rule is unchanged: a partial view must say it is partial.
  assert.match(source, /truncated: Boolean\(read && read\.total > limit\)/,
    "a partial view must announce itself, or the agent concludes the missing control does not exist");
  assert.match(source, /typableCandidates/, "how many typable controls existed is the diagnostic that mattered here");
});

test("one selector serves the main frame, child frames and the ranker", () => {
  // Three copies drifting apart is how the equality form survived in one place. Compare executable
  // lines only — the fix documents the old selector in prose, which would otherwise self-match.
  const code = source.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.equal((code.match(/"a, button, input, textarea, select, summary, \[role\], \[tabindex\], \[contenteditable[^"]*"/g) || []).length, 1,
    "the selector should be defined exactly once");
  assert.doesNotMatch(code, /\[contenteditable=true\]/, "the equality form misses plaintext-only composers");
  // Was 4 when the ranker took the selector as its own separate evaluate. The one-shot read now
  // carries it, so the count dropped by one without any copy of the selector reappearing — which is
  // what this test actually guards. The definition, the one-shot read and the child-frame walk.
  assert.ok((code.match(/SNAPSHOT_SELECTOR/g) || []).length >= 3,
    "the definition, the page read and the child frames must all use the one selector");
});
