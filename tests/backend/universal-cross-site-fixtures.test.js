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

function interactiveRef(snapshot, label) {
  return snapshot.elements.find((item) => [item.name, item.text, item.placeholder].some((value) => String(value || "").includes(label)))?.ref;
}

function messagingPage(kind) {
  const email = kind === "gmail";
  const entry = email ? "Compose" : kind === "whatsapp" ? "New chat" : "New message";
  const recipientLabel = email ? "To recipient" : "Search people";
  const recipient = email ? "qa@example.com" : "Raghav Mittal";
  return `<!doctype html><title>${kind} contained fixture</title><main><h1>${kind}</h1><button id="entry">${entry}</button><section id="stage"></section></main><script>
    const stage=document.querySelector('#stage');
    document.querySelector('#entry').onclick=()=>{
      document.querySelector('#entry').remove();
      stage.innerHTML='<label>${recipientLabel}<input id="recipient" aria-label="${recipientLabel}" role="${email ? "textbox" : "searchbox"}"></label>';
      const input=document.querySelector('#recipient');
      input.addEventListener('input',()=>{
        if(${email ? "true" : "false"}) { stage.querySelector('#composer')?.remove(); stage.insertAdjacentHTML('beforeend','<div id="composer"><h2>${recipient}</h2><label>Message body<textarea aria-label="Message body"></textarea></label><button>Send</button></div>'); return; }
        stage.querySelector('#candidate')?.remove();
        if(input.value.trim()) { stage.insertAdjacentHTML('beforeend','<button id="candidate" aria-label="${recipient}">${recipient}</button>'); document.querySelector('#candidate').onclick=()=>{stage.innerHTML='<h2>${recipient}</h2><label>Message<textarea aria-label="Message"></textarea></label><button>Send</button>'}; }
      });
    };
  </script>`;
}

test("contained private-browser matrix handles Instagram, Gmail, WhatsApp, GitHub, and Canvas without live accounts", async (t) => {
  if (!fs.existsSync(chromium.executablePath())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/instagram") return response.end(messagingPage("instagram"));
    if (request.url === "/gmail") return response.end(messagingPage("gmail"));
    if (request.url === "/whatsapp") return response.end(messagingPage("whatsapp"));
    if (request.url === "/github") return response.end("<title>GitHub contained fixture</title><main><h1>Repositories</h1><a href='/github/repo'>apex-engine</a></main>");
    if (request.url === "/github/repo") return response.end("<title>apex-engine</title><main><h1>apex-engine</h1><article>README: deterministic market research engine. Branch main.</article></main>");
    if (request.url === "/canvas") return response.end("<title>Canvas contained fixture</title><main><h1>Upcoming assignments</h1><a href='/assignment.txt' download>Download next assignment</a></main>");
    if (request.url === "/assignment.txt") {
      response.setHeader("content-type", "text/plain");
      response.setHeader("content-disposition", "attachment; filename=assignment.txt");
      return response.end("Contained assignment: compare two market datasets.\n");
    }
    if (request.url === "/canvas-login") return response.end("<title>Canvas Login</title><main><label>Password<input type='password'></label><button>Log in</button></main>");
    response.statusCode = 404;
    return response.end("missing fixture");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-cross-site-"));
  const browser = createBrowserAutomationService({ runtimeDir, headless: true, channel: null });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  let remotePlannerCalls = 0;
  const messagingAgent = createUniversalBrowserAgent({
    browserService: browser,
    runtimeDir,
    getSettings: () => ({}),
    planner: async () => { remotePlannerCalls += 1; throw new Error("semantic messaging fixtures must not spend a model call"); },
  });
  const messageCases = [
    ["instagram", "message Raghav Mittal saying fixture hello on Instagram but do not send"],
    ["whatsapp", "message Raghav Mittal saying fixture hello on WhatsApp but do not send"],
    ["gmail", "email qa@example.com saying fixture hello but do not send"],
  ];
  for (const [site, objective] of messageCases) {
    const steps = [];
    const result = await messagingAgent.execute(objective, { taskId: `fixture-${site}`, startUrl: `${base}/${site}`, onStep: (step) => steps.push(step) });
    assert.equal(result.success, true, `${site} draft should be verified`);
    assert.match(result.result, /prepared/i);
    assert.ok(steps.some((step) => step.phase === "observed"), `${site} should emit observations to Runtime`);
    assert.ok(steps.some((step) => step.action === "fill" && step.value === "fixture hello"));
  }
  assert.equal(remotePlannerCalls, 0);

  const planner = async ({ snapshot, history }) => {
    if (snapshot.title === "GitHub contained fixture") return { actions: [{ action: "click", ref: interactiveRef(snapshot, "apex-engine"), reason: "Open the requested repository", expected: "Repository README becomes visible" }], confidence: 1 };
    if (snapshot.title === "apex-engine" && !history.some((item) => item.action === "extract")) return { actions: [{ action: "extract", selector: "article", reason: "Read the repository README", expected: "README evidence is captured" }], confidence: 1 };
    if (snapshot.title === "apex-engine") return { actions: [{ action: "complete", reason: "The repository and README were observed" }], result: "Repository README inspected", confidence: 1 };
    if (snapshot.title === "Canvas contained fixture" && !history.some((item) => item.action === "download")) return { actions: [{ action: "download", ref: interactiveRef(snapshot, "Download next assignment"), reason: "Download the next Canvas assignment", expected: "A non-empty assignment file is stored locally" }], confidence: 1 };
    if (snapshot.title === "Canvas contained fixture") return { actions: [{ action: "complete", reason: "The assignment exists as a verified local artifact" }], result: "Next assignment downloaded", confidence: 1 };
    throw new Error(`No fixture plan for ${snapshot.title}`);
  };
  const generalAgent = createUniversalBrowserAgent({ browserService: browser, runtimeDir, getSettings: () => ({}), planner });
  const github = await generalAgent.execute("Open the GitHub apex-engine repository and read its README", { taskId: "fixture-github", startUrl: `${base}/github` });
  assert.equal(github.success, true);
  assert.ok(github.history.some((item) => item.action === "extract"));
  const canvas = await generalAgent.execute("Download the next assignment from Canvas", { taskId: "fixture-canvas", startUrl: `${base}/canvas` });
  assert.equal(canvas.success, true);
  const assignment = canvas.evidence.find((item) => item.kind === "artifact")?.path;
  assert.ok(assignment && fs.statSync(assignment).size > 0);

  const login = await generalAgent.execute("Check my next Canvas assignment", { taskId: "fixture-canvas-login", startUrl: `${base}/canvas-login` });
  assert.equal(login.requiresLogin, true);
  const session = browser.runtimeStatus().sessions.find((item) => item.origin === base);
  assert.equal(session.status, "login_required");
});
