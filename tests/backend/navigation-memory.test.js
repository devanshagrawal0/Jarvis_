"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createNavigationMemory, routeSignature } = require("../../server/automation/navigation-memory");

test("navigation memory learns reversible semantic routes and survives restart", (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-navigation-memory-"));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const snapshot = {
    url: "https://portal.example.test/workspaces/9f84c1d9a122/reports?token=discarded",
    elements: [
      { ref: "e1", role: "button", name: "Open verified reports" },
      { ref: "e2", role: "button", name: "Legacy reports" },
    ],
  };
  const memory = createNavigationMemory({ runtimeDir });
  memory.record({ snapshot, action: { action: "click", reason: "Open reports" }, targetElement: snapshot.elements[0], ok: true, changed: true, durationMs: 240 });
  memory.record({ snapshot, action: { action: "click", reason: "Try legacy reports" }, targetElement: snapshot.elements[1], ok: false, error: "element timed out" });
  memory.record({ snapshot, action: { action: "click", reason: "Try legacy reports" }, targetElement: snapshot.elements[1], ok: false, error: "element not visible" });

  const restarted = createNavigationMemory({ runtimeDir });
  const hints = restarted.hints({ ...snapshot, elements: [{ ...snapshot.elements[0], ref: "fresh-1" }, { ...snapshot.elements[1], ref: "fresh-2" }] });
  assert.equal(hints.find((item) => item.ref === "fresh-1").recommendation, "previously_effective_route");
  assert.equal(hints.find((item) => item.ref === "fresh-2").recommendation, "avoid_unless_page_evidence_changed");
  assert.equal(hints.find((item) => item.ref === "fresh-1").averageDurationMs, 240);
  assert.equal(restarted.status().entries, 2);
});

test("navigation memory excludes secrets, identities, typed values, and consequential actions", (t) => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-navigation-privacy-"));
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const memory = createNavigationMemory({ runtimeDir });
  const snapshot = { url: "https://mail.example.test/inbox?access_token=secret", elements: [] };
  const samples = [
    [{ action: "fill", value: "private message" }, { role: "textbox", name: "Message" }],
    [{ action: "click", reason: "Send the message" }, { role: "button", name: "Send", sensitive: true }],
    [{ action: "click", reason: "Open identity" }, { role: "button", name: "Raghav Mittal" }],
    [{ action: "click", reason: "Open account" }, { role: "button", name: "qa@example.com" }],
  ];
  for (const [action, targetElement] of samples) assert.equal(memory.record({ snapshot, action, targetElement, ok: true, changed: true }).learned, false);
  assert.equal(memory.status().entries, 0);
  assert.equal(fs.existsSync(memory.filePath), false);
});

test("route signatures discard query secrets and normalize generated identifiers", () => {
  assert.equal(routeSignature("https://example.test/projects/123456/report?token=secret"), "https://example.test/projects/:id/report");
  assert.equal(routeSignature("https://example.test/projects/abcdef1234567890/report"), "https://example.test/projects/:id/report");
});
