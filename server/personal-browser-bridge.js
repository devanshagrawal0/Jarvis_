"use strict";

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createConnection } = require("@playwright/mcp");
const {
  cleanBrowserString,
  detectPromptInjection,
  isSensitiveAction,
  normalizeBrowserUrl,
  validateScreenshotName,
} = require("./browser-validation");

const MAX_ELEMENTS = 140;
const TASK_PREFIX = "jarvis-task:";

function textOf(result) {
  return (result?.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

function jsonFromText(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function parsePageHeader(text) {
  const url = text.match(/(?:Page URL|URL):\s*(\S+)/i)?.[1] || "";
  const title = text.match(/(?:Page Title|Title):\s*(.+)/i)?.[1]?.trim() || "";
  return { url, title };
}

function redactBridgeEvidence(value) {
  return String(value || "")
    .replace(/chrome-extension:\/\/[^\s)\]]+/gi, "[personal-browser-bridge]")
    .replace(/([?&](?:token|mcpRelayUrl)=)[^&\s)\]]+/gi, "$1[redacted]")
    .replace(/PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*[^\s]+/gi, "PLAYWRIGHT_MCP_EXTENSION_TOKEN=[redacted]");
}

function parseSnapshot(text, pageId, limit = MAX_ELEMENTS) {
  const safeText = redactBridgeEvidence(text);
  const header = parsePageHeader(safeText);
  const elements = [];
  const seen = new Set();
  const lines = safeText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (elements.length >= limit) break;
    const ref = line.match(/\[(?:ref|target)=([^\]\s]+)[^\]]*\]/i)?.[1];
    if (!ref || seen.has(ref)) continue;
    const item = line.match(/^\s*-\s*([\w-]+)(?:\s+"([^"]*)")?/);
    const role = item?.[1] || "element";
    const tail = line.match(/\]\s*:\s*["']?(.+?)["']?\s*$/)?.[1]?.trim() || "";
    const editable = ["textbox", "searchbox", "input", "textarea"].includes(role);
    let inferredLabel = "";
    if (editable && !item?.[2] && !tail) {
      const indentation = line.match(/^\s*/)?.[0]?.length || 0;
      for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 6); lookahead += 1) {
        const candidateLine = lines[lookahead];
        const candidateIndent = candidateLine.match(/^\s*/)?.[0]?.length || 0;
        if (candidateIndent < indentation) break;
        const siblingText = candidateLine.match(/^\s*-\s*(?:generic|text)(?:\s+"([^"]*)")?\s*(?::\s*(.+))?\s*$/i);
        const label = String(siblingText?.[1] || siblingText?.[2] || "").replace(/^['"]|['"]$/g, "").trim();
        if (label && label.length <= 120 && /\b(message|write|reply|search|recipient|email|comment|caption|subject|address|name)\b/i.test(label)) {
          inferredLabel = label;
          break;
        }
      }
    }
    const name = (item?.[2] || inferredLabel || tail || line.replace(/\[[^\]]*\]/g, "").replace(/^\s*-\s*/, "").replace(/^\w+\s*:?[ ]*/, "").trim()).slice(0, 300);
    const type = /password/i.test(line) ? "password" : /(?:type\s*=\s*file|file chooser|upload file)/i.test(line) ? "file" : "";
    seen.add(ref);
    elements.push({
      ref,
      role,
      tag: role,
      name,
      text: name,
      value: editable && tail ? tail.slice(0, 1000) : undefined,
      type,
      disabled: /\bdisabled\b/i.test(line),
      checked: /\bchecked\b/i.test(line) ? true : undefined,
      sensitive: type === "password" || isSensitiveAction(`${role} ${name}`),
    });
  }
  const security = detectPromptInjection(safeText.slice(0, 30_000));
  return {
    pageId,
    ...header,
    selector: "body",
    elements,
    pageText: safeText.replace(/\s+/g, " ").trim().slice(0, 8_000),
    securitySignals: security.detected ? [security] : [],
    dialogs: [],
  };
}

function createPersonalBrowserBridge({ runtimeDir, getSettings, fallbackService, clientFactory, windowsBroker } = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");
  const screenshotsDir = path.join(runtimeDir, "personal-browser-screenshots");
  const downloadsDir = path.join(runtimeDir, "personal-browser-downloads");
  const uploadsDir = path.join(runtimeDir, "personal-browser-uploads");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  let client = null;
  let server = null;
  let connectPromise = null;
  let operationQueue = Promise.resolve();
  let lastError = "";
  let lastSnapshot = null;
  const taskTabs = new Map();

  function settings() { return getSettings?.() || {}; }
  function normalizeExtensionToken(value) {
    return String(value || "")
      .trim()
      .replace(/^PLAYWRIGHT_MCP_EXTENSION_TOKEN\s*=\s*/i, "")
      .trim();
  }
  function token() {
    return normalizeExtensionToken(settings().playwrightExtensionToken || process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || "");
  }
  function configured() { return Boolean(token()); }

  function withTimeout(promise, timeoutMs, message, code) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = code;
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function runExclusive(operation) {
    const pending = operationQueue.then(operation, operation);
    operationQueue = pending.catch(() => undefined);
    return pending;
  }

  function stageUpload(requested) {
    const source = fs.realpathSync.native(path.resolve(String(requested)));
    const roots = [
      runtimeDir,
      path.resolve(runtimeDir, ".."),
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "Documents"),
      path.join(os.homedir(), "Downloads"),
    ].filter((root) => fs.existsSync(root)).map((root) => fs.realpathSync.native(root));
    if (!roots.some((root) => {
      const relative = path.relative(root, source);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    })) throw new Error("Upload file is outside the approved workspace, Desktop, Documents, Downloads, or JARVIS runtime roots.");
    const stats = fs.statSync(source);
    if (!stats.isFile()) throw new Error("Upload target must be a file.");
    const safeName = path.basename(source).replace(/[^a-z0-9._-]/gi, "_");
    const destination = path.join(uploadsDir, `${crypto.randomBytes(6).toString("hex")}-${safeName}`);
    fs.copyFileSync(source, destination);
    return destination;
  }

  async function createClient() {
    if (clientFactory) return clientFactory();
    process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = token();
    const pair = InMemoryTransport.createLinkedPair();
    const nextServer = await createConnection({
      extension: true,
      sharedBrowserContext: true,
      capabilities: ["core", "core-navigation", "core-tabs", "core-input", "vision"],
      outputDir: screenshotsDir,
      allowUnrestrictedFileAccess: false,
      imageResponses: "omit",
      codegen: "none",
      timeouts: { action: 8_000, navigation: 30_000, expect: 8_000 },
    });
    const nextClient = new Client({ name: "jarvis-personal-browser", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([nextServer.connect(pair[0]), nextClient.connect(pair[1])]);
    server = nextServer;
    return nextClient;
  }

  async function ensureConnected() {
    if (client) return client;
    if (!configured()) {
      const error = new Error("The personal Chrome bridge needs its one-time Playwright extension token.");
      error.code = "PERSONAL_BROWSER_SETUP_REQUIRED";
      throw error;
    }
    if (!connectPromise) {
      connectPromise = withTimeout(
        createClient(),
        15_000,
        "The Playwright extension did not answer within 15 seconds. Check that it is installed in the Chrome profile you are using and that the saved token is current.",
        "PERSONAL_BROWSER_EXTENSION_OFFLINE",
      )
        .then((connected) => {
          client = connected;
          lastError = "";
          return connected;
        })
        .catch((error) => {
          lastError = error.message;
          throw error;
        })
        .finally(() => { connectPromise = null; });
    }
    return connectPromise;
  }

  async function disposeConnection() {
    const activeClient = client;
    const activeServer = server;
    client = null;
    server = null;
    connectPromise = null;
    if (activeClient) await activeClient.close().catch(() => undefined);
    if (activeServer) await activeServer.close().catch(() => undefined);
  }

  async function call(name, args = {}, allowReconnect = true, timeoutMs = 20_000) {
    try {
      const activeClient = await ensureConnected();
      const result = await withTimeout(
        activeClient.callTool({ name, arguments: args }),
        timeoutMs,
        `Personal Chrome did not complete ${name} within ${Math.ceil(timeoutMs / 1000)} seconds.`,
        "PERSONAL_BROWSER_TOOL_TIMEOUT",
      );
      if (result?.isError) throw new Error(textOf(result) || `${name} failed`);
      return { result, text: textOf(result), structured: result?.structuredContent || null };
    } catch (error) {
      const stale = /target page, context or browser has been closed|browserbackend\.calltool|websocket closed/i.test(String(error?.message || error));
      const safeReconnect = name === "browser_navigate" || name === "browser_snapshot"
        || (name === "browser_tabs" && ["new", "list", "select"].includes(String(args.action || "")));
      if (!allowReconnect || !stale || !safeReconnect) throw error;
      await disposeConnection();
      return call(name, args, false, timeoutMs);
    }
  }

  async function newTaskTab(taskId, url = "about:blank") {
    const setupStarted = Date.now();
    const setupTimings = {};
    const marker = `${TASK_PREFIX}${taskId}`;
    const safeUrl = normalizeBrowserUrl(url === "about:blank" ? "https://www.google.com" : url);
    const launch = new URL(safeUrl);
    launch.hash = `jarvis-task-${crypto.createHash("sha256").update(marker).digest("hex").slice(0, 16)}`;
    const launchUrl = launch.href;
    let stageStarted = Date.now();
    let response = await call("browser_run_code_unsafe", {
      code: `async (page) => { const context = page.context(); const session = await context.newCDPSession(page); const created = await session.send('Target.createTarget', { url: ${JSON.stringify(launchUrl)}, newWindow: true, background: true }); const info = await session.send('Browser.getWindowForTarget', { targetId: created.targetId }); await session.send('Browser.setWindowBounds', { windowId: info.windowId, bounds: { windowState: 'minimized' } }); let target = null; for (let attempt = 0; attempt < 40; attempt++) { target = context.pages().find(candidate => candidate.url().includes(${JSON.stringify(launch.hash)})); if (target) break; await new Promise(resolve => setTimeout(resolve, 50)); } if (!target) throw new Error('The background task target was created but not attached'); return { found: true, index: context.pages().indexOf(target), url: target.url(), windowId: info.windowId, targetId: created.targetId, transport: 'cdp-background-window' }; }`,
    }, true, 12_000).catch((error) => {
      setupTimings.cdpError = cleanBrowserString(error.message, 500);
      return null;
    });
    setupTimings.cdpCreateMs = Date.now() - stageStarted;
    let details = jsonFromText(response?.text) || response?.structured || {};
    let windowDetails = null;
    if (!Number.isInteger(Number(details.index)) || Number(details.index) < 0) {
      // Compatibility fallback for Chrome builds that reject CDP new-window control.
      // The broker still starts minimized; the extension then creates one task tab.
      stageStarted = Date.now();
      windowDetails = windowsBroker
        ? await windowsBroker.call("create_browser_window", { url: launchUrl }, 25_000)
        : null;
      setupTimings.windowFallbackCreateMs = Date.now() - stageStarted;
      if (windowDetails?.handle && windowsBroker) await windowsBroker.call("minimize_window", { handle: windowDetails.handle }, 12_000).catch(() => undefined);
      stageStarted = Date.now();
      await call("browser_tabs", { action: "new" });
      await call("browser_navigate", { url: launchUrl });
      response = await call("browser_run_code_unsafe", { code: "async (page) => ({ index: page.context().pages().indexOf(page), url: page.url() })" });
      details = jsonFromText(response.text) || response.structured || {};
      setupTimings.fallbackMs = Date.now() - stageStarted;
    }
    const record = {
      taskId,
      marker,
      index: Number(details.index),
      windowHandle: windowDetails?.handle || null,
      windowProcessId: windowDetails?.processId || null,
      cdpWindowId: Number.isInteger(Number(details.windowId)) ? Number(details.windowId) : null,
      url: details.url || safeUrl,
      setupTimings,
    };
    if (!Number.isInteger(record.index) || record.index < 0) throw new Error("The personal browser bridge did not return a task tab index");
    taskTabs.set(taskId, record);
    stageStarted = Date.now();
    await call("browser_tabs", { action: "select", index: record.index });
    setupTimings.selectMs = Date.now() - stageStarted;
    stageStarted = Date.now();
    await call("browser_run_code_unsafe", { code: `async (page) => { await page.evaluate(name => { window.name = name; }, ${JSON.stringify(marker)}).catch(() => {}); return { index: page.context().pages().indexOf(page), url: page.url() }; }` });
    setupTimings.markMs = Date.now() - stageStarted;
    if (record.windowHandle && windowsBroker) {
      stageStarted = Date.now();
      await windowsBroker.call("minimize_window", { handle: record.windowHandle }, 12_000).catch((error) => {
        setupTimings.finalMinimizeWarning = cleanBrowserString(error.message, 300);
      });
      setupTimings.finalMinimizeMs = Date.now() - stageStarted;
    }
    setupTimings.totalMs = Date.now() - setupStarted;
    return record;
  }

  async function ensureTask(taskId, url) {
    const id = cleanBrowserString(taskId, 200) || "default";
    const existing = taskTabs.get(id);
    if (existing) {
      try {
        await call("browser_tabs", { action: "select", index: existing.index });
        return existing;
      } catch {
        taskTabs.delete(id);
      }
    }
    return newTaskTab(id, url || "about:blank");
  }

  async function adoptPopup(record) {
    const response = await call("browser_run_code_unsafe", {
      code: `async (page) => { const pages = page.context().pages(); let root = null; for (const candidate of pages) { const name = await candidate.evaluate(() => window.name).catch(() => ''); if (name === ${JSON.stringify(record.marker)}) { root = candidate; break; } } if (!root) return { adopted: false }; const candidates = []; for (let index = 0; index < pages.length; index++) { const opener = await pages[index].opener().catch(() => null); if (opener === root) candidates.push({ page: pages[index], index }); } const candidate = candidates.at(-1); if (!candidate) return { adopted: false }; await root.evaluate(() => { window.name = ''; }).catch(() => {}); await candidate.page.evaluate(name => { window.name = name; }, ${JSON.stringify(record.marker)}).catch(() => {}); return { adopted: true, index: candidate.index, url: candidate.page.url(), title: await candidate.page.title().catch(() => '') }; }`,
    }).catch(() => null);
    const data = jsonFromText(response?.text) || {};
    if (!data.adopted) return false;
    record.index = Number(data.index);
    record.url = data.url || record.url;
    await call("browser_tabs", { action: "select", index: record.index });
    return true;
  }

  async function navigate(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId, args.url);
      const url = normalizeBrowserUrl(args.url);
      const current = new URL(record.url);
      const requested = new URL(url);
      const alreadyAtTarget = current.origin === requested.origin && current.pathname === requested.pathname && current.search === requested.search;
      let header = { url: record.url, title: "" };
      if (!alreadyAtTarget) {
        const response = await call("browser_navigate", { url });
        header = parsePageHeader(response.text);
      }
      record.url = header.url || url;
      return { pageId: `personal-${record.taskId}`, url: record.url, title: header.title || "", reusedLaunchNavigation: alreadyAtTarget, setupTimings: record.setupTimings || null };
    });
  }

  async function snapshot(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const response = await call("browser_snapshot", { depth: 8 });
      lastSnapshot = parseSnapshot(response.text, `personal-${record.taskId}`, Math.min(Number(args.limit || MAX_ELEMENTS), MAX_ELEMENTS));
      record.url = lastSnapshot.url || record.url;
      return lastSnapshot;
    });
  }

  async function pageBrief(args = {}) {
    const value = await snapshot(args);
    return {
      page: { pageId: value.pageId, url: value.url, title: value.title },
      login: {
        loginLikelyRequired: value.elements.some((item) => item.type === "password") || /\/(?:login|signin|sign-in)(?:[/?#]|$)/i.test(value.url || ""),
        passwordFieldCount: value.elements.filter((item) => item.type === "password").length,
      },
      counts: {
        elements: value.elements.length,
        forms: value.elements.filter((item) => ["textbox", "combobox", "checkbox", "file"].includes(item.role)).length,
        buttons: value.elements.filter((item) => item.role === "button").length,
        links: value.elements.filter((item) => item.role === "link").length,
        sensitiveControls: value.elements.filter((item) => item.sensitive).length,
      },
      snapshot: value,
    };
  }

  async function inspect(args = {}) {
    const value = await snapshot({ ...args, limit: args.limit || 100 });
    return { pageId: value.pageId, url: value.url, title: value.title, selector: "body", elements: value.elements };
  }

  async function performAction(args = {}, allowSensitive = false) {
    const record = await ensureTask(args.taskId);
    const action = String(args.action || "").toLowerCase();
    const element = lastSnapshot?.elements?.find((item) => item.ref === args.ref);
    if (!allowSensitive && element?.sensitive) throw new Error("This external commit requires owner approval.");
    const target = cleanBrowserString(args.ref, 300);
    const label = cleanBrowserString(element?.name || args.ref || action, 300);
    let response;
    if (action === "click" || action === "check" || action === "uncheck") {
      response = await call("browser_click", { target, element: label });
    } else if (action === "fill") {
      if (element?.type === "password") throw new Error("JARVIS will not enter passwords.");
      response = await call("browser_type", { target, element: label, text: String(args.value ?? ""), slowly: Boolean(args.append) });
    } else if (action === "press") {
      response = await call("browser_press_key", { key: cleanBrowserString(args.key, 100) || "Enter" });
    } else if (action === "select") {
      response = await call("browser_select_option", { target, element: label, values: args.values || [String(args.value ?? "")] });
    } else if (action === "hover") {
      response = await call("browser_hover", { target, element: label });
    } else if (action === "scroll") {
      const amount = Math.max(-5_000, Math.min(5_000, Number(args.deltaY || 600)));
      response = await call("browser_run_code_unsafe", { code: `async (page) => { await page.mouse.wheel(0, ${amount}); return { url: page.url() }; }` });
    } else if (action === "upload") {
      const paths = (Array.isArray(args.paths) ? args.paths : [args.path]).filter(Boolean).map(stageUpload);
      if (!paths.length) throw new Error("At least one upload file is required.");
      response = await call("browser_run_code_unsafe", {
        code: `async (page) => { const label = ${JSON.stringify(label)}; let input = page.getByLabel(label, { exact: true }); if (await input.count().catch(() => 0) !== 1) input = page.locator('input[type=file]'); if (await input.count() !== 1) throw new Error('A unique file input was not found'); await input.setInputFiles(${JSON.stringify(paths)}); return { url: page.url(), files: ${JSON.stringify(paths.map((item) => path.basename(item)))} }; }`,
      });
    } else if (action === "download") {
      const role = cleanBrowserString(element?.role, 80) || "link";
      const root = downloadsDir.replace(/\\/g, "/");
      response = await call("browser_run_code_unsafe", {
        code: `async (page) => { const role = ${JSON.stringify(role)}; const label = ${JSON.stringify(label)}; let target = page.getByRole(role, { name: label, exact: true }); if (await target.count().catch(() => 0) !== 1) target = page.getByText(label, { exact: true }); if (await target.count() !== 1) throw new Error('A unique download control was not found'); const downloadPromise = page.waitForEvent('download'); await target.click(); const download = await downloadPromise; const name = download.suggestedFilename().replace(/[^a-z0-9._-]/gi, '_'); const destination = ${JSON.stringify(root)} + '/' + Date.now() + '-' + name; await download.saveAs(destination); return { url: page.url(), path: destination, suggestedFilename: name }; }`,
      });
    } else {
      throw new Error(`Unsupported personal browser action: ${action}`);
    }
    lastSnapshot = null;
    const header = parsePageHeader(response.text);
    if (["click", "press"].includes(action)) await adoptPopup(record);
    record.url = header.url || record.url;
    const responseData = jsonFromText(response.text) || {};
    const downloadedPath = responseData.path || response.text.match(/(?:downloaded|saved)(?:\s+file)?(?:\s+to|:)\s*[`"']?([^`"'\r\n]+\.[a-z0-9]{1,8})/i)?.[1]?.trim() || null;
    return { action, target, url: record.url, title: header.title || "", ...(downloadedPath ? { path: downloadedPath, bytes: fs.existsSync(downloadedPath) ? fs.statSync(downloadedPath).size : null } : {}), details: redactBridgeEvidence(response.text).slice(0, 2_000) };
  }

  async function act(args = {}) {
    return runExclusive(async () => {
      if (!lastSnapshot) throw new Error("Take a fresh browser snapshot before acting.");
      if (lastSnapshot.securitySignals?.length) throw new Error("Possible prompt injection detected; JARVIS stopped before acting.");
      return performAction(args, false);
    });
  }

  async function click(args = {}) {
    if (!lastSnapshot) await snapshot(args);
    return act({ ...args, action: "click" });
  }

  async function type(args = {}) {
    if (!lastSnapshot) await snapshot(args);
    const result = await act({ ...args, action: "fill", value: args.value ?? args.text });
    return { ...result, typed: true };
  }

  async function commit(args = {}) {
    return runExclusive(async () => ({ committed: true, operations: [await performAction(args, true)] }));
  }

  async function tabs(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      if (args.action === "new") return newTaskTab(cleanBrowserString(args.taskId, 200) || `tab-${Date.now()}`, args.url);
      if (args.action === "switch" && args.pageId) {
        const targetTask = String(args.pageId).replace(/^personal-/, "");
        const target = taskTabs.get(targetTask);
        if (!target) throw new Error(`Personal browser tab ${args.pageId} was not found`);
        await call("browser_tabs", { action: "select", index: target.index });
      }
      if (args.action === "close") await call("browser_tabs", { action: "close", index: record.index });
      return status();
    });
  }

  async function extract(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const selector = cleanBrowserString(args.selector, 500) || "body";
      const maxLength = Math.max(1, Math.min(Number(args.maxLength || 12_000), 50_000));
      const response = await call("browser_run_code_unsafe", { code: `async (page) => { const node = page.locator(${JSON.stringify(selector)}).first(); const text = await node.innerText(); return { url: page.url(), title: await page.title(), content: text.slice(0, ${maxLength}), total: text.length }; }` });
      const data = jsonFromText(response.text) || {};
      return { pageId: `personal-${record.taskId}`, url: data.url || record.url, title: data.title || "", selector, format: "text", content: data.content || response.text.slice(0, maxLength), truncated: Number(data.total || 0) > maxLength };
    });
  }

  async function screenshot(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const filename = validateScreenshotName(args.name) || `personal-${Date.now()}.png`;
      const outputPath = path.join(screenshotsDir, filename);
      const response = await call("browser_run_code_unsafe", {
        code: `async (page) => { await page.screenshot({ path: ${JSON.stringify(outputPath)}, fullPage: ${Boolean(args.fullPage)} }); return { url: page.url(), title: await page.title() }; }`,
      });
      const data = jsonFromText(response.text) || {};
      return { pageId: `personal-${record.taskId}`, url: data.url || record.url, title: data.title || "", path: outputPath, bytes: fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0, fullPage: Boolean(args.fullPage) };
    });
  }

  async function wait(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const seconds = Math.max(0, Math.min(Number(args.milliseconds || 500) / 1000, 10));
      await call("browser_wait_for", { time: seconds });
      return { waited: true, milliseconds: seconds * 1000, url: record.url };
    });
  }

  async function goBack(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const response = await call("browser_run_code_unsafe", { code: "async (page) => { await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); return { url: page.url(), title: await page.title() }; }" });
      const data = jsonFromText(response.text) || {};
      record.url = data.url || record.url;
      lastSnapshot = null;
      return { pageId: `personal-${record.taskId}`, url: record.url, title: data.title || "", action: "go_back" };
    });
  }

  async function reload(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const response = await call("browser_run_code_unsafe", { code: "async (page) => { await page.reload({ waitUntil: 'domcontentloaded' }); return { url: page.url(), title: await page.title() }; }" });
      const data = jsonFromText(response.text) || {};
      record.url = data.url || record.url;
      lastSnapshot = null;
      return { pageId: `personal-${record.taskId}`, url: record.url, title: data.title || "", action: "reload" };
    });
  }

  async function verify(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      const expectedText = cleanBrowserString(args.expectedText, 2_000);
      const urlIncludes = cleanBrowserString(args.urlIncludes, 1_000);
      const titleIncludes = cleanBrowserString(args.titleIncludes, 500);
      const response = await call("browser_run_code_unsafe", { code: `async (page) => ({ url: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).slice(0, 30000) })` });
      const data = jsonFromText(response.text) || {};
      const checks = [];
      if (expectedText) checks.push({ check: "page_text_includes", expected: expectedText, passed: String(data.text || "").includes(expectedText) });
      if (urlIncludes) checks.push({ check: "url_includes", expected: urlIncludes, actual: data.url || record.url, passed: String(data.url || record.url).includes(urlIncludes) });
      if (titleIncludes) checks.push({ check: "title_includes", expected: titleIncludes, actual: data.title || "", passed: String(data.title || "").includes(titleIncludes) });
      return { pageId: `personal-${record.taskId}`, url: data.url || record.url, title: data.title || "", passed: checks.length > 0 && checks.every((item) => item.passed), checks };
    });
  }

  async function reveal(args = {}) {
    return runExclusive(async () => {
      const record = await ensureTask(args.taskId);
      await call("browser_tabs", { action: "select", index: record.index });
      if (record.cdpWindowId != null) {
        await call("browser_run_code_unsafe", { code: `async (page) => { const session = await page.context().newCDPSession(page); await session.send('Browser.setWindowBounds', { windowId: ${record.cdpWindowId}, bounds: { windowState: 'normal' } }); return { restored: true }; }` });
      } else if (record.windowHandle && windowsBroker) await windowsBroker.call("restore_window", { handle: record.windowHandle }, 12_000);
      const response = await call("browser_run_code_unsafe", { code: "async (page) => { await page.bringToFront(); return { url: page.url(), title: await page.title() }; }" });
      const data = jsonFromText(response.text) || {};
      return { revealed: true, pageId: `personal-${record.taskId}`, url: data.url || record.url, title: data.title || "" };
    });
  }

  async function releaseTask(args = {}) {
    return runExclusive(async () => {
      const taskId = cleanBrowserString(args.taskId, 200);
      const record = taskTabs.get(taskId);
      if (!record) return { released: true, taskId, closed: false };
      const targetClosed = (error) => /target page, context or browser has been closed|browserbackend\.calltool|websocket closed/i.test(String(error?.message || error));
      try {
        await call("browser_tabs", { action: "select", index: record.index });
        if (args.close === true) await call("browser_tabs", { action: "close", index: record.index });
      } catch (error) {
        if (args.close !== true || !targetClosed(error)) throw error;
      }
      if (args.close === true && record.windowHandle && windowsBroker) {
        await windowsBroker.call("close_window", { handle: record.windowHandle }, 12_000).catch(() => undefined);
      }
      taskTabs.delete(taskId);
      if (args.close === true) {
        for (const other of taskTabs.values()) {
          if (other.index > record.index) other.index -= 1;
        }
      }
      return { released: true, taskId, pageId: `personal-${taskId}`, closed: args.close === true };
    });
  }

  async function status() {
    return {
      provider: "personal-chrome-extension",
      configured: configured(),
      connected: Boolean(client),
      setupRequired: !configured(),
      lastError: lastError || null,
      headless: false,
      background: true,
      focusPolicy: "minimized-task-window",
      screenshotsDir,
      downloadsDir,
      uploadsDir,
      tabs: [...taskTabs.values()].map((record) => ({ pageId: `personal-${record.taskId}`, taskId: record.taskId, active: false, url: record.url, title: "" })),
      tasks: [...taskTabs.values()].map((record) => ({ taskId: record.taskId, pageId: `personal-${record.taskId}`, url: record.url })),
    };
  }

  async function close() {
    const activeClient = client;
    client = null;
    taskTabs.clear();
    if (activeClient) await activeClient.close().catch(() => undefined);
    if (server) await server.close().catch(() => undefined);
    server = null;
  }

  return {
    profileDir: "personal-chrome-profile",
    screenshotsDir,
    downloadsDir,
    uploadsDir,
    configured,
    status,
    navigate,
    pageBrief,
    inspect,
    snapshot,
    tabs,
    act,
    click,
    type,
    commit,
    extract,
    screenshot,
    wait,
    goBack,
    reload,
    verify,
    reveal,
    releaseTask,
    close,
    findFiles: (...args) => fallbackService.findFiles(...args),
    loginHandoff: async () => ({ handoffRequired: false, instruction: "This bridge uses the existing signed-in personal Chrome session." }),
    completeLoginHandoff: async () => ({ completed: true, authenticated: true, instruction: "The personal Chrome session is already attached." }),
  };
}

module.exports = { createPersonalBrowserBridge, parseSnapshot, redactBridgeEvidence, textOf };
