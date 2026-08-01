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
const { createSecretStore } = require("../../server/secret-store");

const EXPECTED = Object.freeze({
  cookieMode: "Partitioned-Lax",
  reportKey: "QZ-4417",
  region: "ap-south-1",
  threshold: "73",
  format: "Detailed",
});

const TAB_NAMES = Object.freeze([
  "Atlas", "Kestrel", "Prism", "Harbor", "Triangle",
  "Nimbus", "Quartz", "Echo", "Vortex", "Cedar",
  "Mosaic", "Lantern", "Ion", "Delta", "Saffron",
  "Orbit", "Rook", "Zephyr", "Helix", "Report Lab",
]);

function byLabel(snapshot, pattern) {
  return snapshot.elements.find((item) => pattern.test(`${item.name || ""} ${item.text || ""}`));
}

function extractedText(history) {
  return history.filter((item) => item.ok !== false && item.action === "extract").map((item) => {
    try { return JSON.parse(item.observed || "{}").content || ""; } catch { return item.observed || ""; }
  }).join("\n");
}

function readFacts(history) {
  const text = extractedText(history);
  return {
    cookieMode: text.match(/Cookie mode:\s*([A-Za-z-]+)/i)?.[1] || "",
    reportKey: text.match(/Report key:\s*([A-Z0-9-]+)/i)?.[1] || "",
    region: text.match(/Deployment region:\s*([a-z0-9-]+)/i)?.[1] || "",
    threshold: text.match(/Risk threshold:\s*(\d+)/i)?.[1] || "",
  };
}

function ultraPlanner({ snapshot, history, world }) {
  const page = snapshot.pageText || "";
  const facts = readFacts(history);
  const route = (label, reason) => ({
    actions: [{ action: "click", ref: byLabel(snapshot, new RegExp(`^${label}\\b`, "i")).ref, reason, expected: `${label} becomes the active data panel` }],
    confidence: 1,
  });

  if (!facts.cookieMode) {
    if (!/Domain:\s*Triangle/i.test(page)) return route("Triangle", "The task explicitly locates the canonical cookie section under Triangle; ignore cookie decoys elsewhere");
    if (!/Canonical cookie policy/i.test(page)) return route("Cookies", "Open Triangle's nested Cookies tab, not similarly named decoy text in other domains");
    return { actions: [{ action: "extract", selector: "#panel", reason: "Retain the canonical cookie mode from Triangle > Cookies", expected: `Cookie mode ${EXPECTED.cookieMode} is retained` }], confidence: 1 };
  }
  if (!facts.reportKey) {
    if (!/Domain:\s*Quartz/i.test(page)) return route("Quartz", "Open Quartz to obtain the report key");
    return { actions: [{ action: "extract", selector: "#panel", reason: "Retain the report key from Quartz", expected: `Report key ${EXPECTED.reportKey} is retained` }], confidence: 1 };
  }
  if (!facts.region) {
    if (!/Domain:\s*Nimbus/i.test(page)) return route("Nimbus", "Open Nimbus to obtain the deployment region");
    return { actions: [{ action: "extract", selector: "#panel", reason: "Retain the deployment region from Nimbus", expected: `Region ${EXPECTED.region} is retained` }], confidence: 1 };
  }
  if (!facts.threshold) {
    if (!/Domain:\s*Atlas/i.test(page)) return route("Atlas", "Open Atlas to locate its nested limits section");
    if (!/Canonical risk limit/i.test(page)) return route("Limits", "Open Atlas's nested Limits tab to obtain the canonical threshold");
    return { actions: [{ action: "extract", selector: "#panel", reason: "Retain the canonical risk threshold from Atlas > Limits", expected: `Threshold ${EXPECTED.threshold} is retained` }], confidence: 1 };
  }
  if (!/Domain:\s*Report Lab/i.test(page)) return route("Report Lab", "Open the report workspace after gathering every required value");

  const fields = [
    [/Report key/i, facts.reportKey],
    [/Deployment region/i, facts.region],
    [/Cookie mode/i, facts.cookieMode],
    [/Risk threshold/i, facts.threshold],
  ];
  const missing = fields.filter(([pattern, value]) => {
    const field = byLabel(snapshot, pattern);
    return field && String(field.value || "") !== String(value);
  }).slice(0, 3);
  if (missing.length) return {
    actions: missing.map(([pattern, value]) => ({ action: "fill", ref: byLabel(snapshot, pattern).ref, value, reason: "Fill the report field from retained cross-tab evidence", expected: `The field contains ${value}` })),
    confidence: 1,
  };
  const format = byLabel(snapshot, /Output format/i);
  if (format?.value !== EXPECTED.format.toLowerCase()) return { actions: [{ action: "select", ref: format.ref, value: EXPECTED.format.toLowerCase(), reason: "Select the requested detailed report format", expected: "Detailed is selected" }], confidence: 1 };
  if (!/Report verified and ready/i.test(page)) return { actions: [{ action: "click", ref: byLabel(snapshot, /^Generate report\b/i).ref, reason: "Generate the contained report after all evidence-backed fields are populated", expected: "A verified report preview and download become available" }], confidence: 1 };
  if (!history.some((item) => item.action === "extract" && /generated report preview/i.test(item.reason || ""))) return { actions: [{ action: "extract", selector: "#preview", reason: "Verify the generated report preview before downloading it", expected: "Every gathered value appears in the verified report" }], confidence: 1 };
  if (!world?.artifacts?.length && !history.some((item) => item.action === "download" && item.ok !== false)) return { actions: [{ action: "download", ref: byLabel(snapshot, /Download verified report/i).ref, reason: "Download the generated report artifact", expected: "A non-empty exact report file is saved locally" }], confidence: 1 };
  return {
    actions: [{ action: "complete", reason: "The canonical values were found across nested tabs, entered into the report, verified, and downloaded" }],
    result: `Verified ${EXPECTED.reportKey}: ${EXPECTED.region}, cookie ${EXPECTED.cookieMode}, threshold ${EXPECTED.threshold}; detailed report downloaded.`,
    confidence: 1,
  };
}

function ultraPage() {
  const buttons = TAB_NAMES.map((name) => `<button class="domain" data-domain="${name}">${name}</button>`).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Ultra Configuration Nexus</title><style>
body{font:15px system-ui;margin:24px;background:#0b1118;color:#dbe8f5}.domains{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}.domain,button{padding:9px;border:1px solid #46627d;background:#132131;color:#e4f1ff;border-radius:6px}#panel{margin-top:18px;padding:18px;border:1px solid #38536d;min-height:250px}label{display:block;margin:9px 0}input,select{margin-left:10px;padding:7px}#preview{white-space:pre-wrap;background:#080c10;padding:12px}.decoy{color:#f0b56b}</style></head>
<body><h1>Configuration Nexus</h1><p>Twenty independent domains contain canonical facts and deliberate semantic decoys.</p><nav class="domains">${buttons}</nav><main id="panel"><p>Choose a data domain.</p></main>
<script>
const panel=document.querySelector('#panel');
const simple={
  Kestrel:'Release train: K-19',Prism:'Color profile: P3',Harbor:'Port policy: internal',Echo:'Retention: 14 days',Vortex:'Queue mode: radial',
  Cedar:'<p class="decoy">Browser cookies disabled in preview builds. This is not a cookie mode value.</p>',
  Mosaic:'<p class="decoy">Cookie inventory count: 12. Refer to the canonical policy domain.</p>',Lantern:'Brightness: 640 nits',Ion:'Charge: nominal',Delta:'Change window: Sunday',
  Saffron:'Theme token: amber',Orbit:'Rotation: locked',Rook:'Access tier: observer',Zephyr:'Wind limit: 31',Helix:'Sequence: H-8'
};
function heading(name,body){panel.innerHTML='<h2>Domain: '+name+'</h2>'+body}
function openTriangle(){heading('Triangle','<p class="decoy">Cookie migration note exists, but the canonical value is nested.</p><nav><button id="tri-summary">Summary</button><button id="tri-geometry">Geometry</button><button id="tri-cookies">Cookies</button><button id="tri-audit">Audit</button></nav><section id="nested">Choose a Triangle subsection.</section>');document.querySelector('#tri-cookies').onclick=()=>document.querySelector('#nested').innerHTML='<h3>Canonical cookie policy</h3><p>Cookie mode: ${EXPECTED.cookieMode}</p><p>Authority: TRI-COOKIE-9</p>';}
function openAtlas(){heading('Atlas','<p class="decoy">Cached threshold example: 12 (training only).</p><nav><button>Overview</button><button id="atlas-limits">Limits</button><button>History</button></nav><section id="nested">Choose an Atlas subsection.</section>');document.querySelector('#atlas-limits').onclick=()=>document.querySelector('#nested').innerHTML='<h3>Canonical risk limit</h3><p>Risk threshold: ${EXPECTED.threshold}</p><p>Policy: ATLAS-LIMIT-4</p>';}
function openLab(){heading('Report Lab',\`<form id="report-form"><label>Report key <input id="report-key" aria-label="Report key"></label><label>Deployment region <input id="region" aria-label="Deployment region"></label><label>Cookie mode <input id="cookie-mode" aria-label="Cookie mode"></label><label>Risk threshold <input id="threshold" type="number" aria-label="Risk threshold"></label><label>Output format <select id="format" aria-label="Output format"><option value="summary">Summary</option><option value="detailed">Detailed</option></select></label><button type="button" id="generate">Generate report</button></form><div id="errors" role="status"></div><section id="preview"></section>\`);document.querySelector('#generate').onclick=()=>{const values={key:document.querySelector('#report-key').value,region:document.querySelector('#region').value,cookie:document.querySelector('#cookie-mode').value,threshold:document.querySelector('#threshold').value,format:document.querySelector('#format').value};const ok=values.key==='${EXPECTED.reportKey}'&&values.region==='${EXPECTED.region}'&&values.cookie==='${EXPECTED.cookieMode}'&&values.threshold==='${EXPECTED.threshold}'&&values.format==='detailed';if(!ok){document.querySelector('#errors').textContent='Validation failed: one or more values came from a decoy or are missing.';return}document.querySelector('#errors').textContent='Report verified and ready';document.querySelector('#preview').textContent='REPORT VERIFIED\\nKey: ${EXPECTED.reportKey}\\nRegion: ${EXPECTED.region}\\nCookie mode: ${EXPECTED.cookieMode}\\nRisk threshold: ${EXPECTED.threshold}\\nFormat: ${EXPECTED.format}';const link=document.createElement('a');link.href='/generated-report.txt';link.download='verified-config-report.txt';link.textContent='Download verified report';document.querySelector('#preview').append(document.createElement('br'),link)}}
document.querySelectorAll('.domain').forEach(button=>button.onclick=()=>{const name=button.dataset.domain;if(name==='Triangle')return openTriangle();if(name==='Atlas')return openAtlas();if(name==='Nimbus')return heading(name,'<p>Deployment region: ${EXPECTED.region}</p><p>Replica region: eu-west-2 (decoy)</p>');if(name==='Quartz')return heading(name,'<p>Report key: ${EXPECTED.reportKey}</p><p>Archived key: QZ-1000</p>');if(name==='Report Lab')return openLab();heading(name,simple[name]||'No canonical task data here.')});
</script></body></html>`;
}

const reportText = `JARVIS VERIFIED CONFIGURATION REPORT\nReport key: ${EXPECTED.reportKey}\nDeployment region: ${EXPECTED.region}\nCookie mode: ${EXPECTED.cookieMode}\nRisk threshold: ${EXPECTED.threshold}\nOutput format: ${EXPECTED.format}\nIntegrity: PASS\n`;

test("ultra maze exposes exactly twenty named top-level tabs with nested decoys", async (t) => {
  if (!fs.existsSync(chromium.executablePath())) return t.skip("Playwright Chromium is not installed");
  const server = http.createServer((request, response) => {
    if (request.url === "/generated-report.txt") { response.setHeader("content-type", "text/plain"); response.setHeader("content-disposition", "attachment; filename=verified-config-report.txt"); return response.end(reportText); }
    response.setHeader("content-type", "text/html");
    if (request.url === "/ultra") return response.end(ultraPage());
    response.statusCode = 404; return response.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-browser-ultra-"));
  const browser = createBrowserAutomationService({ runtimeDir, headless: true, channel: null });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(runtimeDir, { recursive: true, force: true }); });

  await browser.navigate({ taskId: "tab-audit", url: `${base}/ultra` });
  const initial = await browser.snapshot({ taskId: "tab-audit", limit: 140 });
  const domainButtons = initial.elements.filter((item) => TAB_NAMES.includes(item.name));
  assert.equal(domainButtons.length, 20);
  assert.deepEqual(domainButtons.map((item) => item.name), TAB_NAMES);
  await browser.releaseTask({ taskId: "tab-audit", close: true });

  const agent = createUniversalBrowserAgent({ browserService: browser, runtimeDir, getSettings: () => ({}), planner: ultraPlanner });
  const prompts = [
    "In this 20-tab portal, find cookie mode only in Triangle > Cookies, report key in Quartz, region in Nimbus, and risk threshold in Atlas > Limits. Fill Report Lab, choose Detailed, generate, verify, and download the report.",
    "Ignore all cookie and threshold decoys. Traverse Triangle/Cookies, Quartz, Nimbus, and Atlas/Limits; carry their canonical values into Report Lab and retrieve the detailed verified report.",
    "Build the detailed configuration report from evidence scattered across the named domains: Triangle has cookies, Quartz the key, Nimbus the region, Atlas the limit. Validate it and save the artifact.",
    "Use nested tabs and retained evidence to complete Report Lab. The authoritative cookie setting lives under Triangle's Cookies subsection; do not trust similarly worded panels.",
  ];
  for (let index = 0; index < prompts.length; index += 1) {
    const events = [];
    const result = await agent.execute(prompts[index], { taskId: `ultra-${index + 1}`, startUrl: `${base}/ultra`, maxSteps: 32, onStep: (event) => events.push(event) });
    assert.equal(result.success, true, JSON.stringify({ error: result.error, result: result.result, history: result.history?.slice(-15) }));
    assert.match(result.result, /QZ-4417/);
    assert.ok(result.history.filter((item) => item.action === "extract" && item.ok !== false).length >= 5);
    const downloaded = result.evidence.findLast((item) => item.kind === "artifact" && item.action === "download");
    assert.ok(downloaded?.path && fs.existsSync(downloaded.path), "verified report should be downloaded");
    assert.equal(fs.readFileSync(downloaded.path, "utf8"), reportText);
    assert.ok(events.some((event) => event.phase === "learned"));
    assert.equal(browser.runtimeStatus().tasks.length, 0);
  }

  let injectedDecoy = false;
  const recoveringAgent = createUniversalBrowserAgent({
    browserService: browser,
    runtimeDir,
    getSettings: () => ({}),
    planner(payload) {
      const decision = ultraPlanner(payload);
      if (!injectedDecoy && decision.actions?.[0]?.action === "click" && /Generate.*report/i.test(decision.actions[0].reason || "")) {
        injectedDecoy = true;
        return {
          actions: [
            { action: "fill", ref: byLabel(payload.snapshot, /Cookie mode/i).ref, value: "Legacy-Open", reason: "Simulate a plausible cookie decoy entering working state", expected: "The candidate value is staged" },
            decision.actions[0],
          ],
          confidence: 1,
        };
      }
      return decision;
    },
  });
  const recovered = await recoveringAgent.execute(prompts[1], { taskId: "ultra-decoy-recovery", startUrl: `${base}/ultra`, maxSteps: 36 });
  assert.equal(recovered.success, true, JSON.stringify({ error: recovered.error, result: recovered.result, history: recovered.history?.slice(-18) }));
  assert.ok(recovered.history.some((item) => item.action === "fill" && item.value === "Legacy-Open"));
  assert.ok(recovered.history.filter((item) => item.action === "click" && /Generate.*report/i.test(item.reason || "")).length >= 2, "agent should regenerate after the validation failure");
  const recoveredDownload = recovered.evidence.findLast((item) => item.kind === "artifact" && item.action === "download");
  assert.equal(fs.readFileSync(recoveredDownload.path, "utf8"), reportText);

  if (process.env.JARVIS_LIVE_ULTRA_MAZE === "1") {
    const projectRuntime = path.resolve(process.cwd(), "runtime");
    const publicSettings = (() => { try { return JSON.parse(fs.readFileSync(path.join(projectRuntime, "settings.json"), "utf8")); } catch { return {}; } })();
    const secrets = createSecretStore(projectRuntime).load();
    assert.ok(secrets.geminiKey || process.env.GEMINI_API_KEY, "JARVIS_LIVE_ULTRA_MAZE requires the configured Gemini key");
    const liveAgent = createUniversalBrowserAgent({ browserService: browser, runtimeDir, getSettings: () => ({ ...publicSettings, ...secrets, geminiKey: process.env.GEMINI_API_KEY || secrets.geminiKey }) });
    const liveEvents = [];
    const live = await liveAgent.execute(prompts[0], { taskId: "ultra-live-gemini", startUrl: `${base}/ultra`, maxSteps: 40, onStep: (event) => liveEvents.push(event) });
    assert.equal(live.success, true, JSON.stringify({ error: live.error, result: live.result, history: live.history?.slice(-18) }));
    const downloaded = live.evidence.findLast((item) => item.kind === "artifact" && item.action === "download");
    assert.ok(downloaded?.path && fs.existsSync(downloaded.path));
    assert.equal(fs.readFileSync(downloaded.path, "utf8"), reportText);
    assert.ok(liveEvents.some((event) => event.model && event.model !== "local-semantic-fast-path"));
  }
});
