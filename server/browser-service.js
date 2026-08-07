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
const { trace } = require("./automation/trace");

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 12_000;
const MAX_EXTRACT_LENGTH = 50_000;
const MAX_TYPE_LENGTH = 10_000;
const MAX_SNAPSHOT_ELEMENTS = 240;

// One selector, used for the main frame, child frames and the in-page ranking pass, so the three
// can never drift apart. `[contenteditable]` rather than `[contenteditable=true]`: chat
// composers are frequently `contenteditable="plaintext-only"`, which the equality form misses.
const SNAPSHOT_SELECTOR = "a, button, input, textarea, select, summary, [role], [tabindex], [contenteditable]";

// Ranks candidates INSIDE the page so one round trip replaces a metadata evaluate per element.
//
// The bug this exists to fix: the collector walked the DOM and stopped dead at the element budget,
// so on any page whose interactive controls come last it kept the chrome and threw away the
// controls. On an Instagram DM thread the nav rail, the notes carousel and ~15 conversation rows
// exhausted the budget before the walk ever reached the message box — the agent concluded there
// was nowhere to type, every single time, deterministically.
//
// Two changes: typable controls are ranked ABOVE decoration so they survive truncation regardless
// of DOM position, and icons that merely restate their parent link are dropped outright — they
// were consuming roughly half the budget (every <a> on Instagram is trailed by an <svg role="img">
// carrying the same accessible name).
function rankSnapshotCandidates(rootEl, options) {
  const { selector, limit } = options;
  const nodes = Array.from(rootEl.querySelectorAll(selector));
  const scored = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const el = nodes[index];
    if (!el.getClientRects().length) continue;          // not rendered — never actionable
    const tag = String(el.tagName || "").toLowerCase();
    const role = String(el.getAttribute("role") || "").toLowerCase();
    const label = String(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();

    // Decorative icon duplicating its own link/button: no independent target, no new information.
    if ((tag === "svg" || tag === "img") && (role === "img" || !role)) {
      const owner = el.closest("a, button, [role='button'], [role='link']");
      if (owner && owner !== el) {
        const ownerLabel = String(owner.getAttribute("aria-label") || owner.textContent || "").replace(/\s+/g, " ").trim();
        if (!label || ownerLabel.includes(label)) continue;
      }
    }

    const editable = el.isContentEditable === true || el.hasAttribute("contenteditable");
    const type = String(el.getAttribute("type") || "").toLowerCase();
    let priority = 3;
    if (editable
      || role === "textbox" || role === "searchbox" || role === "combobox"
      || tag === "textarea" || tag === "select"
      || (tag === "input" && !["hidden", "submit", "button", "reset"].includes(type))) {
      priority = 0;                                     // somewhere to type — never truncate these
    } else if (tag === "button" || role === "button" || ["submit", "button", "reset"].includes(type)) {
      priority = 1;                                     // how the typed thing gets committed
    } else if (tag === "a" || role === "link") {
      priority = 2;
    }
    scored.push({ index, priority });
  }
  // A page with a long list of role="button" rows (every chat app) can still starve the one
  // button that matters, because the rows tie with it and come first in the DOM. The control that
  // commits what you typed sits BESIDE the box you type into — send, attach, emoji — so promote
  // buttons neighbouring a typable control above the general button population. Without this the
  // agent can find the composer, type, and then have nowhere to click.
  const NEIGHBOUR_WINDOW = 10;
  for (let i = 0; i < scored.length; i += 1) {
    if (scored[i].priority !== 0) continue;
    for (let j = Math.max(0, i - NEIGHBOUR_WINDOW); j < Math.min(scored.length, i + NEIGHBOUR_WINDOW + 1); j += 1) {
      if (scored[j].priority === 1) scored[j].priority = 0.5;
    }
  }
  // Highest-value first to decide WHAT survives, then back to DOM order so refs read naturally.
  scored.sort((left, right) => left.priority - right.priority || left.index - right.index);
  const keep = scored.slice(0, limit).sort((left, right) => left.index - right.index);
  return {
    keep: keep.map((item) => item.index),
    total: scored.length,
    typable: scored.filter((item) => item.priority === 0).length,
  };
}
const MAX_COMMIT_OPERATIONS = 8;

function browserElementMetadata(element) {
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
      imageUrl: element instanceof HTMLImageElement ? element.currentSrc || element.src || "" : (element.querySelector?.("img")?.currentSrc || element.querySelector?.("img")?.src || ""),
    disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
    checked: "checked" in element ? Boolean(element.checked) : undefined,
    value: element instanceof HTMLInputElement && element.type === "password"
      ? ""
      : "value" in element
        ? String(element.value || "").slice(0, 300)
        : "",
  };
}

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
  interactiveLogin = true,
} = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");

  const profileDir = path.join(runtimeDir, "browser-profile");
  const screenshotsDir = path.join(runtimeDir, "browser-screenshots");
  const downloadsDir = path.join(runtimeDir, "browser-downloads");
  const sessionStatusPath = path.join(runtimeDir, "browser-session-status.json");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  let context = null;
  let headlessMode = Boolean(headless);
  let page = null;
  let launchPromise = null;
  let operationQueue = Promise.resolve();
  let pageCounter = 0;
  let activePageId = "";
  const pageIds = new Map();
  const pageTasks = new Map();
  const taskPages = new Map();
  const pageStates = new Map();
  const recentDialogs = [];
  let launchedAt = "";
  let lastClosedAt = "";
  let lastLaunchError = "";
  let restartCount = 0;
  let visibleReason = "";
  let sessionStatuses = {};

  try {
    sessionStatuses = JSON.parse(fs.readFileSync(sessionStatusPath, "utf8"));
  } catch {
    sessionStatuses = {};
  }

  function stateForPage(candidate) {
    if (!candidate) return { refs: new Map(), snapshot: null };
    if (!pageStates.has(candidate)) pageStates.set(candidate, { refs: new Map(), snapshot: null });
    return pageStates.get(candidate);
  }

  function originForUrl(value) {
    try {
      return new URL(String(value || "")).origin;
    } catch {
      return "";
    }
  }

  function persistSessionStatuses() {
    const temporary = `${sessionStatusPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(sessionStatuses, null, 2));
    fs.renameSync(temporary, sessionStatusPath);
  }

  function noteSessionStatus({ url, status, reason = "", title = "" } = {}) {
    const origin = originForUrl(url);
    if (!origin) return null;
    const entry = {
      origin,
      status: ["authenticated", "login_required", "unknown"].includes(status) ? status : "unknown",
      reason: cleanBrowserString(reason, 300),
      title: cleanBrowserString(title, 300),
      checkedAt: new Date().toISOString(),
    };
    sessionStatuses = { ...sessionStatuses, [origin]: entry };
    try { persistSessionStatuses(); } catch { /* diagnostics must not break browser work */ }
    return entry;
  }

  function registerPage(candidate, taskId = "") {
    if (pageIds.has(candidate)) {
      if (taskId) {
        pageTasks.set(candidate, taskId);
        taskPages.set(taskId, candidate);
      }
      return pageIds.get(candidate);
    }
    pageIds.set(candidate, `page-${++pageCounter}`);
    const id = pageIds.get(candidate);
    if (taskId) {
      pageTasks.set(candidate, taskId);
      taskPages.set(taskId, candidate);
    }
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
      const ownerTaskId = pageTasks.get(candidate) || "";
      registerPage(popup, ownerTaskId);
      // A popup belongs to its originating task. Do not steal another task's
      // active page or invalidate references captured on unrelated pages.
      if (ownerTaskId || candidate === page) {
        page = popup;
        activePageId = pageIds.get(popup);
      }
    });
    candidate.once("close", () => {
      invalidateSnapshot(candidate);
      const ownerTaskId = pageTasks.get(candidate);
      if (ownerTaskId && taskPages.get(ownerTaskId) === candidate) taskPages.delete(ownerTaskId);
      pageTasks.delete(candidate);
      pageStates.delete(candidate);
    });
    return id;
  }

  async function launchContext() {
    const options = {
      headless: headlessMode,
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
      timeout: navigationTimeoutMs,
      args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
    };

    // Timed because an unexplained ~85s gap between a task starting and its first look at the page
    // showed up twice, both on the first browser use after a restart. Standalone the same launch
    // measures ~8s, so either this is much slower inside the server or the time is going somewhere
    // else entirely — and guessing which has already wasted an afternoon.
    const launchStarted = Date.now();
    try {
      const launched = await browserType.launchPersistentContext(profileDir, channel ? { ...options, channel } : options);
      launchedAt = new Date().toISOString();
      lastLaunchError = "";
      console.log(`[browser] launched in ${Date.now() - launchStarted}ms (profile ${profileDir})`);
      return launched;
    } catch (error) {
      console.log(`[browser] launch attempt failed after ${Date.now() - launchStarted}ms: ${String(error?.message || error).slice(0, 120)}`);
      if (!channel) {
        lastLaunchError = String(error?.message || error).slice(0, 1_000);
        throw error;
      }
      try {
        const launched = await browserType.launchPersistentContext(profileDir, options);
        launchedAt = new Date().toISOString();
        lastLaunchError = "";
        console.log(`[browser] launched on fallback in ${Date.now() - launchStarted}ms`);
        return launched;
      } catch (fallbackError) {
        lastLaunchError = String(fallbackError?.message || fallbackError).slice(0, 1_000);
        throw fallbackError;
      }
    }
  }

  async function ensurePage(taskId = "") {
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
              lastClosedAt = new Date().toISOString();
            });
            return launched;
          })
          .finally(() => {
            launchPromise = null;
          });
      }
      await launchPromise;
    }

    if (taskId) {
      let taskPage = taskPages.get(taskId);
      if (!taskPage || taskPage.isClosed()) {
        taskPage = await context.newPage();
        registerPage(taskPage, taskId);
      }
      taskPage.setDefaultTimeout(timeoutMs);
      taskPage.setDefaultNavigationTimeout(navigationTimeoutMs);
      page = taskPage;
      activePageId = pageIds.get(taskPage);
      return taskPage;
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

  async function restartContext(nextHeadless) {
    const activeContext = context;
    context = null;
    page = null;
    activePageId = "";
    invalidateSnapshot();
    if (activeContext) await activeContext.close().catch(() => undefined);
    pageIds.clear();
    pageTasks.clear();
    taskPages.clear();
    pageStates.clear();
    headlessMode = Boolean(nextHeadless);
    restartCount += 1;
    await ensurePage();
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

  function invalidateSnapshot(activePage = null) {
    const states = activePage ? [stateForPage(activePage)] : [...pageStates.values()];
    for (const state of states) {
      for (const entry of state.refs.values()) entry.handle.dispose().catch(() => undefined);
      state.refs.clear();
      state.snapshot = null;
    }
  }

  async function resolveTarget(activePage, args = {}) {
    if (args.ref) {
      const entry = stateForPage(activePage).refs.get(String(args.ref));
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
      imageUrl: element instanceof HTMLImageElement ? element.currentSrc || element.src || "" : (element.querySelector?.("img")?.currentSrc || element.querySelector?.("img")?.src || ""),
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
      imageUrl: element instanceof HTMLImageElement ? element.currentSrc || element.src || "" : (element.querySelector?.("img")?.currentSrc || element.querySelector?.("img")?.src || ""),
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
      const activePage = await ensurePage(args.taskId);
      const response = await activePage.goto(url, {
        waitUntil,
        timeout: boundedNumber(args.timeoutMs, navigationTimeoutMs, 1_000, 20_000),
      });
      invalidateSnapshot(activePage);
      return {
        ...await currentPageSummary(activePage),
        status: response?.status() || null,
        ok: response?.ok() ?? true,
      };
    });
  }

  async function status(args = {}) {
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
      const activeState = stateForPage(activePage);
      const openPages = context.pages().filter((candidate) => !candidate.isClosed());
      const tabs = await Promise.all(openPages.map(async (candidate) => ({
        pageId: registerPage(candidate),
        taskId: pageTasks.get(candidate) || null,
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
        headless: headlessMode,
        loginHandoffActive: !headlessMode,
        snapshotAvailable: Boolean(activeState.snapshot),
        snapshotUrl: activeState.snapshot?.url || "",
        snapshotTitle: activeState.snapshot?.title || "",
        snapshotElementCount: activeState.snapshot?.elements?.length || 0,
        dialogs: recentDialogs.slice(0, 5),
        tasks: [...taskPages.entries()]
          .filter(([, candidate]) => !candidate.isClosed())
          .map(([taskId, candidate]) => ({ taskId, pageId: pageIds.get(candidate), url: candidate.url() })),
      };
    });
  }

  // Runtime polls this frequently. Keep it synchronous and side-effect free so
  // opening the widget neither launches Chromium nor competes with task actions
  // in the serialized browser operation queue.
  function runtimeStatus() {
    const openPages = context ? context.pages().filter((candidate) => !candidate.isClosed()) : [];
    const activeSnapshot = page && !page.isClosed() ? stateForPage(page).snapshot : null;
    return {
      state: !context ? (lastLaunchError ? "error" : "stopped") : headlessMode ? "background_ready" : "owner_handoff",
      running: Boolean(context),
      activePage: page && !page.isClosed() ? {
        pageId: pageIds.get(page) || registerPage(page),
        taskId: pageTasks.get(page) || null,
        url: page.url(),
        title: activeSnapshot?.url === page.url() ? activeSnapshot.title || "" : "",
      } : null,
      tabs: openPages.map((candidate) => ({
        pageId: pageIds.get(candidate) || registerPage(candidate),
        taskId: pageTasks.get(candidate) || null,
        active: candidate === page,
        url: candidate.url(),
      })),
      profileDir,
      downloadsDir,
      screenshotsDir,
      headless: headlessMode,
      loginHandoffActive: Boolean(context && !headlessMode),
      visibleReason,
      snapshotAvailable: Boolean(activeSnapshot),
      profileReady: fs.existsSync(profileDir),
      launchedAt,
      lastClosedAt,
      lastLaunchError,
      restartCount,
      sessions: Object.values(sessionStatuses).sort((left, right) => String(right.checkedAt).localeCompare(String(left.checkedAt))),
      tasks: [...taskPages.entries()].filter(([, candidate]) => !candidate.isClosed()).map(([taskId, candidate]) => ({ taskId, pageId: pageIds.get(candidate), url: candidate.url() })),
    };
  }

  async function loginHandoff(args = {}) {
    let targetUrl = cleanBrowserString(args.url, 1000);
    if (headlessMode && interactiveLogin) {
      const previousUrl = page && !page.isClosed() ? page.url() : "";
      if (!targetUrl && /^https?:/i.test(previousUrl)) targetUrl = previousUrl;
      if (context) await runExclusive(() => restartContext(false));
      else {
        headlessMode = false;
        await runExclusive(() => ensurePage());
      }
    }
    visibleReason = "login";
    if (targetUrl) await navigate({ url: targetUrl, timeoutMs: args.timeoutMs });
    const snap = await snapshot({ selector: args.selector, limit: args.limit || 80, timeoutMs: args.timeoutMs });
    const signals = loginSignalsFromSnapshot(snap);
    const activePage = await ensurePage();
    await activePage.bringToFront();
    return {
      ...snap,
      ...signals,
      handoffRequired: signals.loginLikelyRequired,
      headless: false,
      instruction: signals.loginLikelyRequired
        ? "Complete login manually in the opened JARVIS browser. JARVIS will not type passwords or bypass login challenges."
        : "No obvious login wall was detected. Take a browser_snapshot next before acting.",
    };
  }

  async function completeLoginHandoff(args = {}) {
    const snap = await snapshot({ selector: args.selector, limit: args.limit || 80, timeoutMs: args.timeoutMs });
    const signals = loginSignalsFromSnapshot(snap);
    const loginUrl = /\/(?:accounts\/login|login|signin|sign-in)(?:[/?#]|$)/i.test(snap.url || "");
    const authenticated = signals.passwordFieldCount === 0 && !loginUrl;
    if (!authenticated) {
      noteSessionStatus({ url: snap.url, status: "login_required", reason: "Login controls remain visible", title: snap.title });
      return { completed: false, authenticated: false, headless: false, page: { url: snap.url, title: snap.title }, login: signals, instruction: "Login is still visible. Finish signing in, then choose Complete login again." };
    }
    const returnUrl = snap.url;
    noteSessionStatus({ url: returnUrl, status: "authenticated", reason: "Owner completed login handoff", title: snap.title });
    await runExclusive(() => restartContext(true));
    visibleReason = "";
    if (returnUrl && /^https?:/i.test(returnUrl)) await navigate({ url: returnUrl });
    return { completed: true, authenticated: true, headless: true, returnUrl, instruction: "Authentication was saved. Future tasks run in the background browser." };
  }

  async function pageBrief(args = {}) {
    const snap = await snapshot({ selector: args.selector, limit: args.limit || 100, timeoutMs: args.timeoutMs });
    return { ...summarizeSnapshot(snap), snapshot: snap };
  }

  async function inspect(args = {}) {
    const selector = validateSelector(args.selector, { optional: true }) || "body";
    const limit = boundedNumber(args.limit, 40, 1, 100);
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
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
      imageUrl: element instanceof HTMLImageElement ? element.currentSrc || element.src || "" : (element.querySelector?.("img")?.currentSrc || element.querySelector?.("img")?.src || ""),
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
      const activePage = await ensurePage(args.taskId);
      invalidateSnapshot(activePage);
      const activeState = stateForPage(activePage);
      const root = activePage.locator(selector).first();
      await root.waitFor({ state: "attached", timeout: boundedNumber(args.timeoutMs, timeoutMs, 500, 15_000) });
      // Rank before materialising. The two calls read the same selector against the same settled
      // root with no interleaved await, so the index alignment between them holds.
      const ranking = await root.evaluate(rankSnapshotCandidates, { selector: SNAPSHOT_SELECTOR, limit })
        .catch(() => null);
      const handles = await root.locator(SNAPSHOT_SELECTOR).elementHandles();
      const keepSet = ranking ? new Set(ranking.keep) : null;
      const elements = [];
      // This was a sequential walk over EVERY element the selector matched, awaiting a separate
      // round trip to the browser for each one — including one purely to dispose the elements it had
      // already decided to discard, then another for `isVisible` and a third for metadata on the
      // ones it kept. A messaging thread matches elements in the thousands, so one observation cost
      // 15-30 seconds of round trips taken strictly one at a time, and a single send performed three
      // of them. That, not the language model, was the bulk of the wall clock.
      //
      // Identical calls and identical results — issued concurrently rather than in series. Order is
      // preserved by resolving positionally, so `e1..eN` still follow document order.
      const kept = [];
      const unused = [];
      for (const [position, handle] of handles.entries()) {
        if (keepSet && !keepSet.has(position)) unused.push(handle);
        else kept.push(handle);
      }
      const visibility = await Promise.all(kept.map((handle) => handle.isVisible().catch(() => false)));
      const visible = kept.filter((_, index) => visibility[index]);
      unused.push(...kept.filter((_, index) => !visibility[index]));
      const metadataList = await Promise.all(
        visible.map((handle) => handle.evaluate(browserElementMetadata).catch(() => null)),
      );
      for (const [index, handle] of visible.entries()) {
        const metadata = metadataList[index];
        // `limit` is still applied in document order, so the elements kept are the same ones the
        // sequential version kept — not merely the same count.
        if (!metadata || elements.length >= limit || isBlockedTarget(JSON.stringify(metadata))) {
          unused.push(handle);
          continue;
        }
        const ref = `e${elements.length + 1}`;
        const pageId = pageIds.get(activePage);
        activeState.refs.set(ref, { pageId, handle, metadata });
        elements.push({ ref, ...metadata, sensitive: metadata.type === "password" || isSensitiveAction(sensitiveDescription(metadata)) });
      }
      // Releasing the handles we did not adopt is bookkeeping, not a result anyone waits on, so it
      // happens once and in parallel instead of blocking the walk thousands of times.
      await Promise.all(unused.map((handle) => handle.dispose().catch(() => undefined)));
      const frameTexts = [];
      for (const frame of activePage.frames().filter((candidate) => candidate !== activePage.mainFrame()).slice(0, 8)) {
        if (elements.length >= limit) break;
        const frameText = await frame.locator("body").innerText().catch(() => "");
        if (frameText) frameTexts.push(frameText.slice(0, 4_000));
        const frameHandles = await frame.locator(SNAPSHOT_SELECTOR).elementHandles().catch(() => []);
        for (const handle of frameHandles) {
          if (elements.length >= limit) {
            await handle.dispose().catch(() => undefined);
            continue;
          }
          const visible = await handle.isVisible().catch(() => false);
          if (!visible) {
            await handle.dispose().catch(() => undefined);
            continue;
          }
          const metadata = await handle.evaluate(browserElementMetadata).catch(() => null);
          if (!metadata || isBlockedTarget(JSON.stringify(metadata))) {
            await handle.dispose().catch(() => undefined);
            continue;
          }
          const ref = `e${elements.length + 1}`;
          const pageId = pageIds.get(activePage);
          activeState.refs.set(ref, { pageId, handle, metadata: { ...metadata, frameUrl: frame.url() } });
          elements.push({ ref, ...metadata, frameUrl: frame.url(), sensitive: metadata.type === "password" || isSensitiveAction(sensitiveDescription(metadata)) });
        }
      }
      const visibleText = [await root.innerText().catch(() => ""), ...frameTexts].filter(Boolean).join("\n");
      const security = detectPromptInjection(visibleText.slice(0, 30_000));
      const result = {
        ...await currentPageSummary(activePage),
        selector,
        elements,
        elementBudget: limit,
        elementCandidates: ranking ? ranking.total : elements.length,
        typableCandidates: ranking ? ranking.typable : null,
        truncated: Boolean(ranking && ranking.total > limit),
        pageText: visibleText.replace(/\s+/g, " ").trim().slice(0, 8_000),
        securitySignals: security.detected ? [security] : [],
        dialogs: recentDialogs.slice(0, 5),
        frameCount: activePage.frames().length,
      };
      activeState.snapshot = result;
      return result;
    });
  }

  async function tabs(args = {}) {
    return runExclusive(async () => {
      await ensurePage(args.taskId);
      const openPages = context.pages().filter((candidate) => !candidate.isClosed());
      if (args.action === "switch") {
        const requested = String(args.pageId || "");
        const nextPage = openPages.find((candidate) => pageIds.get(candidate) === requested);
        if (!nextPage) throw browserError(`Browser tab ${requested} was not found`, 404);
        const nextOwner = pageTasks.get(nextPage) || "";
        if (args.taskId && nextOwner && nextOwner !== String(args.taskId)) throw browserError(`Browser tab ${requested} belongs to another task`, 403);
        if (args.taskId && !nextOwner) registerPage(nextPage, String(args.taskId));
        if (args.taskId) taskPages.set(String(args.taskId), nextPage);
        page = nextPage;
        activePageId = requested;
        if (args.reveal === true) await page.bringToFront();
        invalidateSnapshot(page);
      } else if (args.action === "close") {
        const requested = String(args.pageId || activePageId);
        const closing = openPages.find((candidate) => pageIds.get(candidate) === requested);
        if (!closing) throw browserError(`Browser tab ${requested} was not found`, 404);
        await closing.close();
        page = context.pages().find((candidate) => !candidate.isClosed()) || await context.newPage();
        registerPage(page);
        activePageId = pageIds.get(page);
        invalidateSnapshot(closing);
      } else if (args.action === "new") {
        page = await context.newPage();
        registerPage(page, String(args.taskId || ""));
        activePageId = pageIds.get(page);
        if (args.url) await page.goto(normalizeBrowserUrl(args.url), { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
        invalidateSnapshot(page);
      }
      const summaries = await Promise.all(context.pages().filter((candidate) => !candidate.isClosed()).map(async (candidate) => ({
        pageId: registerPage(candidate),
        taskId: pageTasks.get(candidate) || null,
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
      invalidateSnapshot(activePage);
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
      invalidateSnapshot(activePage);
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
    invalidateSnapshot(activePage);
    return { action, target: target.target, path: destination, bytes: fs.statSync(destination).size, url: activePage.url() };
  }

  async function act(args = {}) {
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
      const activeSnapshot = stateForPage(activePage).snapshot;
      if (!activeSnapshot) throw browserError("Take a fresh browser_snapshot before acting.");
      if (activeSnapshot.pageId !== pageIds.get(activePage)) throw browserError("The browser snapshot belongs to another task page. Take a fresh browser_snapshot.");
      if (activeSnapshot?.securitySignals?.length) {
        throw browserError("The page contains possible prompt-injection instructions. JARVIS stopped before acting.", 409);
      }
      return performAction(activePage, args);
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
      const activePage = await ensurePage(args.taskId);
      const activeSnapshot = stateForPage(activePage).snapshot;
      if (!activeSnapshot) throw browserError("Take a fresh browser_snapshot before preparing a commit.");
      if (activeSnapshot.pageId !== pageIds.get(activePage)) throw browserError("The browser snapshot belongs to another task page. Take a fresh browser_snapshot.");
      if (activeSnapshot?.securitySignals?.length) {
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
    return runExclusive(async () => performAction(await ensurePage(args.taskId), { ...args, action: "click" }));
  }

  async function type(args = {}) {
    return runExclusive(async () => {
      const result = await performAction(await ensurePage(args.taskId), { ...args, action: "fill" });
      return { ...result, typed: true };
    });
  }

  async function extract(args = {}) {
    const selector = validateSelector(args.selector, { optional: true }) || "body";
    const format = args.format === "html" ? "html" : "text";
    const maxLength = boundedNumber(args.maxLength, 12_000, 1, MAX_EXTRACT_LENGTH);
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
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
      const activePage = await ensurePage(args.taskId);
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
      const activePage = await ensurePage(args.taskId);
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

  async function goBack(args = {}) {
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
      const response = await activePage.goBack({ waitUntil: "domcontentloaded", timeout: boundedNumber(args.timeoutMs, navigationTimeoutMs, 1_000, 30_000) });
      invalidateSnapshot(activePage);
      return { ...await currentPageSummary(activePage), navigated: Boolean(response), action: "go_back" };
    });
  }

  async function reload(args = {}) {
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
      await activePage.reload({ waitUntil: "domcontentloaded", timeout: boundedNumber(args.timeoutMs, navigationTimeoutMs, 1_000, 30_000) });
      invalidateSnapshot(activePage);
      return { ...await currentPageSummary(activePage), action: "reload" };
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
      const activePage = await ensurePage(args.taskId);
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
    activePageId = "";
    visibleReason = "";
    if (activeContext) {
      await activeContext.close();
      if (process.platform === "win32") await new Promise((resolve) => setTimeout(resolve, 250));
    }
    invalidateSnapshot();
    pageIds.clear();
    pageTasks.clear();
    taskPages.clear();
    pageStates.clear();
    lastClosedAt = new Date().toISOString();
  }

  async function reveal(args = {}) {
    return runExclusive(async () => {
      const activePage = await ensurePage(args.taskId);
      await activePage.bringToFront();
      return { revealed: !headlessMode, headless: headlessMode, ...await currentPageSummary(activePage) };
    });
  }

  async function presentTask(args = {}) {
    const taskId = cleanBrowserString(args.taskId, 200);
    return runExclusive(async () => {
      const taskPage = taskId ? taskPages.get(taskId) : page;
      if (!taskPage || taskPage.isClosed()) throw browserError("The completed task page is no longer available for presentation", 404);
      const targetUrl = taskPage.url();
      const targetTitle = await taskPage.title().catch(() => "");
      if (headlessMode) await restartContext(false);
      visibleReason = "delivery";
      const activePage = await ensurePage();
      if (targetUrl && activePage.url() !== targetUrl) {
        await activePage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
      }
      await activePage.bringToFront();
      return { presented: true, headless: false, sourceTaskId: taskId || null, targetTitle, ...await currentPageSummary(activePage) };
    });
  }

  async function returnToBackground() {
    return runExclusive(async () => {
      if (headlessMode) return { background: true, alreadyBackground: true, ...runtimeStatus() };
      const returnUrl = page && !page.isClosed() ? page.url() : "";
      await restartContext(true);
      visibleReason = "";
      const activePage = await ensurePage();
      if (returnUrl && /^https?:/i.test(returnUrl) && activePage.url() !== returnUrl) {
        await activePage.goto(returnUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
      }
      return { background: true, alreadyBackground: false, returnUrl, ...runtimeStatus() };
    });
  }

  async function releaseTask(args = {}) {
    const taskId = cleanBrowserString(args.taskId, 200);
    if (!taskId) throw browserError("taskId is required");
    return runExclusive(async () => {
      const ownedPages = [...pageTasks.entries()].filter(([, ownerTaskId]) => ownerTaskId === taskId).map(([candidate]) => candidate);
      const taskPage = taskPages.get(taskId) || ownedPages.at(-1);
      taskPages.delete(taskId);
      if (!ownedPages.length && (!taskPage || taskPage.isClosed())) return { released: true, taskId, closed: false, closedCount: 0, pageIds: [] };
      const pages = [...new Set([...ownedPages, taskPage].filter(Boolean))];
      const ownedPageIds = pages.map((candidate) => pageIds.get(candidate)).filter(Boolean);
      for (const candidate of pages) {
        pageTasks.delete(candidate);
        invalidateSnapshot(candidate);
        if (args.close === true && !candidate.isClosed()) await candidate.close().catch(() => undefined);
      }
      if (page && (page.isClosed() || pages.includes(page))) {
        page = context?.pages().find((candidate) => !candidate.isClosed()) || null;
        activePageId = page ? pageIds.get(page) || registerPage(page) : "";
      }
      return { released: true, taskId, pageId: pageIds.get(taskPage), pageIds: ownedPageIds, closed: args.close === true, closedCount: args.close === true ? pages.length : 0 };
    });
  }

  return {
    profileDir,
    screenshotsDir,
    downloadsDir,
    status,
    runtimeStatus,
    noteSessionStatus,
    loginHandoff,
    completeLoginHandoff,
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
    goBack,
    reload,
    verify,
    reveal,
    presentTask,
    returnToBackground,
    releaseTask,
    close,
  };
}

module.exports = { createBrowserAutomationService };
