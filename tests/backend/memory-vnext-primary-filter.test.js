"use strict";

// A-05 — the sensitivity denylist must not depend on who holds retrieval authority.
//
// `prepareCanaryContext` always routes with `providerClass: "local"`, and `route()` maps `local`
// to the full eligibility set {public, internal, private, restricted}. So the sensitivity filter
// is a no-op on this path. The guarded phase was protected only by `safeCanaryFact`'s prefix
// ALLOWLIST; the primary phase replaced that with `!requiresConfirmation`, which is freshness
// alone. The first turn after `POST /cutover/activate {domain:"retrieval_context"}` would have
// put restricted health, location and identity facts — plus raw imported chat transcript —
// straight into the prompt.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "server", "memory-vnext", "shadow-runtime.js"), "utf8");

// Lift the two filters out of the module. shadow-runtime's factory needs a live store, and the
// point of this test is the predicate logic, so evaluate the declarations directly.
function loadFilters() {
  const grab = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} should exist in shadow-runtime.js`);
    // Walk braces to the end of the declaration.
    let depth = 0;
    let i = source.indexOf("{", start);
    const open = i;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    assert.ok(i > open, `${name} should be a well-formed declaration`);
    return source.slice(start, i + 1);
  };
  const body = [grab("deniedForPrompt"), grab("primaryFact"), grab("safeCanaryFact")].join("\n\n");
  const allowlist = source.match(/const CANARY_ALLOWED = [^\n]+/);
  assert.ok(allowlist, "CANARY_ALLOWED should still be defined");
  // eslint-disable-next-line no-new-func
  return new Function(`${allowlist[0]}\n${body}\nreturn { primaryFact, safeCanaryFact };`)();
}

const fresh = (predicate, sensitivity = "restricted") => ({
  predicate,
  sensitivity,
  freshness: { requiresConfirmation: false },
});

// Every one of these is `requiresConfirmation: false`, so the old freshness-only filter admitted
// all of them. That is the mutation: revert primaryFact to `!fact?.freshness?.requiresConfirmation`
// and each of these assertions flips.
const MUST_NEVER_REACH_PROMPT = [
  "health.condition",
  "health.medication",
  "location.home_address",
  "location.current",
  "identity.legal_name",
  "identity.date_of_birth",
  "memory.conversation.turn",
];

test("A-05 — restricted classes stay out of the prompt after retrieval_context cuts over", () => {
  const { primaryFact } = loadFilters();
  for (const predicate of MUST_NEVER_REACH_PROMPT) {
    assert.equal(primaryFact(fresh(predicate)), false,
      `${predicate} must not be eligible under primary authority`);
  }
});

test("A-05 — cutover still relaxes the allowlist, which is the whole point of the switch", () => {
  const { primaryFact, safeCanaryFact } = loadFilters();
  // A fact outside the guarded prefix allowlist but in no denied class: guarded withholds it,
  // primary admits it. Without this the fix would just be the guarded filter under a new name.
  const relaxed = fresh("work.employer", "internal");
  assert.equal(safeCanaryFact(relaxed), false, "precondition: guarded phase withholds this");
  assert.equal(primaryFact(relaxed), true, "authority should admit non-denied facts");
});

test("A-05 — freshness is still enforced under primary authority", () => {
  const { primaryFact } = loadFilters();
  const stale = { predicate: "preference.coffee", freshness: { requiresConfirmation: true } };
  assert.equal(primaryFact(stale), false, "being authoritative does not make a fact current");
});

test("A-05 — identity.preferred_name remains the one identity fact allowed through", () => {
  const { primaryFact, safeCanaryFact } = loadFilters();
  const name = fresh("identity.preferred_name", "private");
  assert.equal(safeCanaryFact(name), true, "guarded phase already allows it");
  assert.equal(primaryFact(name), true, "cutover must not regress the one identity fact in use");
});

test("A-05 — the denylist is enforced in the filter, not left to route()", () => {
  // The original justification was that route() had already filtered by sensitivity. It had not:
  // providerClass "local" admits every sensitivity there is. Guard the justification too.
  assert.match(source, /providerClass: "local"/, "precondition: this path still routes as local");
  const start = source.indexOf("function primaryFact");
  const block = source.slice(start, start + 400);
  assert.match(block, /deniedForPrompt\(fact\)/,
    "primaryFact must apply the denylist itself rather than trusting the router");
});
