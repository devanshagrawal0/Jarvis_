"use strict";

// B-01 / B-02 regression: the gate that is supposed to catch "Jarvis claimed it did something
// it didn't" must be capable of failing.
//
// As shipped it could not. `hasVerifiedEvidence` returned true for ANY tool result with
// `ok: true` — the default branch was a bare `return true` — so one successful `memory_search`
// licensed any claim in the same turn. And `claimsUnverifiedCompletion` contained no
// send/post/write/delete verbs, so the highest-consequence fabrications were not even candidates.
//
// The anchor case is verbatim from the owner's production log:
//   user:   "you didnt tex him hi do it insta and his chat is open"
//   jarvis: "I have typed \"hi\" and pressed enter in the open chat window for you, Dev."
//   user:   "your lying now"
//
// Every assertion here is written to go red against the original implementation.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// server.js boots a live server on require, so the pure predicates are extracted and evaluated
// in isolation. They are self-contained functions over strings and arrays — no I/O, no state.
function loadGatePredicates() {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  const wanted = [
    "const I_DID =",
    "const STRONG_ACTION =",
    "const WEAK_ACTION =",
    "const ACTION_SURFACE =",
    "const SIDE_EFFECT_TOOL =",
    "const TOOL_SELF_REPORTED_FAILURE =",
    "function toolSubstantiatesAction(",
    "function hasVerifiedEvidence(",
    "const OUTWARD_ACTION_CLAIM =",
    "function claimsOutwardAction(",
    "function claimsUnverifiedCompletion(",
  ];
  let code = "";
  for (const marker of wanted) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `could not find ${marker} in server.js — the gate was renamed or removed`);
    if (marker.startsWith("const")) {
      // Declarations may span lines (`new RegExp(` … `);`), so scan to the semicolon that ends
      // the statement with parens balanced rather than assuming one line.
      let depth = 0; let end = -1;
      for (let i = start; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        else if (ch === ";" && depth === 0) { end = i + 1; break; }
      }
      assert.ok(end > start, `could not find the end of ${marker}`);
      code += `${source.slice(start, end)}\n`;
      continue;
    }
    // These are top-level declarations, so the body ends at the first line that is exactly "}".
    // (Brace-counting from the first "{" is wrong here — it latches onto the destructuring
    // parameter list, e.g. `function hasVerifiedEvidence({ toolResults = [] })`, and truncates
    // the function to its own signature.)
    const end = source.indexOf("\n}\n", start);
    assert.ok(end > start, `could not find the closing brace for ${marker}`);
    code += `${source.slice(start, end + 2)}\n`;
  }
  const context = { module: {}, exports: {} };
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.api = { hasVerifiedEvidence, claimsUnverifiedCompletion, claimsOutwardAction, toolSubstantiatesAction };`, context);
  return context.api;
}

const gate = loadGatePredicates();

const OK_LOOKUP = { tool: "memory_search", ok: true, result: { hits: 3 } };
const OK_VAULT = { tool: "neural_vault_context", ok: true, result: { memories: [] } };
const OK_SCREEN = { tool: "screen_capture", ok: true, result: { width: 1440 } };
const OK_SEND = { tool: "computer_use", ok: true, result: { ok: true, task: "typed hi and pressed enter", steps: 4 } };

test("B-02 — the fabrication detector recognises send/post/write/delete claims", () => {
  const fabrications = [
    'I have typed "hi" and pressed enter in the open chat window for you, Dev.',
    "I've sent the message to AJ on Instagram.",
    "I messaged Raghav Mittal for you.",
    "I posted that to your feed.",
    "I deleted the file from your Desktop.",
    "I saved the document to your Desktop.",
    "I've replied to the email.",
    "I liked the latest Sidemen video.",
    "The message has been sent.",
    "I created the file for you.",
  ];
  for (const text of fabrications) {
    assert.equal(gate.claimsOutwardAction(text), true, `not recognised as an outward-action claim: ${text}`);
    assert.equal(gate.claimsUnverifiedCompletion(text), true, `gate would let this through: ${text}`);
  }
});

test("B-02 — honest refusals and questions are NOT treated as fabrications", () => {
  const honest = [
    "I could not complete the requested action.",
    "I can't send that from here — open Instagram and I'll prepare the draft.",
    "Would you like me to send it?",
    "The Like is prepared and waiting for your approval.",
    "I opened Instagram Direct, but I could not verify the conversation.",
    "Instagram Direct requires authentication, Dev.",
  ];
  for (const text of honest) {
    assert.equal(gate.claimsOutwardAction(text), false, `honest answer wrongly flagged as a fabrication: ${text}`);
  }
});

test("B-01 — an unrelated successful lookup does NOT substantiate an outward action", () => {
  // This is the whole defect: something succeeded, therefore anything may be claimed.
  for (const lookup of [OK_LOOKUP, OK_VAULT, OK_SCREEN]) {
    assert.equal(
      gate.hasVerifiedEvidence({ toolResults: [lookup], actionClaim: true }), false,
      `${lookup.tool} was accepted as proof that an outward action occurred`,
    );
  }
  // …and grounding sources / screenshots prove a fact, never a side effect.
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [], sources: [{ url: "https://example.com" }], actionClaim: true }), false);
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [], imageData: "data:image/png;base64,AAAA", actionClaim: true }), false);
});

test("B-01 — a side-effecting tool that genuinely succeeded DOES substantiate the claim", () => {
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [OK_SEND], actionClaim: true }), true,
    "a real computer_use success must still be accepted, or the gate becomes a mute button");
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [OK_LOOKUP, OK_SEND], actionClaim: true }), true);
});

test("B-01 — a side-effecting tool that admits it could not verify is not evidence", () => {
  // The automation stack says this out loud; it must not read as success.
  const unverified = { tool: "computer_use", ok: true, result: { message: "computer_use completed without verifying the requested outcome." } };
  assert.equal(gate.toolSubstantiatesAction(unverified), false);
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [unverified], actionClaim: true }), false);

  const noJson = { tool: "computer_use", ok: true, result: { error: "The browser planner returned no JSON object." } };
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [noJson], actionClaim: true }), false);

  const flagged = { tool: "browser_send", ok: true, result: { verified: false } };
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [flagged], actionClaim: true }), false);
});

test("B-01 — non-action claims keep their original, looser evidence rule", () => {
  // Read-only questions must not get stricter, or ordinary answers start being blocked.
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [OK_LOOKUP], actionClaim: false }), true);
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [], sources: [{ url: "https://example.com" }], actionClaim: false }), true);
  assert.equal(gate.hasVerifiedEvidence({ toolResults: [{ tool: "web_research", ok: true, result: { sources: [] } }], actionClaim: false }), false,
    "research with zero sources was never evidence and must stay that way");
});

test("the production incident, end to end", () => {
  const response = 'I have typed "hi" and pressed enter in the open chat window for you, Dev.';
  const toolResults = [OK_LOOKUP]; // what the turn actually had: a successful lookup, no send
  const actionClaim = gate.claimsOutwardAction(response);
  assert.equal(actionClaim, true, "the claim must be recognised");
  assert.equal(gate.hasVerifiedEvidence({ toolResults, actionClaim }), false, "the gate must refuse to license it");
});
