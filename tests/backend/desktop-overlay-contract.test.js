"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

test("Electron desktop overlay is transparent, click-through, capture-protected, and globally stoppable", () => {
  const source = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
  assert.match(source, /transparent:\s*true/);
  assert.match(source, /setIgnoreMouseEvents\(true/);
  assert.match(source, /setContentProtection\(true\)/);
  assert.match(source, /CommandOrControl\+Alt\+Escape/);
  assert.match(source, /\/api\/desktop-takeover\/cancel/);
  assert.match(source, /screenToDipPoint/);
  assert.match(source, /execPath:\s*serverExecPath/);
  assert.match(source, /function serverNodeExecutable/);
});

test("legacy personal-Chrome endpoints are retired before old handlers can execute", () => {
  const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const capabilitySource = fs.readFileSync(path.join(root, "server/capability-engine.js"), "utf8");
  const retired = source.indexOf("Personal Chrome bridge retired");
  const legacySetup = source.indexOf('if (req.method === "GET" && pathname === "/api/browser-bridge-setup")', retired + 1);
  assert.ok(retired > 0);
  assert.ok(legacySetup > retired);
  assert.match(source.slice(retired - 1600, retired + 1800), /\/api\/private-browser\/login\/start/);
  assert.doesNotMatch(capabilitySource, /createPersonalBrowserBridge/);
});
