const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("main server is loopback-by-default and API policy is deny-by-default", () => {
  const source = read("server.js");
  assert.match(source, /process\.env\.JARVIS_HOST \|\| "127\.0\.0\.1"/);
  assert.match(source, /isApi && !requestTrust\.isPublicApi\(req, pathname\) && !isTrustedRequest/);
  assert.doesNotMatch(source, /SENSITIVE_API_PREFIXES/);
});

test("Worker authenticates APIs before proxying and signs the relay", () => {
  const source = read("worker/index.ts");
  const apiBranch = source.indexOf('if (url.pathname.startsWith("/api/"))');
  const authorize = source.indexOf("await authorize(request, env)", apiBranch);
  const proxy = source.indexOf("proxyToLocalJarvis(request", apiBranch);
  assert.ok(apiBranch >= 0 && authorize > apiBranch && proxy > authorize);
  assert.match(source, /x-jarvis-relay-signature/);
  assert.match(source, /JARVIS_RELAY_SECRET/);
  assert.doesNotMatch(source, /Math\.random\(\)/);
});

test("approval execution requires a direct owner challenge", () => {
  const server = read("server.js");
  const engine = read("server/capability-engine.js");
  assert.match(server, /Pending approvals are visible only on the direct owner surface/);
  assert.match(server, /Approval requires the direct owner surface/);
  assert.match(engine, /ownerChallenge: crypto\.randomBytes\(32\)/);
  assert.match(engine, /Owner confirmation challenge is invalid/);
  assert.match(engine, /crypto\.timingSafeEqual/);
});

test("current widgets contain no production demo fallback records", () => {
  const widgets = read("src/globe-room/WidgetStrip.tsx");
  for (const forbidden of [
    "DEMO_PROJECTS",
    "KALSHI_MOCK_MARKETS",
    "claude-sonnet-4-6",
    "MacBook Pro",
    "iPhone 15 Pro",
    "Security Cam",
    "Math.floor(Math.random() * 200",
  ]) assert.equal(widgets.includes(forbidden), false, `forbidden fallback remains: ${forbidden}`);
  assert.match(widgets, /type TruthState = "live" \| "stale" \| "disconnected" \| "empty" \| "sample"/);
});
