"use strict";

// The resolver could resolve a single-person request to a GROUP conversation.
//
// Found by tracing a real failure. `resolveEntity("tg", [group threads only])` returned
// status "resolved" against "Anjali Monga, Tg and Ignacio" at score 0.94, because with one ranked
// candidate there is no runner-up to produce a margin and the `!second` branch admits it. A send
// would have gone to three people, two of whom were never named.
//
// The one real run that reached this point refused only because several candidates happened to
// tie at identical scores, giving margin 0.000 — protection by accident of that result set, not
// by design. Instagram search returning a single matching group is entirely ordinary.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveEntity, hintsForOutcome } = require("../../server/automation/entity-resolver");

const el = (ref, name) => ({ ref, role: "button", name });

// What Instagram actually returned when searching "TG".
const SEARCH_RESULTS = [
  el("e1", "Anjali Monga, Tg and Ignacio"),
  el("e2", "Northeastern 2028 India"),
  el("e3", "ngas but on ig"),
  el("e4", "Dev Haters"),
];

// The inbox, where the 1:1 thread actually lives.
const INBOX = [
  el("i1", "Yash"),
  el("i2", "Tg"),
  el("i3", "Raghav Mittal"),
  el("i4", "Anjali Monga, Tg and Ignacio"),
];

test("a single-recipient send never resolves to a group thread", () => {
  const result = resolveEntity("tg", SEARCH_RESULTS, { singleRecipient: true });
  assert.notEqual(result.status, "resolved",
    "resolving here sends a private message to everyone in the group");
  assert.equal(result.match, undefined);
  assert.match(result.reason, /group/i, "the refusal must say why, so the agent can search elsewhere");
});

test("the individual is preferred when both a person and a group match", () => {
  const result = resolveEntity("tg", INBOX, { singleRecipient: true });
  assert.equal(result.status, "resolved");
  assert.equal(result.match.name, "Tg", "the 1:1 thread must win over the group containing the same person");
});

test("a request that genuinely names a group still resolves to it", () => {
  // The guard must not make group messaging impossible — only accidental.
  const result = resolveEntity("anjali monga, tg and ignacio", SEARCH_RESULTS, { singleRecipient: true });
  assert.equal(result.status, "resolved");
  assert.equal(result.match.name, "Anjali Monga, Tg and Ignacio");
});

test("read-only resolution is unaffected", () => {
  // Without the flag the behaviour is unchanged, so lookups and navigation keep working.
  const result = resolveEntity("tg", SEARCH_RESULTS, {});
  assert.equal(result.status, "resolved");
});

test("ordinary names containing a separator are not mistaken for groups", () => {
  // "Alexander" contains "and"; "Sanders, Jr." contains a comma. Neither is a group, and
  // over-rejecting would break sending to real people.
  for (const name of ["Alexander", "Sanders, Jr.", "Amanda"]) {
    const result = resolveEntity(name, [el("x1", name)], { singleRecipient: true });
    assert.equal(result.status, "resolved", `"${name}" must remain reachable`);
  }
});

test("the guard is reachable from production, not dead code", () => {
  // hintsForOutcome is the only production caller of resolveEntity. If it stops passing the flag,
  // every test above still passes while the live path silently loses the protection.
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server", "automation", "entity-resolver.js"), "utf8");
  assert.match(source, /resolveEntity\(person, snapshot\?\.elements \|\| \[\], \{ singleRecipient: true \}\)/,
    "hintsForOutcome must resolve people as single recipients");

  const hints = hintsForOutcome(
    { entities: { people: ["tg"] } },
    { elements: SEARCH_RESULTS },
  );
  assert.equal(hints.length, 1);
  assert.notEqual(hints[0].status, "resolved",
    "the live path must refuse the group, not just the unit-tested function");
});
