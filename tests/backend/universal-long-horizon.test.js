"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");
const { createBrowserAutomationService } = require("../../server/browser-service");
const { createUniversalBrowserAgent } = require("../../server/universal-browser-agent");

function ref(snapshot, name) {
  return snapshot.elements.find((item) => item.name === name || item.text === name)?.ref;
}

test("long-horizon executor carries evidence and artifacts across sites with single-use approvals", async (t) => {
  if (!fs.existsSync(chromium.executablePath())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/start") return response.end("<title>Start</title><a href='/source'>Open source file</a>");
    if (request.url === "/source") return response.end("<title>Source File</title><main><pre>Dataset: conversion rose 18 percent; risk: sample size 42.</pre><a href='/dataset.txt' download>Download dataset</a></main>");
    if (request.url === "/dataset.txt") {
      response.setHeader("content-type", "text/plain");
      response.setHeader("content-disposition", "attachment; filename=dataset.txt");
      return response.end("conversion_change=18\nsample_size=42\n");
    }
    if (request.url === "/reel") return response.end("<title>Reel Evidence</title><main>Reel claim: strategy doubles conversion. No methodology is disclosed.</main>");
    if (request.url === "/compose") return response.end(`<title>Compose</title><label>Recipient <input aria-label="Recipient"></label><label>Message <textarea aria-label="Message"></textarea></label><button onclick="document.querySelector('#proof').textContent='Sent to AJ: please review report'">Send</button><p id="proof"></p>`);
    if (request.url === "/repo") return response.end(`<title>Private Repository</title><input aria-label="Report file" type="file"><button onclick="document.querySelector('#proof').textContent='Published report.md to private repository'">Publish</button><p id="proof"></p>`);
    response.statusCode = 404;
    return response.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-long-horizon-"));
  const browser = createBrowserAutomationService({ runtimeDir, headless: true, channel: null });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  const planner = async ({ snapshot, history }) => {
    const actions = history.map((item) => item.action);
    if (snapshot.title === "Start") return { actions: [{ action: "click", ref: ref(snapshot, "Open source file"), reason: "Open first source", expected: "Source File page" }], confidence: 1 };
    if (snapshot.title === "Source File" && !actions.includes("extract")) return { actions: [{ action: "extract", selector: "body", reason: "Capture dataset facts", expected: "Dataset evidence recorded" }], confidence: 1 };
    if (snapshot.title === "Source File" && !actions.includes("download")) return { actions: [{ action: "download", ref: ref(snapshot, "Download dataset"), reason: "Preserve source dataset", expected: "Local dataset file" }], confidence: 1 };
    if (!actions.includes("new_tab")) return { actions: [{ action: "new_tab", url: `${base}/reel`, reason: "Open second source", expected: "Reel Evidence page" }], confidence: 1 };
    if (snapshot.title === "Reel Evidence" && actions.filter((item) => item === "extract").length < 2) return { actions: [{ action: "extract", selector: "body", reason: "Capture reel claim", expected: "Reel evidence recorded" }], confidence: 1 };
    if (!actions.includes("synthesize_report")) return { actions: [{ action: "synthesize_report", filename: "report.md", title: "Dataset and Reel Analysis", reason: "Create evidence-grounded report", expected: "Reusable report file" }], confidence: 1 };
    if (snapshot.title !== "Compose" && snapshot.title !== "Private Repository" && !history.some((item) => /Sent to AJ/.test(item.observed || ""))) return { actions: [{ action: "navigate", url: `${base}/compose`, reason: "Prepare AJ feedback request", expected: "Compose page" }], confidence: 1 };
    if (snapshot.title === "Compose" && !snapshot.elements.find((item) => item.name === "Recipient")?.value) return { actions: [{ action: "fill", ref: ref(snapshot, "Recipient"), value: "AJ", reason: "Select exact fixture recipient", expected: "Recipient AJ" }], confidence: 1 };
    if (snapshot.title === "Compose" && !snapshot.elements.find((item) => item.name === "Message")?.value) return { actions: [{ action: "fill", ref: ref(snapshot, "Message"), value: "Please review report", reason: "Prepare feedback request", expected: "Draft visible" }], confidence: 1 };
    if (snapshot.title === "Compose" && !/Sent to AJ/.test(snapshot.pageText)) return { actions: [{ action: "click", ref: ref(snapshot, "Send"), reason: "Send the feedback request", expected: "Sent to AJ proof" }], confidence: 1 };
    if (snapshot.title !== "Private Repository") return { actions: [{ action: "navigate", url: `${base}/repo`, reason: "Open private repository uploader", expected: "Private Repository page" }], confidence: 1 };
    const reportPath = history.map((item) => item.observed || "").join(" ").match(/"path":"([^"]*report\.md)"/)?.[1]?.replace(/\\\\/g, "\\");
    if (!actions.includes("upload")) return { actions: [{ action: "upload", ref: ref(snapshot, "Report file"), path: reportPath, reason: "Attach generated report", expected: "Report selected" }], confidence: 1 };
    if (!/Published report/.test(snapshot.pageText)) return { actions: [{ action: "click", ref: ref(snapshot, "Publish"), reason: "Publish report to private repository", expected: "Published report proof" }], confidence: 1 };
    return { actions: [{ action: "complete", reason: "Both external effects and the report artifact are visibly verified" }], result: "Cross-site report workflow completed", confidence: 1 };
  };

  const artifactSynthesizer = async ({ artifactDir }) => {
    const reportPath = path.join(artifactDir, "report.md");
    fs.writeFileSync(reportPath, "# Dataset and Reel Analysis\n\nDataset reports 18%; reel claim lacks methodology.\n", "utf8");
    return { path: reportPath, bytes: fs.statSync(reportPath).size, model: "fixture" };
  };
  const agent = createUniversalBrowserAgent({ browserService: browser, getSettings: () => ({}), runtimeDir, planner, artifactSynthesizer });
  const objective = "Get the source file, analyse it with the reel, make a report, send AJ a feedback request, then upload the report to a private GitHub repository";

  const preparedSend = await agent.execute(objective, { startUrl: `${base}/start`, maxSteps: 35, taskId: "long-task" });
  assert.equal(preparedSend.requiresConfirmation, true, JSON.stringify({ result: preparedSend.result, error: preparedSend.error, history: preparedSend.history?.slice(-6) }));
  assert.match(preparedSend.pendingAction.pendingAction.label, /send/i);
  assert.ok(fs.existsSync(path.join(runtimeDir, "universal-browser-artifacts", "report.md")));

  const preparedPublish = await agent.execute(objective, { resume: preparedSend.pendingAction, approvedExternal: true, maxSteps: 35 });
  assert.equal(preparedPublish.requiresConfirmation, true);
  assert.match(preparedPublish.pendingAction.pendingAction.label, /publish/i);

  const completed = await agent.execute(objective, { resume: preparedPublish.pendingAction, approvedExternal: true, maxSteps: 35 });
  assert.equal(completed.success, true, JSON.stringify({ result: completed.result, error: completed.error, history: completed.history?.slice(-6) }));
  assert.equal(completed.mode, "playwright-universal-v2");
  assert.ok(completed.evidence.some((item) => item.kind === "artifact"));
  assert.ok(completed.world.transitions.some((item) => item.action === "synthesize_report"));
});
