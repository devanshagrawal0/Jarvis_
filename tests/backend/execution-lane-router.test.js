"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { routeExecutionLane } = require("../../server/automation/execution-lane-router");

test("routes explicit-address email through Google connector", () => {
  const route = routeExecutionLane("send an email to aj@example.com saying hi", { googleRefreshToken: "fixture" });
  assert.equal(route.lane, "connector-google");
  assert.deepEqual(route.tools, ["gmail_prepare_email", "gmail_send_prepared"]);
  assert.equal(route.placement, "runtime");
});

test("routes named Instagram recipient through the isolated private browser", () => {
  const route = routeExecutionLane("send hi to Raghav Mittal on Instagram", { playwrightExtensionToken: "fixture" });
  assert.equal(route.lane, "private-browser");
  assert.equal(route.surface, "managed-browser");
  assert.equal(route.startUrl, "https://www.instagram.com/direct/inbox/");
  assert.ok(route.tools.includes("computer_use"));
  assert.ok(route.tools.includes("browser_login_handoff"));
  assert.equal(route.profileIsolation, "jarvis-private-profile");
});

test("keeps public browser work headless and explicit screen work visible", () => {
  assert.equal(routeExecutionLane("search Google for Windows automation architecture", {}).lane, "headless-browser");
  const visible = routeExecutionLane("open Instagram on my screen", {});
  assert.equal(visible.lane, "visible-desktop");
  assert.ok(visible.tools.includes("computer_use"));
});

test("uses the private profile for sites that may require an account", () => {
  assert.equal(routeExecutionLane("open my private GitHub repository", {}).lane, "private-browser");
  assert.equal(routeExecutionLane("like a YouTube video", {}).lane, "private-browser");
});

test("email by contact name uses private Gmail session when API cannot resolve identity", () => {
  const route = routeExecutionLane("send Dad an email with the latest report", { googleRefreshToken: "fixture", playwrightExtensionToken: "fixture" });
  assert.equal(route.lane, "private-browser");
  assert.equal(route.site, "gmail");
});
