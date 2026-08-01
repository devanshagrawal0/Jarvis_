"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalBrowserBridge, parseSnapshot, redactBridgeEvidence } = require("../../server/personal-browser-bridge");

test("parses Playwright accessibility refs into the universal browser shape", () => {
  const snapshot = parseSnapshot(`### Page\n- Page URL: https://example.test/messages\n- Page Title: Messages\n- textbox "Search" [ref=e2]\n- button "Send message" [ref=e9]`, "personal-task-1");
  assert.equal(snapshot.url, "https://example.test/messages");
  assert.equal(snapshot.title, "Messages");
  assert.equal(snapshot.elements.length, 2);
  assert.equal(snapshot.elements[0].ref, "e2");
  assert.equal(snapshot.elements[1].sensitive, true);
  const leaf = parseSnapshot('- generic [ref=e277]: Raghav Mittal\n- textbox "Message" [ref=e533]: hi', "personal-task-2");
  assert.equal(leaf.elements[0].name, "Raghav Mittal");
  assert.equal(leaf.elements[1].value, "hi");
  const siblingPlaceholder = parseSnapshot(`- generic [ref=e680]:
  - generic [ref=e687]:
    - textbox [active] [ref=e688]:
      - paragraph [ref=e689]
    - generic: Message...`, "personal-task-3");
  assert.equal(siblingPlaceholder.elements.find((item) => item.ref === "e688").name, "Message...");
});

test("redacts extension relay credentials from Runtime browser evidence", () => {
  const safe = redactBridgeEvidence("chrome-extension://abc/connect.html?mcpRelayUrl=ws%3A%2F%2Flocal&token=secret-value");
  assert.doesNotMatch(safe, /secret-value|chrome-extension:\/\//);
  assert.match(safe, /personal-browser-bridge/);
});

test("reports one-time setup instead of opening a duplicate login profile", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-personal-bridge-"));
  const bridge = createPersonalBrowserBridge({
    runtimeDir,
    getSettings: () => ({}),
    fallbackService: { findFiles: async () => ({ files: [] }) },
  });
  const status = await bridge.status();
  assert.equal(status.configured, false);
  assert.equal(status.setupRequired, true);
  await assert.rejects(() => bridge.navigate({ taskId: "owner", url: "https://example.test" }), /one-time Playwright extension token/i);
});

test("creates a minimized authenticated CDP task window and drives it through semantic refs", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-personal-bridge-"));
  const calls = [];
  const brokerCalls = [];
  const fakeClient = {
    async callTool(request) {
      calls.push(request);
      if (request.name === "browser_run_code_unsafe") return { content: [{ type: "text", text: JSON.stringify({ index: 2, windowId: 41, url: "https://example.test" }) }] };
      if (request.name === "browser_navigate") return { content: [{ type: "text", text: "- Page URL: https://example.test/messages\n- Page Title: Messages" }] };
      if (request.name === "browser_snapshot") return { content: [{ type: "text", text: "- Page URL: https://example.test/messages\n- Page Title: Messages\n- textbox \"Search\" [ref=e2]\n- button \"Open result\" [ref=e4]" }] };
      if (request.name === "browser_click") return { content: [{ type: "text", text: "- Page URL: https://example.test/result\n- Page Title: Result" }] };
      return { content: [{ type: "text", text: "ok" }] };
    },
    async close() {},
  };
  const bridge = createPersonalBrowserBridge({
    runtimeDir,
    getSettings: () => ({ playwrightExtensionToken: "test-token" }),
    fallbackService: { findFiles: async () => ({ files: [] }) },
    clientFactory: async () => fakeClient,
    windowsBroker: {
      async call(method, args) {
        brokerCalls.push({ method, args });
        if (method === "create_browser_window") return { handle: "4242", processId: 99, minimized: true };
        if (method === "minimize_window") return { updated: true, state: "minimize", handle: args.handle };
        if (method === "restore_window") return { updated: true, state: "restore", handle: args.handle };
        throw new Error(`Unexpected broker method: ${method}`);
      },
    },
  });

  await bridge.navigate({ taskId: "owner", url: "https://example.test/messages" });
  const snapshot = await bridge.snapshot({ taskId: "owner" });
  const result = await bridge.act({ taskId: "owner", action: "click", ref: "e4" });
  await bridge.reveal({ taskId: "owner" });

  assert.equal(snapshot.elements[1].name, "Open result");
  assert.equal(result.url, "https://example.test/result");
  assert.equal(brokerCalls.length, 0);
  assert.ok(calls.some((call) => call.name === "browser_run_code_unsafe" && /Target\.createTarget|Browser\.setWindowBounds/.test(call.arguments.code)));
  assert.ok(calls.some((call) => call.name === "browser_run_code_unsafe" && /windowState: 'normal'/.test(call.arguments.code)));
  assert.ok(calls.some((call) => call.name === "browser_tabs" && call.arguments.action === "select"));
  assert.deepEqual(calls.find((call) => call.name === "browser_click").arguments, { target: "e4", element: "Open result" });
});
