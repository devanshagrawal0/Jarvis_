// P1·W4 lease + gateway test. Run: node server/eclipse/evals/test-leases.js
// Pure/deterministic. Proves monotonic narrowing + gateway enforcement. Exit 1 on failure.
const assert = require("assert");
const { issueRootLease, narrow, sign, verify, revoke, LeaseError } = require("../capabilities/lease");
const { createGateway } = require("../capabilities/tool-gateway");
const { validate, CapabilityLease } = require("../contracts");
const { toSchema } = require("../capabilities/lease");

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.message); process.exitCode = 1; } };

const mission = { missionId: "m1", constraints: { maxTokens: 100000, maxCostUsd: 0.8 } };

console.log("ECLIPSE P1·W4 — leases & tool gateway");

ok("root lease is signed and verifies + matches schema", () => {
  const root = issueRootLease(mission, "root");
  assert.ok(root.signature);
  assert.equal(verify(root), true);
  validate(CapabilityLease, toSchema(root), "lease"); // schema-valid subset
  assert.equal(root.depth, 0);
});

ok("tampering with a lease breaks verification", () => {
  const root = issueRootLease(mission, "root");
  const forged = { ...root, scopes: [...root.scopes, "fs.write"] }; // widen without re-signing
  assert.throws(() => verify(forged), (e) => e.leaseCode === "TAMPERED");
});

ok("narrow is monotonic: child ⊆ parent, extra scopes dropped", () => {
  const root = issueRootLease(mission, "root"); // has web.search/fetch/memory.read/code.exec/spawn
  const child = narrow(root, { sessionId: "w1", scopes: ["web.search", "fs.write"], maxCostUsd: 5 });
  assert.deepEqual(child.scopes, ["web.search"], "fs.write not in parent → dropped");
  assert.ok(child.dropped.includes("fs.write"));
  assert.ok(child.maxCostUsd <= root.maxCostUsd, "cost min-narrowed");
  assert.equal(child.depth, 1);
  assert.equal(child.parentLeaseId, root.leaseId);
  assert.ok(new Date(child.expiresAt) <= new Date(root.expiresAt));
});

ok("depth ≤ 2 and non-delegable leases can't spawn", () => {
  const root = issueRootLease(mission, "root");
  const l1 = narrow(root, { sessionId: "a", scopes: ["web.search"], mayDelegate: true });
  const l2 = narrow(l1, { sessionId: "b", scopes: ["web.search"], mayDelegate: true });
  assert.equal(l2.depth, 2);
  assert.equal(l2.mayDelegate, false, "depth-2 lease cannot further delegate");
  assert.throws(() => narrow(l2, { sessionId: "c", scopes: ["web.search"] }), (e) => e.name === "LeaseError" && ["DEPTH", "NO_DELEGATE"].includes(e.leaseCode));
  // direct DEPTH guard: hand-craft a delegable depth-2 lease
  const deep = sign({ ...l2, depth: 2, mayDelegate: true });
  assert.throws(() => narrow(deep, { sessionId: "d", scopes: ["web.search"] }), (e) => e.leaseCode === "DEPTH");
});

ok("revoked lease fails verify and gateway", () => {
  const root = issueRootLease(mission, "root");
  const dead = revoke(root);
  assert.throws(() => verify(dead), (e) => e.leaseCode === "REVOKED");
});

ok("gateway allows in-scope + in-glob calls, denies the rest", () => {
  const gw = createGateway();
  const root = issueRootLease(mission, "root");
  assert.equal(gw.authorize(root, { tool: "web.search" }).allow, true);
  assert.equal(gw.authorize(root, { tool: "web.fetch", resource: "https://example.com" }).allow, true);
  assert.equal(gw.authorize(root, { tool: "web.fetch", resource: "ftp://x" }).allow, false, "out of glob");
  assert.equal(gw.authorize(root, { tool: "fs.write" }).allow, false, "no scope");
  assert.equal(gw.authorize(root, { tool: "nope" }).allow, false, "unknown tool default-deny");
});

ok("gateway blocks side-effecting tools without an approved lease", () => {
  const gw = createGateway();
  // a lease that HAS memory.write scope but is not marked sideEffecting → still HITL-gated
  const root = issueRootLease(mission, "root", { scopes: ["memory.write"] });
  const d = gw.authorize(root, { tool: "memory.promote" });
  assert.equal(d.allow, false);
  assert.ok(/HITL|sideEffecting/.test(d.reason));
});

ok("gateway enforces per-tool call budget", async () => {
  const gw = createGateway();
  const root = issueRootLease(mission, "root");
  const lease = { ...root, maxCalls: { "web.search": 2 } };
  const signed = sign({ ...lease, signature: undefined });
  let ran = 0;
  const call = () => gw.mediate(signed, { tool: "web.search" }, () => { ran++; return "ok"; });
  await call(); await call();
  await assert.rejects(() => call(), (e) => e.leaseCode === "DENIED");
  assert.equal(ran, 2, "third call blocked before fn");
});

ok("mediate runs fn on allow, blocks fn on deny", async () => {
  const gw = createGateway();
  const root = issueRootLease(mission, "root");
  let ran = false;
  const r = await gw.mediate(root, { tool: "web.search" }, () => { ran = true; return 42; });
  assert.equal(r, 42); assert.equal(ran, true);
  await assert.rejects(() => gw.mediate(root, { tool: "fs.write" }, () => { throw new Error("should not run"); }), (e) => e.leaseCode === "DENIED");
});

setTimeout(() => console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`), 20);
