const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium: defaultChromium } = require("playwright");
const {
  browserError,
  cleanBrowserString,
  detectPromptInjection,
  isBlockedTarget,
  isSensitiveAction,
  normalizeBrowserUrl,
  validateScreenshotName,
  validateSelector,
} = require("./browser-validation");

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 12_000;
const MAX_EXTRACT_LENGTH = 50_000;
const MAX_TYPE_LENGTH = 10_000;
const MAX_SNAPSHOT_ELEMENTS = 120;
const MAX_COMMIT_OPERATIONS = 8;

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function createBrowserAutomationService({
  runtimeDir,
  browserType = defaultChromium,
  headless = process.env.JARVIS_BROWSER_HEADLESS === "1",
  channel = process.platform === "win32" ? "chrome" : undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
  workspaceRoot = path.resolve(runtimeDir, ".."),
} = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");

  const profileDir = path.join(runtimeDir, "browser-profile");
  const screenshotsDir = path.join(runtimeDir, "browser-screenshots");
  const downloadsDir = path.join(runtimeDir, "browser-downloads");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  let context = null;
  let page = null;
  let launchPromise = null;
  let operationQueue = Promise.resolve();
  let pageCounter = 0;
  let activePageId = "";
  let lastSnapshot = null;
  const pageIds = new Map();
  const refs = new Map();
  const recentDialogs = [];

  function registerPage(candidate) {
    if (pageIds.has(candidate)) return pageIds.get(candidate);
    pageIds.set(candidate, `page-${++pageCounter}`);
    const id = pageIds.get(candidate);
    candidate.on("dialog", async (dialog) => {
      recentDialogs.unshift({
        pageId: id,
        type: dialog.type(),
        message: dialog.message().slice(0, 1_000),
        defaultValue: dialog.defaultValue().slice(0, 500),
        handled: "dismissed",
        at: new Date().toISOString(),
      });
      recentDialogs.splice(20);
      await dialog.dismiss().catch(() => undefined);
    });
    candidate.on("popup", (popup) => {
      registerPage(popup);
      page = popup;
      activePageId = pageIds.get(popup);
      refs.clear();
    });
    return id;
  }

  async function launchContext() {
    const options = {
      headless,
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      timeout: navigationTimeoutMs,
      args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
    };

    try {
      return await browserType.launchPersistentContext(profileDir, channel ? { ...options, channel } : options);
    } catch (error) {
      if (!channel) throw error;
      return browserType.launchPersistentContext(profileDir, options);
    }
  }

  async function ensurePage() {
    if (!context) {
      if (!launchPromise) {
        launchPromise = launchContext()
          .then((launched) => {
            context = launched;
            for (const candidate of context.pages()) registerPage(candidate);
            context.on("page", registerPage);
            context.once("close", () => {
              context = null;
              page = null;
            });
            return launched;
          })
          .finally(() => {
            launchPromise = null;
          });
      }
      await launchPromise;
    }

    if (!page || page.isClosed()) {
      page = context.pages().find((candidate) => !candidate.isClosed()) || await context.newPage();
      registerPage(page);
      activePageId = pageIds.get(page);
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(navigationTimeoutMs);
    }
    return page;
  }

  function runExclusive(operation) {
    const pending = operationQueue.then(operation, operation);
    operationQueue = pending.catch(() => undefined);
    return pending;
  }

  async function currentPageSummary(activePage) {
    return {
      pageId: registerPage(activePage),
      url: activePage.url(),
      title: await activePage.title(),
    };
  }

  function loginSignalsFromSnapshot(snapshot = {}) {
    const text = `${snapshot.title || ""} ${snapshot.pageText || ""}`;
    const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
    const passwordFields = elements.filter((element) => String(element.type || "").toLowerCase() === "password");
    const loginFields = elements.filter((element) => {
      const label = `${element.name || ""} ${element.text || ""} ${element.placeholder || ""} ${element.fieldName || ""} ${element.id || ""}`;
      return /(email|username|user id|netid|login|sign in)/i.test(label);
    });
    return {
      loginLikelyRequired: passwordFields.length > 0 || /(log in|login|sign in|single sign-on|sso|password|username|netid)/i.test(text),
      passwordFieldCount: passwordFields.length,
      loginFieldCount: loginFields.length,
    };
  }

  function summarizeSnapshot(snapshot = {}) {
    const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
    const forms = elements.filter((element) => ["textbox", "combobox", "checkbox", "file"].includes(String(element.role || "")) || ["input", "textarea", "select"].includes(String(element.tag || "")));
    const buttons = elements.filter((element) => String(element.role || "") === "button" || String(element.tag || "") === "button");
    const links = elements.filter((element) => String(element.role || "") === "link" || String(element.tag || "") === "a");
    const fileInputs = elements.filter((element) => String(element.type || "").toLowerCase() === "file");
    const sensitive = elements.filter((element) => element.sensitive);
    const login = loginSignalsFromSnapshot(snapshot);
    return {
      page: { pageId: snapshot.pageId, url: snapshot.url, title: snapshot.title },
      login,
      counts: {
        elements: elements.length,
        forms: forms.length,
        buttons: buttons.length,
        links: links.length,
        fileInputs: fileInputs.length,
        sensitiveControls: sensitive.length,
      },
      likelyActions: [
        fileInputs.length ? "file_upload_possible" : "",
        buttons.some((button) => /submit|send|post|publish|confirm|continue|checkout|buy|sell|place/i.test(`${button.name || ""} ${button.text || ""}`)) ? "consequential_button_present" : "",
        login.loginLikelyRequired ? "manual_login_required" : "",
        snapshot.securitySignals?.length ? "prompt_injection_risk" : "",
      ].filter(Boolean),
      topControls: elements.slice(0, 30).map((element) => ({
        ref: element.ref,
        role: element.role,
        name: element.name || element.text || element.placeholder || element.id || "",
        type: element.type || "",
        sensitive: Boolean(element.sensitive),
      })),
      plainEnglish: [
        snapshot.title ? `Page: ${snapshot.title}.` : "Page title is unavailable.",
        login.loginLikelyRequired ? "Login appears to be required; the user must authenticate manually." : "No obvious login wall detected.",
        `${buttons.length} button(s), ${links.length} link(s), ${forms.length} form control(s), ${fileInputs.length} file upload control(s).`,
        snapshot.securitySignals?.length ? "Prompt-injection text was detected; actions are blocked until reviewed." : "",
      ].filter(Boolean).join(" "),
    };
  }

  function invalidateSnapshot() {
    for (const entry of refs.values()) entry.handle.dispose().catch(() => undefined);
    refs.clear();
    lastSnapshot = null;
  }

  async function resolveTarget(activePage, args = {}) {
    if (args.ref) {
      const entry = refs.get(String(args.ref));
      if (!entry || entry.pageId !== pageIds.get(activePage)) {
        throw browserError(`Element reference ${args.ref} is stale. Take a new browser snapshot.`);
      }
      const connected = await entry.handle.evaluate((element) => element.isConnected).catch(() => false);
      if (!connected) throw browserError(`Element reference ${args.ref} is stale. Take a new browser snapshot.`);
      return { handle: entry.handle, metadata: entry.metadata, target: String(args.ref) };
    }
    const selector = validateSelector(args.selector);
    const locator = activePage.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout: boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000) });
    const metadata = await rejectBlockedLocator(locator, selector);
    return { locator, metadata, target: selector };
  }

  async function targetMetadata(target) {
    if (target.metadata) return target.metadata;
    return target.handle.evaluate((element) => ({
      id: element.id || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      text: (element.innerText || element.textContent || "").trim().slice(0, 500),
      title: element.getAttribute("title") || "",
      href: element instanceof HTMLAnchorElement ? element.href : "",
    }));
  }

  function sensitiveDescription(metadata = {}) {
    return [metadata.text, metadata.ariaLabel, metadata.title, metadata.name, metadata.id, metadata.href].filter(Boolean).join(" ");
  }

  function assertSafeAction(metadata, allowSensitive) {
    const description = sensitiveDescription(metadata);
    if (isBlockedTarget(description)) throw browserError("JARVIS will not interact with CAPTCHA or anti-bot challenge controls", 403);
    if (!allowSensitive && isSensitiveAction(description)) {
      throw browserError("This control appears to perform a consequential action. Use browser_commit so the user can approve it.", 409);
    }
  }

  function uploadRootMap() {
    const home = os.homedir();
    return {
      runtime: path.resolve(runtimeDir),
      workspace: path.resolve(workspaceRoot),
      desktop: path.resolve(fs.existsSync(path.join(home, "OneDrive", "Desktop")) ? path.join(home, "OneDrive", "Desktop") : path.join(home, "Desktop")),
      documents: path.resolve(fs.existsSync(path.join(home, "OneDrive", "Documents")) ? path.join(home, "OneDrive", "Documents") : path.join(home, "Documents")),
      downloads: path.resolve(path.join(home, "Downloads")),
    };
  }

  function allowedUploadRoots() {
    return [...new Set(Object.values(uploadRootMap()))];
  }

  function approvedFile(candidate) {
    const supplied = String(candidate || "").trim();
    if (!supplied) throw browserError("A file path is required");
    const resolved = fs.realpathSync.native(path.resolve(supplied));
    if (!fs.statSync(resolved).isFile()) throw browserError("The upload path must point to a file");
    const allowed = allowedUploadRoots().some((root) => {
      const relative = path.relative(root, resolved);
      return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!allowed) throw browserError("The file is outside approved JARVIS upload locations", 403);
    return resolved;
  }

  async function rejectBlockedLocator(locator, selector) {
    const metadata = await locator.evaluate((element) => ({
      id: element.id || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      text: (element.innerText || element.textContent || "").trim().slice(0, 500),
      href: element instanceof HTMLAnchorElement ? element.href : "",
      className: typeof element.className === "string" ? element.className : "",
      outerHtml: element.outerHTML.slice(0, 1_000),
    }));
    if (isBlockedTarget(`${selector} ${JSON.stringify(metadata)}`)) {
      throw browserError("JARVIS will not interact with CAPTCHA or anti-bot challenge controls", 403);
    }
    return metadata;
  }

  async function navigate(args = {}) {
    const url = normalizeBrowserUrl(args.url);
    const waitUntil = ["commit", "domcontentloaded", "load"].includes(args.waitUntil)
      ? args.waitUntil
      : "domcontentloaded";
    return runExclusive(async () => {
      const activePage = await ensurePage();
      const response = await activePage.goto(url, {
        waitUntil,
        timeout: boundedNumber(args.timeoutMs, navigationTimeoutMs, 1_000, 20_000),
      });
      invalidateSnapshot();
      return {
        ...await currentPageSummary(activePage),
        status: response?.status() || null,
        ok: response?.ok() ?? true,
      };
    });
  }

  async function status() {
    return runExclusive(async () => {
      const activePage = await ensurePage();
      const openPages = context.pages().filter((candidate) => !candidate.isClosed());
      const tabs = await Promise.all(openPages.map(async (candidate) => ({
        pageId: registerPage(candidate),
        active: candidate === activePage,
        url: candidate.url(),
        title: await candidate.title().catch(() => ""),
      })));
      return {
        activePage: await currentPageSummary(activePage),
        tabs,
        profileDir,
        downloadsDir,
        screenshotsDir,
        snapshotAvailable: Boolean(lastSnapshot),
        snapshotUrl: lastSnapshot?.url || "",
        snapshotTitle: lastSnapshot?.title || "",
        snapshotElementCount: lastSnapshot?.elements?.length || 0,
        dialogs: recentDialogs.slice(0, 5),
      };
    });
  }

  async function loginHandoff(args = {}) {
    const targetUrl = cleanBrowserString(args.url, 1000);
    if (targetUrl) await navigate({ url: targetUrl, timeoutMs: args.timeoutMs });
    const snap = await snapshot({ selector: args.selector, limit: args.limit || 80, timeoutMs: args.timeoutMs });
    const signals = loginSignalsFromSnapshot(snap);
    return {
      ...snap,
      ...signals,
      handoffRequired: signals.loginLikelyRequired,
      instruction: signals.loginLikelyRequired
        ? "Complete login manually in the opened JARVIS browser. JARVIS will not type passwords or bypass login challenges."
        : "No obvious login wall was detected. Take a browser_snapshot next before acting.",
    };
  }

  async function pageBrief(args = {}) {
    const snap = await snapshot({ selector: args.selector, limit: args.limit || 100, timeoutMs: args.timeoutMs });
    return { ...summarizeSnapshot(snap), snapshot: snap };
  }

  async function inspect(args = {}) {
    const selector = validateSelector(args.selector, { optional: true }) || "body";
    const limit = boundedNumber(args.limit, 40, 1, 100);
    return runExclusive(async () => {
      const activePage = await ensurePage();
      const root = activePage.locator(selector).first();
      await root.waitFor({ state: "attached", timeout: boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000) });
      const elements = await root.locator("a, button, input, textarea, select, [role], [tabindex]").evaluateAll(
        (nodes, maximum) => nodes.slice(0, maximum).map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          text: (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().slice(0, 300),
          id: element.id || "",
          name: element.getAttribute("name") || "",
          type: element.getAttribute("type") || "",
          href: element instanceof HTMLAnchorElement ? element.href : "",
          disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        })),
        limit,
      );
      return { ...await currentPageSummary(activePage), selector, elements };
    });
  }

  async function snapshot(args = {}) {
    const selector = validateSelector(args.selector, { optional: true }) || "body";
    const limit = boundedNumber(args.limit, 80, 1, MAX_SNAPSHOT_ELEMENTS);
    return runExclusive(async () => {
      const activePage = await ensurePage();
      invalidateSnapshot();
      const root = activePage.locator(selector).first();
      await root.waitFor({ state: "attached", timeout: boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000) });
      const handles = await root.locator("a, button, input, textarea, select, summary, [role], [tabindex], [contenteditable=true]").elementHandles();
      const elements = [];
      for (const handle of handles) {
        if (elements.length >= limit) {
          await handle.dispose().catch(() => undefined);
          continue;
        }
        const visible = await handle.isVisible().catch(() => false);
        if (!visible) {
          await handle.dispose().catch(() => undefined);
          continue;
        }
        const metadata = await handle.evaluate((element) => {
          const labels = element.labels ? [...element.labels].map((label) => label.innerText.trim()).filter(Boolean) : [];
          const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 400);
          const ariaLabel = element.getAttribute("aria-label") || "";
          const placeholder = element.getAttribute("placeholder") || "";
          const title = element.getAttribute("title") || "";
          const role = element.getAttribute("role") || ({
            A: "link",
            BUTTON: "button",
            SELECT: "combobox",
            TEXTAREA: "textbox",
            INPUT: element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : element.type === "file" ? "file" : "textbox",
          })[element.tagName] || "";
          return {
            tag: element.tagName.toLowerCase(),
            role,
            name: (ariaLabel || labels[0] || text || placeholder || title || element.getAttribute("name") || element.id || "").slice(0, 300),
            text,
            id: element.id || "",
            fieldName: element.getAttribute("name") || "",
            type: element.getAttribute("type") || "",
            placeholder,
            title,
            href: element instanceof HTMLAnchorElement ? element.href : "",
            disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
            checked: "checked" in element ? Boolean(element.checked) : undefined,
            value: element instanceof HTMLInputElement && element.type === "password"
              ? ""
              : "value" in element
                ? String(element.value || "").slice(0, 300)
                : "",
          };
        });
        if (isBlockedTarget(JSON.stringify(metadata))) {
          await handle.dispose().catch(() => undefined);
          continue;
        }
        const ref = `e${elements.length + 1}`;
        const pageId = pageIds.get(activePage);
        refs.set(ref, { pageId, handle, metadata });
        elements.push({ ref, ...metadata, sensitive: metadata.type === "password" || isSensitiveAction(sensitiveDescription(metadata)) });
      }
      const visibleText = await root.innerText().catch(() => "");
      const security = detectPromptInjection(visibleText.slice(0, 30_000));
      const result = {
        ...await currentPageSummary(activePage),
        selector,
        elements,
        pageText: visibleText.replace(/\s+/g, " ").trim().slice(0, 8_000),
        securitySignals: security.detected ? [security] : [],
        dialogs: recentDialogs.slice(0, 5),
      };
      lastSnapshot = result;
      return result;
    });
  }

  async function tabs(args = {}) {
    return runExclusive(async () => {
      await ensurePage();
      const openPages = context.pages().filter((candidate) => !candidate.isClosed());
      if (args.action === "switch") {
        const requested = String(args.pageId || "");
        const nextPage = openPages.find((candidate) => pageIds.get(candidate) === requested);
        if (!nextPage) throw browserError(`Browser tab ${requested} was not found`, 404);
        page = nextPage;
        activePageId = requested;
        await page.bringToFront();
        invalidateSnapshot();
      } else if (args.action === "close") {
        const requested = String(args.pageId || activePageId);
        const closing = openPages.find((candidate) => pageIds.get(candidate) === requested);
        if (!closing) throw browserError(`Browser tab ${requested} was not found`, 404);
        await closing.close();
        page = context.pages().find((candidate) => !candidate.isClosed()) || await context.newPage();
        registerPage(page);
        activePageId = pageIds.get(page);
        invalidateSnapshot();
      } else if (args.action === "new") {
        page = await context.newPage();
        registerPage(page);
        activePageId = pageIds.get(page);
        if (args.url) await page.goto(normalizeBrowserUrl(args.url), { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
        invalidateSnapshot();
      }
      const summaries = await Promise.all(context.pages().filter((candidate) => !candidate.isClosed()).map(async (candidate) => ({
        pageId: registerPage(candidate),
        active: candidate === page,
        url: candidate.url(),
        title: await candidate.title().catch(() => ""),
      })));
      return { activePageId, tabs: summaries };
    });
  }

  async function performAction(activePage, args = {}, { allowSensitive = false } = {}) {
    const action = String(args.action || "").toLowerCase();
    if (!["click", "fill", "press", "select", "check", "uncheck", "hover", "scroll", "upload", "download"].includes(action)) {
      throw browserError("Unsupported browser action");
    }
    const target = await resolveTarget(activePage, args);
    const metadata = await targetMetadata(target);
    assertSafeAction(metadata, allowSensitive);
    const element = target.handle || target.locator;
    const timeout = boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000);
    if (action === "click") {
      await element.click({ timeout });
      invalidateSnapshot();
      return { action, target: target.target, clicked: true, ...await currentPageSummary(activePage) };
    }
    if (action === "fill") {
      if (String(metadata.type).toLowerCase() === "password") throw browserError("JARVIS will not enter passwords. Complete authentication manually.", 403);
      const value = String(args.value ?? "").slice(0, MAX_TYPE_LENGTH);
      if (args.append) await element.pressSequentially(value, { delay: boundedNumber(args.delayMs, 0, 0, 100), timeout });
      else await element.fill(value, { timeout });
      return { action, target: target.target, characters: value.length, appended: Boolean(args.append), url: activePage.url() };
    }
    if (action === "press") {
      const key = cleanBrowserString(args.key, 100);
      if (!key) throw browserError("A keyboard key is required");
      await element.press(key, { timeout });
      invalidateSnapshot();
      return { action, target: target.target, key, url: activePage.url() };
    }
    if (action === "select") {
      const selected = await element.selectOption(args.values || args.value, { timeout });
      return { action, target: target.target, selected, url: activePage.url() };
    }
    if (action === "check" || action === "uncheck") {
      await element[action]({ timeout });
      return { action, target: target.target, checked: action === "check", url: activePage.url() };
    }
    if (action === "hover") {
      await element.hover({ timeout });
      return { action, target: target.target, hovered: true, url: activePage.url() };
    }
    if (action === "scroll") {
      const deltaY = boundedNumber(args.deltaY, 600, -5_000, 5_000);
      await element.evaluate((node, amount) => node.scrollBy ? node.scrollBy(0, amount) : node.scrollIntoView({ block: "center" }), deltaY);
      return { action, target: target.target, deltaY, url: activePage.url() };
    }
    if (action === "upload") {
      const paths = (Array.isArray(args.paths) ? args.paths : [args.path]).filter(Boolean).map(approvedFile);
      if (!paths.length) throw browserError("At least one approved upload file is required");
      await element.setInputFiles(paths, { timeout });
      return { action, target: target.target, files: paths.map((file) => ({ path: file, bytes: fs.statSync(file).size })), url: activePage.url() };
    }
    const downloadPromise = activePage.waitForEvent("download", { timeout });
    await element.click({ timeout });
    const download = await downloadPromise;
    const suggested = path.basename(download.suggestedFilename()).replace(/[^a-z0-9._-]/gi, "_") || `download-${Date.now()}`;
    const destination = path.join(downloadsDir, `${Date.now()}-${suggested}`);
    await download.saveAs(destination);
    invalidateSnapshot();
    return { action, target: target.target, path: destination, bytes: fs.statSync(destination).size, url: activePage.url() };
  }

  async function act(args = {}) {
    return runExclusive(async () => {
      if (!lastSnapshot) throw browserError("Take a fresh browser_snapshot before acting.");
      if (lastSnapshot?.securitySignals?.length) {
        throw browserError("The page contains possible prompt-injection instructions. JARVIS stopped before acting.", 409);
      }
      return performAction(await ensurePage(), args);
    });
  }

  async function commit(args = {}) {
    const operations = Array.isArray(args.operations) ? args.operations.slice(0, MAX_COMMIT_OPERATIONS) : [args];
    if (!operations.length) throw browserError("At least one browser commit operation is required");
    const terminalIndex = operations.findIndex((operation) => ["click", "download"].includes(String(operation.action || "").toLowerCase()));
    if (terminalIndex >= 0 && terminalIndex !== operations.length - 1) {
      throw browserError("A commit click or download must be the final operation in the approved batch.");
    }
    return runExclusive(async () => {
      const activePage = await ensurePage();
      if (!lastSnapshot) throw browserError("Take a fresh browser_snapshot before preparing a commit.");
      if (lastSnapshot?.securitySignals?.length) {
        throw browserError("The page contains possible prompt-injection instructions. JARVIS stopped before committing.", 409);
      }
      const results = [];
      for (const operation of operations) {
        results.push(await performAction(activePage, operation, { allowSensitive: true }));
      }
      return { committed: true, operations: results, ...await currentPageSummary(activePage) };
    });
  }

  async function findFiles(args = {}) {
    const query = cleanBrowserString(args.query, 200).toLowerCase();
    const extension = cleanBrowserString(args.extension, 30).toLowerCase().replace(/^\./, "");
    const limit = boundedNumber(args.limit, 20, 1, 50);
    const location = cleanBrowserString(args.location, 30).toLowerCase();
    const rootMap = uploadRootMap();
    if (location && !rootMap[location]) throw browserError("File search location must be runtime, workspace, desktop, documents, or downloads");
    const roots = (location ? [rootMap[location]] : Object.values(rootMap)).filter((root) => fs.existsSync(root));
    const results = [];
    const deadline = Date.now() + boundedNumber(args.timeoutMs, 1_500, 250, 5_000);
    for (const root of roots) {
      const queue = [{ directory: root, depth: 0 }];
      let visited = 0;
      let rootMatches = 0;
      while (queue.length && rootMatches < limit && visited < 2_000 && Date.now() < deadline) {
        const { directory: current, depth } = queue.shift();
        visited += 1;
        let entries = [];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (entry.name.startsWith(".") || ["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
          const candidate = path.join(current, entry.name);
          if (entry.isDirectory() && depth < 6) queue.push({ directory: candidate, depth: depth + 1 });
          else if (entry.isFile()) {
            const matchesQuery = !query || entry.name.toLowerCase().includes(query);
            const matchesExtension = !extension || path.extname(entry.name).slice(1).toLowerCase() === extension;
            if (matchesQuery && matchesExtension) {
              const stats = fs.statSync(candidate);
              results.push({ path: candidate, name: entry.name, bytes: stats.size, modifiedAt: stats.mtime.toISOString() });
              rootMatches += 1;
            }
          }
          if (rootMatches >= limit) break;
        }
      }
      if (Date.now() >= deadline) break;
    }
    results.sort((left, right) => new Date(right.modifiedAt) - new Date(left.modifiedAt));
    return { files: results.slice(0, limit), roots, timedOut: Date.now() >= deadline };
  }

  async function click(args = {}) {
    return runExclusive(async () => performAction(await ensurePage(), { ...args, action: "click" }));
  }

  async function type(args = {}) {
    return runExclusive(async () => {
      const result = await performAction(await ensurePage(), { ...args, action: "fill" });
      return { ...result, typed: true };
    });
  }

  async function extract(args = {}) {
    const selector = validateSelector(args.selector, { optional: true }) || "body";
    const format = args.format === "html" ? "html" : "text";
    const maxLength = boundedNumber(args.maxLength, 12_000, 1, MAX_EXTRACT_LENGTH);
    return runExclusive(async () => {
      const activePage = await ensurePage();
      const locator = activePage.locator(selector).first();
      await locator.waitFor({ state: "attached", timeout: boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000) });
      const content = format === "html" ? await locator.innerHTML() : await locator.innerText();
      return {
        ...await currentPageSummary(activePage),
        selector,
        format,
        content: content.slice(0, maxLength),
        truncated: content.length > maxLength,
      };
    });
  }

  async function screenshot(args = {}) {
    const requestedName = validateScreenshotName(args.name);
    return runExclusive(async () => {
      const activePage = await ensurePage();
      const filename = requestedName || `jarvis-browser-${Date.now()}.png`;
      const outputPath = path.join(screenshotsDir, filename);
      await activePage.screenshot({
        path: outputPath,
        fullPage: Boolean(args.fullPage),
        timeout: boundedNumber(args.timeoutMs, navigationTimeoutMs, 1_000, 20_000),
      });
      return {
        ...await currentPageSummary(activePage),
        path: outputPath,
        bytes: fs.statSync(outputPath).size,
        fullPage: Boolean(args.fullPage),
      };
    });
  }

  async function wait(args = {}) {
    const selector = validateSelector(args.selector, { optional: true });
    const waitMs = boundedNumber(args.milliseconds, 500, 0, 10_000);
    const state = ["attached", "detached", "visible", "hidden"].includes(args.state) ? args.state : "visible";
    return runExclusive(async () => {
      const activePage = await ensurePage();
      if (selector) {
        await activePage.locator(selector).first().waitFor({
          state,
          timeout: boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000),
        });
        return { waited: true, selector, state, url: activePage.url() };
      }
      await activePage.waitForTimeout(waitMs);
      return { waited: true, milliseconds: waitMs, url: activePage.url() };
    });
  }

  async function verify(args = {}) {
    const selector = validateSelector(args.selector, { optional: true });
    const expectedText = cleanBrowserString(args.expectedText, 2_000);
    const urlIncludes = cleanBrowserString(args.urlIncludes, 1_000);
    const titleIncludes = cleanBrowserString(args.titleIncludes, 500);
    if (!selector && !expectedText && !urlIncludes && !titleIncludes) {
      throw browserError("Verification requires a selector, expected text, URL fragment, or title fragment");
    }
    return runExclusive(async () => {
      const activePage = await ensurePage();
      const summary = await currentPageSummary(activePage);
      const checks = [];
      if (selector) {
        const locator = activePage.locator(selector).first();
        const visible = await locator.isVisible().catch(() => false);
        checks.push({ check: "selector_visible", expected: selector, passed: visible });
        if (expectedText) {
          const actual = visible ? await locator.innerText().catch(() => "") : "";
          checks.push({ check: "text_includes", expected: expectedText, actual: actual.slice(0, 2_000), passed: actual.includes(expectedText) });
        }
      } else if (expectedText) {
        const actual = await activePage.locator("body").innerText();
        checks.push({ check: "page_text_includes", expected: expectedText, passed: actual.includes(expectedText) });
      }
      if (urlIncludes) checks.push({ check: "url_includes", expected: urlIncludes, actual: summary.url, passed: summary.url.includes(urlIncludes) });
      if (titleIncludes) checks.push({ check: "title_includes", expected: titleIncludes, actual: summary.title, passed: summary.title.includes(titleIncludes) });
      return { ...summary, passed: checks.every((check) => check.passed), checks };
    });
  }

  async function close() {
    const activeContext = context;
    context = null;
    page = null;
    if (activeContext) await activeContext.close();
  }

  return {
    profileDir,
    screenshotsDir,
    downloadsDir,
    status,
    loginHandoff,
    pageBrief,
    navigate,
    inspect,
    snapshot,
    tabs,
    act,
    commit,
    findFiles,
    click,
    type,
    extract,
    screenshot,
    wait,
    verify,
    close,
  };
}

module.exports = { createBrowserAutomationService };
