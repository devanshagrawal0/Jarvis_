"use strict";

// Eclipse could research the world and knew nothing about its owner.
//
// It was launched with web search and page fetch and nothing else, so a mission asked to message
// "tg" had no way to discover that tg is a real person with a stored handle and a known
// conversation. Worse, with no toolbox supplied at all, `runtime.js` falls back to a stub that
// returns `https://example.com/evidence` — so a mission could "verify" a claim against a source
// that does not exist.
//
// These tests assert the bridge closes that, and — just as importantly — that it does not open a
// hole in the lease model on the way through.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createJarvisToolbox, BRIDGE_TOOL_SCOPE, BRIDGE_SIDE_EFFECTING, bridgeSummary } = require("../../server/eclipse/capabilities/jarvis-bridge");
const { createGateway } = require("../../server/eclipse/capabilities/tool-gateway");
const { issueRootLease, narrow } = require("../../server/eclipse/capabilities/lease");

// The real lease API: a root lease is always sideEffecting:false (it is the mission's ceiling), and
// only a narrowed lease can be granted the right to act.
const rootFor = (scopes) => issueRootLease({ missionId: "m1", constraints: {} }, "s1", { scopes });
const actingLease = (scopes) => narrow(rootFor(scopes), { sessionId: "agent", scopes, sideEffecting: true });

// Stand-ins shaped like the real things, so the bridge is exercised without a live browser or key.
function fakeContacts() {
  const people = [
    { name: "TG", aliases: ["tarush"], channels: { instagram: { handle: "sam_main", threadUrl: "https://www.instagram.com/direct/t/1/" } } },
    { name: "Sam A", aliases: [], channels: { email: { address: "a@example.com" } } },
    { name: "Sam B", aliases: [], channels: { email: { address: "b@example.com" } } },
  ];
  return {
    findAll: (q) => people.filter((p) => [p.name, ...(p.aliases || [])].some((n) => n.toLowerCase() === String(q).toLowerCase())),
    routeFor: (q, channel) => {
      const p = people.find((x) => [x.name, ...(x.aliases || [])].some((n) => n.toLowerCase() === String(q).toLowerCase()));
      const acct = p && p.channels[channel];
      return acct ? { channel, handle: acct.handle || acct.address, url: acct.threadUrl || "" } : null;
    },
  };
}
const fakeVault = { searchMemories: (q) => (q === "nothing" ? [] : [{ content: "Dev prefers concise answers", topic: "preference", created_at: "2026-08-01T00:00:00Z" }]) };
function fakeEngine(behaviour = {}) {
  return {
    definitions: [{ name: "browser_click", risk: "execute" }, { name: "screen_capture", risk: "observe" }],
    execute: async (tool, args) => behaviour[tool] || { ok: true, status: "completed", result: { tool, args } },
  };
}

test("Eclipse can find out who someone is", () => {
  // The exact thing it could not do before.
  const box = createJarvisToolbox({ contactStore: fakeContacts() });
  return box["contacts.lookup"].run({ name: "tg", channel: "instagram" }).then((out) => {
    assert.equal(out.found, true);
    assert.equal(out.name, "TG");
    assert.equal(out.route.handle, "sam_main");
    assert.equal(out.route.url, "https://www.instagram.com/direct/t/1/");
  });
});

test("two people with one name is reported, never guessed", async () => {
  // Picking one would reintroduce the confident-guess failure the contact store exists to end.
  const box = createJarvisToolbox({ contactStore: fakeContacts() });
  const out = await box["contacts.lookup"].run({ name: "Sam A" });
  assert.equal(out.found, true, "an exact single match still resolves");
  const engine = createJarvisToolbox({ contactStore: { findAll: () => [{ name: "Sam", channels: {} }, { name: "Sam", channels: {} }], routeFor: () => null } });
  const ambiguous = await engine["contacts.lookup"].run({ name: "Sam" });
  assert.equal(ambiguous.found, false);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.candidates.length, 2);
});

test("Eclipse can read what Jarvis remembers", async () => {
  const box = createJarvisToolbox({ neuralVault: fakeVault });
  const out = await box["memory.retrieve"].run({ query: "preferences" });
  assert.equal(out.count, 1);
  assert.match(out.memories[0].text, /concise/);
  const empty = await box["memory.retrieve"].run({ query: "nothing" });
  assert.equal(empty.count, 0, "an empty recall is reported as empty, not invented");
});

test("a capability that stops for approval is not reported as a failure", async () => {
  // "Did not happen" and "failed" are different states. A mission that conflates them will retry
  // an action that is sitting waiting for the owner — which is how something gets sent twice.
  const box = createJarvisToolbox({ capabilityEngine: fakeEngine({ browser_click: { ok: false, status: "confirmation_required", confirmation: { id: "c1", summary: "Send the message?" } } }) });
  const out = await box["jarvis.capability"].run({ tool: "browser_click", args: {} });
  assert.equal(out.ok, false);
  assert.equal(out.pendingApproval, true);
  assert.equal(out.confirmationId, "c1");
  assert.equal(out.error, undefined, "a pending approval must not be dressed up as an error string");
});

test("an unknown capability is refused, not attempted", async () => {
  const box = createJarvisToolbox({ capabilityEngine: fakeEngine() });
  const out = await box["jarvis.capability"].run({ tool: "definitely_not_a_tool" });
  assert.equal(out.ok, false);
  assert.match(out.error, /unknown capability/);
});

test("the bridge only offers what it was actually given", () => {
  // A toolbox that advertises a tool it cannot perform is the same lie as a stub returning
  // example.com — the mission believes a capability exists and plans around it.
  assert.deepEqual(bridgeSummary(createJarvisToolbox({})).tools, []);
  assert.deepEqual(bridgeSummary(createJarvisToolbox({ contactStore: fakeContacts() })).tools, ["contacts.lookup"]);
  assert.deepEqual(bridgeSummary(createJarvisToolbox({ contactStore: fakeContacts(), neuralVault: fakeVault, capabilityEngine: fakeEngine() })).tools,
    ["contacts.lookup", "jarvis.capability", "memory.retrieve"]);
});

// ── the lease model must survive the connection ───────────────────────────────

test("acting on the world still requires an approved lease", async () => {
  // The whole point of the gateway. Connecting Eclipse to the real capabilities must not become a
  // way around the approval boundary — the bridge is the outer of two locks, not a replacement.
  const gateway = createGateway({ extraScopes: BRIDGE_TOOL_SCOPE, extraSideEffecting: BRIDGE_SIDE_EFFECTING });
  const readOnly = rootFor(["memory.read", "jarvis.control"]);
  await assert.rejects(
    () => gateway.mediate(readOnly, { tool: "jarvis.capability" }, () => { throw new Error("must not run"); }),
    (e) => e.leaseCode === "DENIED",
    "a lease without sideEffecting must not reach a real capability",
  );
  const approved = actingLease(["jarvis.control"]);
  let ran = false;
  await gateway.mediate(approved, { tool: "jarvis.capability" }, () => { ran = true; });
  assert.equal(ran, true, "an approved lease may act");
});

test("reading a contact needs only a read scope", async () => {
  const gateway = createGateway({ extraScopes: BRIDGE_TOOL_SCOPE, extraSideEffecting: BRIDGE_SIDE_EFFECTING });
  const lease = rootFor(["memory.read"]);
  let ran = false;
  await gateway.mediate(lease, { tool: "contacts.lookup" }, () => { ran = true; });
  assert.equal(ran, true);
});

test("a bridge tool the gateway was not told about stays denied", async () => {
  // Default-deny is the correct failure direction, and registering scopes must be what opens a
  // tool — not merely the toolbox happening to contain it.
  const bare = createGateway();
  const lease = actingLease(["memory.read", "jarvis.control"]);
  await assert.rejects(
    () => bare.mediate(lease, { tool: "contacts.lookup" }, () => { throw new Error("must not run"); }),
    (e) => e.leaseCode === "DENIED",
  );
  assert.equal(bare.TOOL_SCOPE["contacts.lookup"], undefined);
  const wired = createGateway({ extraScopes: BRIDGE_TOOL_SCOPE, extraSideEffecting: BRIDGE_SIDE_EFFECTING });
  assert.equal(wired.TOOL_SCOPE["contacts.lookup"], "memory.read", "the gateway must report the scopes it actually enforces");
});

// ── continuity across the mode switch ─────────────────────────────────────────


test("a mission started mid-conversation carries what was said", () => {
  // Switching the picker from Cortex to Eclipse sent only a prompt and an effort level, so a
  // follow-up like "go deeper on that" arrived with no referent and the owner had to restate it.
  const { priorTurns } = require("../../server/eclipse/orchestration/nodes");
  const preamble = priorTurns({ conversation: [
    { role: "user", text: "What is the failure rate on my automation?" },
    { role: "model", text: "26 of 67 tasks failed." },
  ] });
  assert.match(preamble, /Owner: What is the failure rate/);
  assert.match(preamble, /JARVIS: 26 of 67 tasks failed/);
  assert.match(preamble, /context only/, "the prior turns must be labelled as context, not as the task");
});

test("no conversation yields no heading at all", () => {
  // A heading with nothing under it invites the model to fill the gap — inventing a discussion
  // that never happened is worse than having no context.
  const { priorTurns } = require("../../server/eclipse/orchestration/nodes");
  assert.equal(priorTurns({}), "");
  assert.equal(priorTurns({ conversation: [] }), "");
  assert.equal(priorTurns({ conversation: [{ role: "user", text: "   " }] }), "", "blank turns are not context");
  assert.equal(priorTurns(null), "");
});

test("only the recent tail is carried, and each turn is bounded", () => {
  // The record holds up to 500 turns. Sending all of them would blow the context budget and bury
  // the actual mission under history.
  const { priorTurns } = require("../../server/eclipse/orchestration/nodes");
  const many = Array.from({ length: 40 }, (_, i) => ({ role: "user", text: `turn ${i}` }));
  const out = priorTurns({ conversation: many }, 8);
  assert.equal(out.split("\n").filter((l) => l.startsWith("Owner:")).length, 8);
  assert.match(out, /turn 39/, "the most recent turns are the ones kept");
  assert.doesNotMatch(out, /turn 31\b/, "older turns are dropped");
  const long = priorTurns({ conversation: [{ role: "user", text: "x".repeat(1000) }] });
  assert.ok(long.length < 500, `a single turn must not be unbounded (got ${long.length})`);
});
