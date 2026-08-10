const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { evaluateAutonomy, requiredAutonomyLevel } = require("./autonomy-policy");
const { createBrowserAutomationService } = require("./browser-service");
const { createResearchOrchestrator } = require("./cortex/research-orchestrator");
const { createResearchV2 } = require("./research-v2");
const { createWorkComposer } = require("./work-composer/work-composer");
const { createPcKnowledgeGraph } = require("./pc-knowledge-graph");
const { createSkillAutopilot } = require("./skill-autopilot");
const { createComputerUse } = require("./computer-use");
const { createUniversalBrowserAgent } = require("./universal-browser-agent");
const { PREPARE_ONLY_PHRASE, compileOutcome, resolveExecutableTask } = require("./automation/outcome-compiler");
const { trace } = require("./automation/trace");
const { createContactStore } = require("./contacts");
const { enrichCandidates } = require("./automation/identity-enrichment");
const atlasCapture = require("./atlas/atlas-capture");

const execFileAsync = promisify(execFile);
const CONFIRMATIONS_FILE = "confirmations.json";
const MEMORY_FILE = "agent-memory.json";
const MAX_OUTPUT = 1024 * 1024;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function errorWithStatus(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function parsePowerShellJson(output, label = "PowerShell") {
  const raw = String(output || "").replace(/^\uFEFF/, "").trim();
  if (!raw) throw errorWithStatus(`${label} returned no JSON output.`, 502);
  // UI Automation occasionally exposes control characters and non-finite bounds.
  // Both are invalid JSON even though ConvertTo-Json can emit them on Windows.
  const repaired = raw
    .replace(/[\u0000-\u001F]/g, " ")
    .replace(/(^|[:,\[]\s*)-?Infinity(?=\s*[,}\]])/g, "$1null")
    .replace(/(^|[:,\[]\s*)NaN(?=\s*[,}\]])/g, "$1null");
  try {
    return JSON.parse(repaired);
  } catch (error) {
    throw errorWithStatus(`${label} returned malformed JSON: ${error.message}`, 502);
  }
}

function asNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// The only guard on write_file / delete_file used to be a single regex covering three
// directories on one drive. That left ProgramData, every other drive, UNC shares, and — the one
// that matters — the per-user Startup folder writable, so a single approved write_file
// established boot persistence. Both are `commit`-risk tools so an owner confirmation is still
// required, but the guard should not be the thin part of that pair.
const PROTECTED_WRITE_TARGETS = [
  { rx: /^\\\\/, why: "UNC network paths are not a permitted target" },
  { rx: /^\\\\\?\\/, why: "extended-length device paths are not a permitted target" },
  { rx: /^[a-z]:\\windows\\/i, why: "the Windows directory is not writable" },
  { rx: /^[a-z]:\\program files( \(x86\))?\\/i, why: "Program Files is not writable" },
  { rx: /^[a-z]:\\programdata\\/i, why: "ProgramData is not writable" },
  { rx: /^[a-z]:\\\$recycle\.bin\\/i, why: "the recycle bin is not a permitted target" },
  { rx: /\\microsoft\\windows\\start menu\\programs\\startup\\/i, why: "the Startup folder would establish boot persistence" },
  { rx: /\\appdata\\roaming\\microsoft\\windows\\recent\\/i, why: "the Recent items store is not a permitted target" },
  { rx: /\\system32\\|\\syswow64\\/i, why: "system binaries are not writable" },
  { rx: /\\\.git\\/i, why: "the git metadata directory is not writable" },
  { rx: /\\node_modules\\/i, why: "installed dependencies are not writable" },
];

// The assistant's own state — memory databases, the encryption keyring, the browser profile —
// must not be rewritable by a model-chosen path. Losing this would be silent and unrecoverable.
function assertWritableTarget(filePath, runtimeDir) {
  const target = String(filePath || "");
  for (const rule of PROTECTED_WRITE_TARGETS) {
    if (rule.rx.test(target)) throw errorWithStatus(`Refused: ${rule.why}.`, 403);
  }
  if (runtimeDir) {
    const normalisedRuntime = path.resolve(runtimeDir).toLowerCase();
    if (path.resolve(target).toLowerCase().startsWith(`${normalisedRuntime}${path.sep}`)) {
      throw errorWithStatus("Refused: that path is inside Jarvis's own runtime state.", 403);
    }
  }
  return target;
}

function ensureInside(root, candidate) {
  const resolvedRoot = fs.realpathSync.native(root);
  const resolved = fs.realpathSync.native(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw errorWithStatus("Path is outside the approved workspace", 403);
  return resolved;
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw errorWithStatus(data?.error?.message || data?.message || `Provider request failed (${response.status})`, 502);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPagedJson(initialUrl, options = {}, maxItems = 200) {
  const items = [];
  let nextUrl = String(initialUrl);
  const allowedOrigin = new URL(nextUrl).origin;
  for (let page = 0; page < 10 && nextUrl && items.length < maxItems; page += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(nextUrl, { ...options, redirect: "error", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw errorWithStatus(data?.errors?.[0]?.message || `Provider request failed (${response.status})`, 502);
      if (!Array.isArray(data)) throw errorWithStatus("Expected a paginated array response", 502);
      items.push(...data);
      const link = String(response.headers.get("link") || "");
      const next = link.split(",").map((part) => part.trim()).find((part) => /rel="?next"?/.test(part));
      const match = next?.match(/<([^>]+)>/);
      nextUrl = match?.[1] || "";
      if (nextUrl && new URL(nextUrl).origin !== allowedOrigin) throw errorWithStatus("Cross-origin pagination URL rejected", 502);
    } finally {
      clearTimeout(timer);
    }
  }
  return items.slice(0, maxItems);
}

function createCapabilityEngine({
  runtimeDir,
  workspaceRoot,
  getSettings,
  createReceipt,
  providers,
  scanProjects,
  openProjectFolder,
  memoryStore,
  codeKnowledge,
  windowsBroker,
  getAutonomyProfile,
  browserService,
  screenCapture,
  deviceFiles,
  latestDeviceImage,
  meshStatus,
  meshObjects,
  meshCreateCommand,
  meshCreatePair,
  meshSelfTest,
  coopSymbioteMesh,
  neuralVault,
  missionEngine,
  apexIngest,
  getAtlas,
  getOwnerTz,
  desktopTakeover,
}) {
  const getApex = () => (typeof apexIngest === "function" ? apexIngest() : apexIngest);
  const atlas = () => (typeof getAtlas === "function" ? getAtlas() : null);
  const ownerTz = () => { try { return (typeof getOwnerTz === "function" ? getOwnerTz() : null) || atlasCapture.DEFAULT_TZ; } catch { return atlasCapture.DEFAULT_TZ; } };
  const confirmationsPath = path.join(runtimeDir, CONFIRMATIONS_FILE);
  const memoryPath = path.join(runtimeDir, MEMORY_FILE);
  // Who the owner means when they say a name. Consulted before any identity search, so a known
  // person is a direct navigation rather than a search, a ranking, and a chance to be wrong.
  const contacts = createContactStore({ runtimeDir });
  const actionHistory = [];
  const browser = browserService || createBrowserAutomationService({ runtimeDir });
  // Runtime/background automation has a hard zero-visible-surface contract.
  // Authenticated work always uses this dedicated persistent profile; capability
  // execution has no reference to the retired personal-Chrome extension bridge.
  const managedBrowser = browser;
  const cortex = createResearchOrchestrator({ getSettings });
  let researchV2;
  const composer = createWorkComposer({ runtimeDir });
  const pcGraph = createPcKnowledgeGraph({ runtimeDir, workspaceRoot });
  const skillAutopilot = createSkillAutopilot({ runtimeDir, missionEngine });
  // B-20 — `runtimeDir` is passed through so the visible lane's outcome memory persists beside
  // the rest of the runtime (and beside the headless lane's, which already received it) rather
  // than defaulting to the process cwd.
  const computerUse = screenCapture ? createComputerUse({ screenCapture, getSettings, browserService: browser, runtimeDir }) : null;
  const universalHeadlessBrowser = createUniversalBrowserAgent({ browserService: managedBrowser, getSettings, runtimeDir });
  const browserForContext = () => managedBrowser;
  const siteAliases = {
    youtube: "https://www.youtube.com/",
    "you tube": "https://www.youtube.com/",
    gmail: "https://mail.google.com/",
    google: "https://www.google.com/",
    canvas: "https://northeastern.instructure.com/",
    instagram: "https://www.instagram.com/",
    github: "https://github.com/",
    reddit: "https://www.reddit.com/",
    kalshi: "https://kalshi.com/portfolio",
  };

  function readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }

  const appCatalog = {
    browser: { command: "cmd.exe", args: ["/c", "start", "", "https://www.google.com"], process: null },
    chrome: { command: "cmd.exe", args: ["/c", "start", "", "chrome"], process: "chrome" },
    edge: { command: "cmd.exe", args: ["/c", "start", "", "msedge"], process: "msedge" },
    calculator: { command: "calc.exe", args: [], process: "CalculatorApp" },
    notepad: { command: "notepad.exe", args: [], process: "notepad" },
    explorer: { command: "explorer.exe", args: [], process: "explorer" },
    terminal: { command: "cmd.exe", args: ["/c", "start", "", "wt.exe"], process: "WindowsTerminal" },
    vscode: { command: "cmd.exe", args: ["/c", "start", "", "code"], process: "Code" },
    spotify: { command: "cmd.exe", args: ["/c", "start", "", "spotify"], process: "Spotify" },
  };

  const definitions = [
    ["system_status", "Read real local CPU, memory, uptime, network interfaces, and load information.", "observe", false],
    ["list_processes", "List running Windows processes, sorted by memory use.", "observe", false],
    ["open_app", "Open an allowlisted Windows application.", "execute", false],
    ["open_url", "Open a validated HTTP/HTTPS URL or common site name such as YouTube, Gmail, Canvas, Instagram, GitHub, Reddit, Google, or Kalshi in the laptop default browser.", "execute", false],
    ["screen_inspect", "Inspect the current visible laptop screen through Windows UI Automation and return visible controls, labels, roles, and screen-coordinate bounds.", "observe", false],
    ["screen_act", "Operate on the current visible laptop screen by first capturing and inspecting it, locating a visible target, performing a bounded click/type/hotkey/fullscreen action, then capturing again to verify.", "execute", false],
    ["youtube_open_video", "Fallback YouTube video opener. Prefer screen_act when the user is referring to the current visible screen.", "execute", false],
    ["desktop_control", "Control the visible laptop desktop with bounded actions: open a site full-screen, toggle full-screen, switch browser tabs, send safe hotkeys, click visible text or screen coordinates, or type text into the active window.", "execute", false],
    ["close_app", "Close an allowlisted Windows application.", "commit", true],
    ["network_inventory", "Read passive local adapter, route, and neighbor information. It does not scan arbitrary hosts.", "observe", false],
    ["search_projects", "Search project names and package metadata in the approved workspace.", "observe", false],
    ["open_project", "Open an indexed workspace project in Windows Explorer.", "execute", false],
    ["search_files", "Search filenames inside an approved workspace project.", "observe", false],
    ["kalshi_markets", "Search live open Kalshi markets using the public official API with query expansion and fuzzy ranking.", "observe", false],
    ["kalshi_market_discovery", "Find a Kalshi market or sports/game/event bet by expanding team names, abbreviations, dates, leagues, and market wording, then ranking candidate markets with proof of searched terms.", "observe", false],
    ["kalshi_balance", "Read the authenticated Kalshi cash balance and portfolio value.", "observe", false],
    ["kalshi_positions", "Read authenticated Kalshi market and event positions.", "observe", false],
    ["kalshi_fills", "Read authenticated Kalshi fills to identify recent matched bets and trade history.", "observe", false],
    ["kalshi_portfolio", "Summarize the authenticated Kalshi portfolio, latest bet, active exposure, and best position.", "observe", false],
    ["canvas_courses", "Read active Canvas LMS courses.", "observe", false],
    ["canvas_assignments", "Read upcoming Canvas assignments for one course or all active courses.", "observe", false],
    ["canvas_browser_assignments", "Open Canvas in the persistent JARVIS browser and observe the assignments/calendar page when API credentials are missing.", "observe", false],
    ["web_research", "Answer a current/live web question with Gemini Google Search grounding and return citations. Use when live web facts are needed, not for private account data.", "observe", false],
    ["research_v2", "JARVIS Research Engine v2: classify a public-info request, expand multiple search angles, run Gemini grounded search plus optional Tavily/Brave/Exa providers, read top URLs, verify evidence, and return progress, citations, confidence, and a grounded answer.", "observe", false],
    ["web_research_deep", "Cortex v2 deep public research: plan a live search, use grounded search, read top public source URLs, and return evidence objects with citations.", "observe", false],
    ["url_read", "Read and extract clean text from a public HTTP/HTTPS URL with SSRF protections and metadata.", "observe", false],
    ["ui_open_widget", "Open a real current-shell JARVIS widget by id without navigating to an external website.", "observe", false],
    ["ui_focus_widget", "Open a real current-shell JARVIS widget in expanded focus mode.", "observe", false],
    ["ui_close_widget", "Close the currently shown JARVIS widget or a specified widget.", "observe", false],
    ["ui_populate", "Populate a current-shell widget with explicitly supplied response data and a freshness state.", "observe", false],
    ["ui_render_card", "Render a safe declarative information, warning, metric, or checklist card in the JARVIS response surface.", "observe", false],
    ["compose_artifact", "Create a verified Work Composer artifact as Markdown and HTML with sources, brief metadata, and verification receipts.", "prepare", false],
    ["artifact_status", "List recent Work Composer artifacts or inspect one artifact verification record.", "observe", false],
    ["pc_graph_rebuild", "Build or refresh the Personal Reality Graph from local files, projects, downloads, screenshots, and documents.", "prepare", false],
    ["pc_graph_search", "Search the Personal Reality Graph for local files, projects, documents, screenshots, classes, recent work, and evidence paths.", "observe", false],
    ["pc_graph_timeline", "Reconstruct recent laptop activity from indexed file/project timestamps for Time Machine style questions.", "observe", false],
    ["pc_graph_explain", "Explain why a file/project appears relevant by returning graph neighbors, project containment, timestamps, and evidence.", "observe", false],
    ["pc_graph_inspect", "Inspect Personal Reality Graph health, counts, last index run, and recent indexed nodes.", "observe", false],
    ["agent_deploy", "Deploy a typed autonomous JARVIS agent mission such as browser, kalshi, canvas, pc, research, verifier, or coordinator.", "prepare", false],
    ["skill_compile", "Compile a repeated natural-language procedure into a reusable skill with agent steps, tools, approval gates, and tests.", "prepare", false],
    ["skill_run", "Run a compiled skill by deploying its agent mission swarm and coordinator.", "prepare", false],
    ["skill_list", "List compiled reusable JARVIS skills and their reliability metadata.", "observe", false],
    ["skill_inspect", "Inspect the Skill Autopilot engine, agent profiles, compiled skills, and run counts.", "observe", false],
    ["news_headlines", "Read current news headlines using the configured News API key.", "observe", false],
    ["weather_forecast", "Read a US National Weather Service forecast for coordinates.", "observe", false],
    ["memory_search", "Search JARVIS personal memory.", "observe", false],
    ["memory_add", "Add a user-approved fact or preference to JARVIS memory.", "prepare", false],
    ["life_graph", "Read JARVIS personal life graph buckets: people, classes, projects, preferences, routines, goals, accounts, and entities.", "observe", false],
    ["neural_vault_status", "Read Neural Vault memory OS health, schema counts, runtime paths, agents, macros, integrations, and continuity status.", "observe", false],
    ["neural_vault_context", "Retrieve the Neural Vault context pack for a user request, including continuity, relevant memories, macros, integrations, capabilities, and answer frames.", "observe", false],
    ["neural_vault_resolve", "Resolve ambiguous references like it, this, that, the prompt, or last thing using the hot continuity cache.", "observe", false],
    ["neural_vault_actions", "List or match learned Neural Vault action macros and reusable workflow memory.", "observe", false],
    ["neural_vault_integrations", "Read Neural Vault integration metadata, API-key metadata without secrets, provider health history, and capability memory.", "observe", false],
    ["neural_vault_api_key_metadata", "Store safe API-key metadata in Neural Vault using env var names or file labels only. Never store raw secret values.", "prepare", false],
    ["neural_vault_maintenance", "Run the local Neural Vault maintenance pass to merge duplicates, refresh summaries, and write a maintenance report.", "prepare", false],
    ["memory_os_v4_status", "Read Neural Vault v4 MemoryOS/FileDB/agent status, object counts, report paths, and storage roots.", "observe", false],
    ["memory_os_v4_query", "Query MemoryOS v4 across object paths, keyword/FTS, FileDB, source code, commands, skills, agents, device mesh, and co-op memory without hallucinating.", "observe", false],
    ["memory_os_v4_scan_files", "Run the MemoryOS v4 File Inspector to index project files, checksums, source summaries, and source-code memory objects.", "prepare", false],
    ["memory_os_v4_run_agent", "Run a named MemoryOS v4 memory agent such as file-inspector-agent, memory-manager-agent, source-code-mapper-agent, or retrieval-evaluator-agent.", "prepare", false],
    ["device_files", "List files and photos uploaded from paired phones or other devices into the JARVIS device inbox.", "observe", false],
    ["device_latest_image", "Find the latest uploaded phone/device image and attach it for Gemini visual analysis.", "observe", false],
    ["mesh_status", "Read OmniPresence Mesh v2 status: paired phone/iPad/laptop nodes, trust levels, object portal, command cards, Cloudflare/stable phone links, public URLs, and local access URLs.", "observe", false],
    ["mesh_objects", "List or inspect objects sent through the device mesh, including phone photos, links, notes, screen captures, and uploaded files.", "observe", false],
    ["mesh_pair_link", "Create a one-time phone/iPad pairing code and return public Cloudflare/stable pair links first, followed by local/LAN fallback links.", "prepare", false],
    ["mesh_self_test", "Run Device Mesh emergency repair diagnostics for LAN IP, QR URL, pairing page, text/link/file routes, memory writes, and event logging.", "prepare", false],
    ["mesh_send_command", "Create a device-mesh command card for a phone, iPad, laptop, or any paired device.", "prepare", false],
    ["coop_symbiote_status", "Read Jarvis Co-Op Symbiote Mesh workspace status, active session, repo fingerprint, connection quality, manifest summary, and memory counts.", "observe", false],
    ["coop_symbiote_create_session", "Create a trusted two-person Co-Op Symbiote Mesh session with a short expiring join code and invite links.", "prepare", false],
    ["coop_symbiote_manifest", "Generate a secret-scanned safe source-code file manifest for the current Jarvis project.", "observe", false],
    ["coop_symbiote_chat", "Send a human co-op chat message into the active Symbiote session and store it in Neural Vault.", "prepare", false],
    ["coop_symbiote_patch", "Create a Patch Court proposal for an allowed source file using original/replacement text. Does not apply the patch.", "prepare", false],
    ["coop_symbiote_ghost_test", "Run a proposed patch through the Ghost Sandbox isolated-copy verifier before any real file write.", "prepare", false],
    ["coop_symbiote_debate", "Ask both Jarvis systems to debate a co-op engineering decision and save the structured recommendation.", "observe", false],
    ["coop_symbiote_memory", "Read Neural Vault co-op session memory: events, patches, tasks, replays, bridge messages, memory packets, and skill transfers.", "observe", false],
    ["codebase_search", "Search JARVIS source code, routes, symbols, configuration, and architecture with hybrid retrieval.", "observe", false],
    ["jarvis_self_inspect", "Read JARVIS runtime architecture, code-index health, capabilities, and application inventory.", "observe", false],
    ["draft_email", "Prepare an email draft without sending it.", "prepare", false],
    ["gmail_prepare_email", "Create a real Gmail draft, read it back, and return the immutable draft identity and content hash without sending it.", "prepare", false],
    ["gmail_send_prepared", "Send one previously prepared Gmail draft after re-reading it and proving its recipient, subject, and body hash are unchanged.", "commit", true],
    ["send_email", "Legacy one-step Gmail sender. Prefer gmail_prepare_email followed by gmail_send_prepared so approval is bound to an exact provider draft.", "commit", true],
    ["browser_search", "Open a web search in the default browser.", "execute", false],
    ["browser_status", "Report the persistent JARVIS browser session, tabs, active page, saved profile, and snapshot readiness.", "observe", false],
    ["browser_login_handoff", "Open a login-required website in the persistent JARVIS browser and pause for the user to authenticate manually.", "prepare", false],
    ["browser_login_complete", "Verify that manual authentication finished, save the dedicated browser profile, close its visible window, and return automation to headless background mode.", "prepare", false],
    ["browser_page_brief", "Summarize the active browser page into forms, buttons, links, upload controls, login signals, security signals, and likely next actions.", "observe", false],
    ["browser_navigate", "Navigate the isolated persistent JARVIS browser to a validated HTTP or HTTPS URL.", "prepare", false],
    ["browser_snapshot", "Observe the active browser page as compact semantic elements with stable short-lived references.", "observe", false],
    ["browser_tabs", "List, open, switch, or close tabs in the persistent JARVIS browser.", "prepare", false],
    ["browser_act", "Perform a reversible browser action using a semantic element reference or CSS selector. Consequential controls are blocked.", "prepare", false],
    ["browser_commit", "Perform one user-approved consequential browser operation or bounded operation batch, such as submitting, sending, publishing, purchasing, or uploading.", "commit", true],
    ["browser_file_search", "Find recent files in approved workspace, Desktop, Documents, and Downloads locations for browser workflows.", "observe", false],
    ["browser_inspect", "Inspect visible interactive elements in the isolated JARVIS browser.", "observe", false],
    ["browser_click", "Click one visible CSS-selected element in the isolated JARVIS browser.", "commit", true],
    ["browser_type", "Type into one visible non-password field in the isolated JARVIS browser.", "execute", false],
    ["browser_extract", "Extract bounded text or HTML from the isolated JARVIS browser.", "observe", false],
    ["browser_screenshot", "Capture a screenshot inside the JARVIS runtime artifact directory.", "observe", false],
    ["browser_wait", "Wait briefly or for a CSS-selected browser element state.", "observe", false],
    ["browser_verify", "Verify browser URL, title, text, or element visibility without changing the page.", "observe", false],
    ["screen_capture", "Capture the laptop primary display for visual analysis. Use only when the user asks what is on the laptop screen or desktop.", "observe", false],
    ["instagram_reply", "Reply through the official Instagram professional messaging API.", "commit", true],
    ["instagram_like_current", "Like the currently visible Instagram Reel only after verifying that a reel URL is open; returns proof that the control changed from Like to Unlike.", "commit", true],
    ["instagram_prepare_dm", "Open an exact visible Instagram Direct thread and place the requested text in its composer without sending it.", "prepare", false],
    ["instagram_send_current", "Send the already-prepared text in the currently visible Instagram Direct conversation only after verifying the chat URL, recipient context, and exact composer value; returns proof that the composer cleared and the text appeared in the conversation.", "commit", true],
    ["instagram_read_inbox", "Read the Instagram Direct inbox: the list of conversations with each one's name, latest-message snippet, unread flag, and time. Read-only, changes nothing. Use for 'read my DMs', 'check my messages', 'who messaged me', 'any unread chats'.", "observe", false],
    ["instagram_read_conversation", "Open one Instagram Direct conversation by the person's name (or a known thread URL) and read its recent messages in order. Read-only. Use for 'read my chat with X', 'what did X say', 'open my conversation with X'.", "observe", false],
    ["instagram_read_notifications", "Read the Instagram notifications/activity panel: pending follow requests, new followers, likes, comments, and mentions. Read-only. Use for 'check my notifications', 'any follow requests', 'who followed me', 'what's new on Instagram'.", "observe", false],
    ["instagram_read_people", "Read an Instagram account's followers or following list by scroll-harvesting the modal (capped and human-paced). Defaults to your own account. Read-only. Use for 'who follows me', 'who am I following', 'show X's followers'.", "observe", false],
    ["list_windows", "List visible top-level Windows application windows using semantic UI Automation.", "observe", false],
    ["inspect_window", "Inspect named controls in a Windows application using semantic UI Automation.", "observe", false],
    ["focus_window", "Focus a visible Windows application window.", "execute", true],
    ["invoke_control", "Invoke a named button or control in a Windows application.", "execute", true],
    ["set_control_value", "Set text on a named editable Windows control.", "execute", true],
    ["run_command", "Execute a PowerShell command on the local Windows machine and return the output. Use for system queries, file operations, process control, and automation tasks.", "execute", false],
    ["write_file", "Create a REAL file on the local machine: text (.md .txt .json .csv .html .py .js .ts) OR a real Microsoft Word .docx. A bare filename (e.g. notes.docx) is saved to the Desktop. For .docx you may set docxFontPt (e.g. 72 = huge) and docxColor (e.g. blue or 0000FF). The file is written AND re-verified on disk before success is reported.", "commit", true],
    ["delete_file", "Delete a file or empty directory from the local machine.", "commit", true],
    ["read_clipboard", "Read the current Windows clipboard text content.", "observe", false],
    ["write_clipboard", "Write text to the Windows clipboard.", "execute", false],
    ["toast_notification", "Show a Windows toast notification with a title and message.", "execute", false],
    ["screen_analyze", "Capture the current screen once and analyze it with Gemini Vision. Returns what is visible and answers a specific question about the screen.", "observe", false],
    ["computer_use", "Run a task through the policy-selected browser lane: signed-in personal Chrome, isolated headless browser, or explicitly visible desktop. Navigation and preparation run first; Send, Like, Post, Submit, Delete, Purchase, and similar external commits pause at the exact final-action boundary for owner approval.", "execute", false],
    ["screen_locate", "Find any visible UI element on the current screen using Gemini Vision and return its pixel coordinates. Works on web apps with no accessibility labels.", "observe", false],
    ["mouse_scroll", "Scroll the mouse wheel at a screen coordinate in a specified direction and amount. Use for scrolling feeds, lists, pages, or DM threads.", "execute", false],
    ["apex_catalog_search", "Search the APEX trading-room data catalog by keyword and get matching datasets, database tables, and local files with their columns, row counts, date coverage, source, and a plain-language summary. Use this first to discover what market/news/history data APEX holds before answering data questions.", "observe", false],
    ["apex_data_summary", "Get a detailed summary of one APEX data entry (a database table, dataset, or local file) by exact name or id: its columns, row count, date range, source, and description. Use after apex_catalog_search to inspect a specific source.", "observe", false],
    ["apex_strategies", "List or inspect the user's trading strategies/bots built in THE FORGE. Call with no id to list all saved strategies (name, tags, folder, summary, Sharpe). Call with an id to get the full spec of one strategy: its signals/indicators, entry/exit rules, position sizing, risk rules, and backtest metrics. Use this whenever the user asks about their strategies, bots, or what they've built.", "observe", false],
    ["apex_forge", "Inspect the user's FORGE building blocks: strategy folders, reusable signals, and named variables (DSL expressions like 'RSI(SPX,14)<30'). Call with kind='overview' for counts+recent names, or kind='variables'|'signals'|'folders' to list each. Use when the user asks what signals/variables/folders they have, or what's in THE FORGE.", "observe", false],
    ["apex_report", "Look up the saved DEEP-ANALYSIS report for a strategy — the full metric sheet (Sharpe, Sortino, Calmar, MaxDD, CVaR, win rate, profit factor, beta/alpha, etc.) plus the narrative. Call with the strategy name (or id). Use this to answer specific performance questions like 'what's my Sortino on the momentum bot' or 'how bad is the drawdown'.", "observe", false],
    ["apex_news", "Read APEX's ranked market-news feed produced by the news intelligence engine: top clustered + credibility-verified stories with their lane (macro/finance/commodities/crypto/geopolitics/weather), corroboration count, and mapped ticker/sector impact with direction. Pass a ticker to see only news-driven impact on that symbol. Use to answer what's moving markets or news on a specific stock.", "observe", false],
    ["apex_market_snapshot", "Get a full live APEX market snapshot in one call: regime (risk-on/off score + fear&greed), major indices, crypto global stats, top 3 stock + crypto gainers AND losers, macro series (Fed funds, 10Y, CPI, unemployment), and the top ranked news. Use this to brief the user on the market or answer 'what's happening today' with real live data.", "observe", false],
    ["apex_ticker_report", "Deep on-demand report for one ticker: latest quote, fundamentals (P/E, market cap, beta — equities), news-driven impact, and recent insider transactions. Use for 'tell me about NVDA' or 'deep dive TSLA'.", "observe", false],
    ["apex_health_check", "Run the APEX Data Health Bot: audit every enabled data source (keyless + keyed) for reachability, return a per-source report, an analysis, and PROPOSED config fixes for any that are down. Read-only — proposes fixes but does not apply them. Follow with apex_health_apply once the user approves.", "observe", false],
    ["apex_health_apply", "Apply the data-source fixes proposed by the last apex_health_check (after the user approves), hot-reload the ingestion governor WITHOUT restarting the server, then re-verify and report the new health. Optionally pass specific source ids to apply only those.", "execute", false],
    ["apex_brief", "Get a data-grounded market brief assembled from live APEX data: a headline, a narrative paragraph, index session (yesterday close→today open→gap→range), top movers, sector leaders/laggards, macro, top news, and 'things to watch'. type can be now, morning, or eod. Use to brief the user on the market.", "observe", false],
    ["atlas_capture", "Capture the owner's task, reminder, calendar event, or note from one natural sentence and save it to their day (ATLAS/Today). Use whenever the owner wants to remember, be reminded, add a to-do, schedule something, or jot a note — e.g. 'remind me to call the bank at 5', 'add a task file taxes', 'lunch with Priya tomorrow at 1', 'note: parking is B12'. Pass the owner's own sentence as text; the tool parses the time and kind itself and lands it in Today.", "execute", false],
    ["email_smart", "PREFERRED one-step email sender. Send an email to a saved contact BY NAME (or to a raw email address) in a single step — no separate draft, no extra approval prompt. Use for casual requests like 'email AJ that I'm running late' or 'send TG a note saying dinner at 8'. If an email is on file for that name it sends immediately and returns sent:true. If NO email is on file it does NOT send and returns status:recipient_unknown — then ask the owner for the address. If the owner supplies a new address (pass it as `email`), it sends and returns a saveSuggestion so you can offer to remember it. Prefer this over gmail_prepare_email/gmail_send_prepared for everyday sends to people.", "execute", false],
    ["contact_add_email", "Save or update a person's email address so future 'email <name>' sends resolve on their own. Use right after email_smart returns a saveSuggestion and the owner agrees, or when the owner says 'save X's email as …'.", "execute", false],
  ].map(([name, description, risk, confirmationRequired]) => ({
    name,
    description,
    risk,
    confirmationRequired,
    requiredAutonomyLevel: requiredAutonomyLevel({ risk }),
  }));

  const description = (name) => definitions.find((item) => item.name === name).description;
  const declarations = [
    { name: "system_status", description: description("system_status"), parameters: { type: "OBJECT", properties: {} } },
    { name: "list_processes", description: description("list_processes"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER", description: "Maximum processes, 1 to 50." } } } },
    { name: "open_app", description: description("open_app"), parameters: { type: "OBJECT", properties: { app: { type: "STRING", description: `One of: ${Object.keys(appCatalog).join(", ")}.` } }, required: ["app"] } },
    { name: "open_url", description: description("open_url"), parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "An HTTP or HTTPS URL. Bare domains are opened with HTTPS." } }, required: ["url"] } },
    { name: "screen_inspect", description: description("screen_inspect"), parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER", description: "Maximum visible controls to return, 1 to 120." },
    } } },
    { name: "screen_act", description: description("screen_act"), parameters: { type: "OBJECT", properties: {
      instruction: { type: "STRING", description: "The user's visible-screen request, such as click the first video, type hello in search, or make the player full screen." },
      action: { type: "STRING", description: "One of: click, double_click, type, press, fullscreen." },
      targetText: { type: "STRING", description: "Visible text/control label to locate before acting." },
      text: { type: "STRING", description: "Text to type when action is type." },
      hotkey: { type: "STRING", description: "Allowed key for press: enter, escape, tab, shift_tab, ctrl_l, ctrl_r, ctrl_tab, ctrl_shift_tab, f, space, page_down, page_up." },
      fullscreenMode: { type: "STRING", description: "player for in-page video fullscreen using the page/player shortcut; browser for Chrome/Edge full-screen." },
    }, required: ["instruction"] } },
    { name: "youtube_open_video", description: description("youtube_open_video"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "Video title or search query." },
      fullscreen: { type: "BOOLEAN", description: "Whether to toggle browser full screen after opening." },
    }, required: ["query"] } },
    { name: "desktop_control", description: description("desktop_control"), parameters: { type: "OBJECT", properties: {
      action: { type: "STRING", description: "One of: open_site_fullscreen, open_site, activate_site, scroll_page, fullscreen, next_tab, previous_tab, tab_number, hotkey, click_text, click, type_text, youtube_search_visible." },
      target: { type: "STRING", description: "Site name or URL for open_site/open_site_fullscreen/activate_site/scroll_page." },
      targetText: { type: "STRING", description: "Visible text, button label, link label, or control name for click_text." },
      tabNumber: { type: "INTEGER", description: "Browser tab number, 1 through 9." },
      hotkey: { type: "STRING", description: "Allowed hotkey: enter, escape, tab, shift_tab, ctrl_l, ctrl_r, ctrl_tab, ctrl_shift_tab, f11, alt_left, alt_right, page_down, page_up." },
      direction: { type: "STRING", description: "For scroll_page: up or down." },
      x: { type: "INTEGER", description: "Screen X coordinate for click." },
      y: { type: "INTEGER", description: "Screen Y coordinate for click." },
      text: { type: "STRING", description: "Text to paste/type into the active field." },
    }, required: ["action"] } },
    { name: "close_app", description: description("close_app"), parameters: { type: "OBJECT", properties: { app: { type: "STRING", description: `One of: ${Object.keys(appCatalog).filter((key) => appCatalog[key].process).join(", ")}.` } }, required: ["app"] } },
    { name: "network_inventory", description: description("network_inventory"), parameters: { type: "OBJECT", properties: {} } },
    { name: "search_projects", description: description("search_projects"), parameters: { type: "OBJECT", properties: { query: { type: "STRING" } } } },
    { name: "open_project", description: description("open_project"), parameters: { type: "OBJECT", properties: { path: { type: "STRING", description: "Exact path returned by search_projects." } }, required: ["path"] } },
    { name: "search_files", description: description("search_files"), parameters: { type: "OBJECT", properties: { projectPath: { type: "STRING" }, query: { type: "STRING" }, limit: { type: "INTEGER" } }, required: ["projectPath", "query"] } },
    { name: "apex_catalog_search", description: description("apex_catalog_search"), parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "Keyword to match against catalog name, summary, or source. Empty string returns everything." } } } },
    { name: "apex_data_summary", description: description("apex_data_summary"), parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "Exact catalog name or id, e.g. apex_bars or bt_cleaned_all_stocks.csv." } }, required: ["name"] } },
    { name: "apex_strategies", description: description("apex_strategies"), parameters: { type: "OBJECT", properties: { id: { type: "STRING", description: "Optional strategy id to inspect one strategy's full spec. Omit to list all saved strategies." } } } },
    { name: "apex_forge", description: description("apex_forge"), parameters: { type: "OBJECT", properties: { kind: { type: "STRING", description: "One of: overview | variables | signals | folders. Default overview." } } } },
    { name: "apex_report", description: description("apex_report"), parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "Strategy/folder name to fetch its deep-analysis report." }, id: { type: "STRING", description: "Optional strategy/folder id instead of name." } } } },
    { name: "apex_news", description: description("apex_news"), parameters: { type: "OBJECT", properties: { ticker: { type: "STRING", description: "Optional ticker to filter news impact, e.g. NVDA. Omit for the full ranked feed." }, limit: { type: "INTEGER", description: "Max stories/rows, 1 to 30." } } } },
    { name: "apex_market_snapshot", description: description("apex_market_snapshot"), parameters: { type: "OBJECT", properties: {} } },
    { name: "apex_ticker_report", description: description("apex_ticker_report"), parameters: { type: "OBJECT", properties: { ticker: { type: "STRING", description: "The ticker, e.g. NVDA, AAPL, BTC." } }, required: ["ticker"] } },
    { name: "apex_health_check", description: description("apex_health_check"), parameters: { type: "OBJECT", properties: {} } },
    { name: "apex_health_apply", description: description("apex_health_apply"), parameters: { type: "OBJECT", properties: { ids: { type: "ARRAY", items: { type: "STRING" }, description: "Optional source ids to apply (from the proposed fixes). Omit to apply all proposed fixes." } } } },
    { name: "apex_brief", description: description("apex_brief"), parameters: { type: "OBJECT", properties: { type: { type: "STRING", description: "now, morning, or eod." } } } },
    { name: "kalshi_markets", description: description("kalshi_markets"), parameters: { type: "OBJECT", properties: { query: { type: "STRING" } } } },
    { name: "kalshi_market_discovery", description: description("kalshi_market_discovery"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "Natural language market, team, game, event, or bet description from the user." },
      limit: { type: "INTEGER", description: "Maximum ranked markets to return, 1 to 50." },
      maxPages: { type: "INTEGER", description: "Kalshi open-market pages to scan, 1 to 10." },
    }, required: ["query"] } },
    { name: "kalshi_balance", description: description("kalshi_balance"), parameters: { type: "OBJECT", properties: {} } },
    { name: "kalshi_positions", description: description("kalshi_positions"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" }, cursor: { type: "STRING" }, settlementStatus: { type: "STRING" } } } },
    { name: "kalshi_fills", description: description("kalshi_fills"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" }, cursor: { type: "STRING" }, ticker: { type: "STRING" }, orderId: { type: "STRING" } } } },
    { name: "kalshi_portfolio", description: description("kalshi_portfolio"), parameters: { type: "OBJECT", properties: {} } },
    { name: "canvas_courses", description: description("canvas_courses"), parameters: { type: "OBJECT", properties: {} } },
    { name: "canvas_assignments", description: description("canvas_assignments"), parameters: { type: "OBJECT", properties: { courseId: { type: "STRING" }, limit: { type: "INTEGER" } } } },
    { name: "canvas_browser_assignments", description: description("canvas_browser_assignments"), parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "Optional Canvas base/dashboard URL. Defaults to Northeastern Canvas or configured Canvas base URL." } } } },
    { name: "web_research", description: description("web_research"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "The live web question to research." },
      context: { type: "STRING", description: "Optional local context from other tools." },
    }, required: ["query"] } },
    { name: "research_v2", description: description("research_v2"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "The public-info question, research task, schedule lookup, local briefing, news query, or current factual request." },
      intent: { type: "STRING", description: "Optional explicit intent such as weather, sports, news, local_briefing, finance, comparison, how_to, deep_research, or general." },
      mode: { type: "STRING", description: "Optional research depth: fast, balanced, or deep. Jarvis chooses automatically when omitted." },
      maxSearches: { type: "INTEGER", description: "Maximum expanded search angles to run, 1 to 10." },
      readTopSources: { type: "INTEGER", description: "How many top source URLs to read directly, 0 to 6." },
    }, required: ["query"] } },
    { name: "web_research_deep", description: description("web_research_deep"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "The question or topic to research deeply." },
      context: { type: "STRING", description: "Optional context or constraints." },
      readTopSources: { type: "INTEGER", description: "How many grounded source URLs to read, 0 to 5." },
    }, required: ["query"] } },
    { name: "url_read", description: description("url_read"), parameters: { type: "OBJECT", properties: {
      url: { type: "STRING", description: "Public HTTP/HTTPS URL to read." },
      maxChars: { type: "INTEGER", description: "Maximum extracted characters to return." },
    }, required: ["url"] } },
    { name: "ui_open_widget", description: description("ui_open_widget"), parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] } },
    { name: "ui_focus_widget", description: description("ui_focus_widget"), parameters: { type: "OBJECT", properties: { id: { type: "STRING" } }, required: ["id"] } },
    { name: "ui_close_widget", description: description("ui_close_widget"), parameters: { type: "OBJECT", properties: { id: { type: "STRING" } } } },
    { name: "ui_populate", description: description("ui_populate"), parameters: { type: "OBJECT", properties: {
      id: { type: "STRING" }, state: { type: "STRING" }, data: { type: "OBJECT" },
    }, required: ["id", "data"] } },
    { name: "ui_render_card", description: description("ui_render_card"), parameters: { type: "OBJECT", properties: {
      kind: { type: "STRING" }, title: { type: "STRING" }, body: { type: "STRING" },
      items: { type: "ARRAY", items: { type: "STRING" } }, value: { type: "STRING" }, status: { type: "STRING" },
    }, required: ["title"] } },
    { name: "compose_artifact", description: description("compose_artifact"), parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" },
      prompt: { type: "STRING" },
      objective: { type: "STRING" },
      audience: { type: "STRING" },
      format: { type: "STRING", description: "briefing, markdown, html, report, study_sheet, or trading_brief." },
      content: { type: "STRING" },
      sections: { type: "ARRAY", items: { type: "OBJECT" } },
      sources: { type: "ARRAY", items: { type: "OBJECT" } },
    } } },
    { name: "artifact_status", description: description("artifact_status"), parameters: { type: "OBJECT", properties: {
      id: { type: "STRING", description: "Optional artifact id. Omit to list recent artifacts." },
    } } },
    { name: "atlas_capture", description: description("atlas_capture"), parameters: { type: "OBJECT", properties: {
      text: { type: "STRING", description: "The owner's own sentence to capture verbatim, e.g. 'remind me to call the bank at 5pm' or 'add a task file the reimbursement'." },
      tz: { type: "STRING", description: "Optional IANA timezone; defaults to the owner's resolved location timezone." },
    }, required: ["text"] } },
    { name: "pc_graph_rebuild", description: description("pc_graph_rebuild"), parameters: { type: "OBJECT", properties: {
      roots: { type: "ARRAY", items: { type: "STRING" }, description: "Optional root folders to index. Defaults to workspace, Downloads, Documents, and Desktop." },
      limit: { type: "INTEGER", description: "Maximum files to scan, 1 to 50000. Defaults to 1200." },
    } } },
    { name: "pc_graph_search", description: description("pc_graph_search"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "File, project, class, screenshot, document, or recent-work query." },
      limit: { type: "INTEGER", description: "Maximum matches, 1 to 50." },
    }, required: ["query"] } },
    { name: "pc_graph_timeline", description: description("pc_graph_timeline"), parameters: { type: "OBJECT", properties: {
      hours: { type: "INTEGER", description: "Lookback window in hours." },
      limit: { type: "INTEGER", description: "Maximum timeline items." },
    } } },
    { name: "pc_graph_explain", description: description("pc_graph_explain"), parameters: { type: "OBJECT", properties: {
      target: { type: "STRING", description: "File, project, class, or concept to explain." },
      query: { type: "STRING", description: "Alias for target." },
    } } },
    { name: "pc_graph_inspect", description: description("pc_graph_inspect"), parameters: { type: "OBJECT", properties: {} } },
    { name: "agent_deploy", description: description("agent_deploy"), parameters: { type: "OBJECT", properties: {
      agent: { type: "STRING", description: "One of: coordinator, browser, kalshi, canvas, pc, research, verifier." },
      title: { type: "STRING" },
      objective: { type: "STRING" },
      prompt: { type: "STRING" },
      autonomyLevel: { type: "STRING" },
    }, required: ["objective"] } },
    { name: "skill_compile", description: description("skill_compile"), parameters: { type: "OBJECT", properties: {
      name: { type: "STRING" },
      trigger: { type: "STRING" },
      objective: { type: "STRING" },
      prompt: { type: "STRING" },
      steps: { type: "ARRAY", items: { type: "OBJECT" } },
    } } },
    { name: "skill_run", description: description("skill_run"), parameters: { type: "OBJECT", properties: {
      id: { type: "STRING" },
      name: { type: "STRING" },
      trigger: { type: "STRING" },
      input: { type: "STRING" },
      objective: { type: "STRING" },
      autonomyLevel: { type: "STRING" },
    } } },
    { name: "skill_list", description: description("skill_list"), parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER" },
    } } },
    { name: "skill_inspect", description: description("skill_inspect"), parameters: { type: "OBJECT", properties: {} } },
    { name: "news_headlines", description: description("news_headlines"), parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, category: { type: "STRING" }, limit: { type: "INTEGER" } } } },
    { name: "weather_forecast", description: description("weather_forecast"), parameters: { type: "OBJECT", properties: { latitude: { type: "NUMBER" }, longitude: { type: "NUMBER" } }, required: ["latitude", "longitude"] } },
    { name: "memory_search", description: description("memory_search"), parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, limit: { type: "INTEGER" } }, required: ["query"] } },
    { name: "memory_add", description: description("memory_add"), parameters: { type: "OBJECT", properties: { text: { type: "STRING" }, category: { type: "STRING" } }, required: ["text"] } },
    { name: "life_graph", description: description("life_graph"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } } },
    { name: "neural_vault_status", description: description("neural_vault_status"), parameters: { type: "OBJECT", properties: {} } },
    { name: "neural_vault_context", description: description("neural_vault_context"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "User request or memory question to contextualize." },
      limit: { type: "INTEGER", description: "Maximum memories/candidates to return, 1 to 20." },
    }, required: ["query"] } },
    { name: "neural_vault_resolve", description: description("neural_vault_resolve"), parameters: { type: "OBJECT", properties: {
      message: { type: "STRING", description: "Message containing ambiguous references." },
    }, required: ["message"] } },
    { name: "neural_vault_actions", description: description("neural_vault_actions"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "Optional natural language action/macro query to match." },
    } } },
    { name: "neural_vault_integrations", description: description("neural_vault_integrations"), parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER", description: "Maximum recent integration health events." },
    } } },
    { name: "neural_vault_api_key_metadata", description: description("neural_vault_api_key_metadata"), parameters: { type: "OBJECT", properties: {
      provider: { type: "STRING", description: "Provider name such as gemini, kalshi, canvas, google, instagram, cloudflare, twilio, github, or news." },
      keyLabel: { type: "STRING", description: "Human-safe key label, never the key value." },
      envVarName: { type: "STRING", description: "Environment variable or settings field name that stores the secret." },
      status: { type: "STRING", description: "configured, missing, expired, unknown, or needs_auth." },
      requiredForTools: { type: "ARRAY", items: { type: "STRING" } },
      notes: { type: "STRING" },
    }, required: ["provider", "keyLabel"] } },
    { name: "neural_vault_maintenance", description: description("neural_vault_maintenance"), parameters: { type: "OBJECT", properties: {} } },
    { name: "memory_os_v4_status", description: description("memory_os_v4_status"), parameters: { type: "OBJECT", properties: {} } },
    { name: "memory_os_v4_query", description: description("memory_os_v4_query"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING", description: "The MemoryOS query, path, file, command, agent, or project question." },
      limit: { type: "INTEGER", description: "Maximum objects to return." },
    }, required: ["query"] } },
    { name: "memory_os_v4_scan_files", description: description("memory_os_v4_scan_files"), parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER", description: "Maximum files to inspect." },
    } } },
    { name: "memory_os_v4_run_agent", description: description("memory_os_v4_run_agent"), parameters: { type: "OBJECT", properties: {
      agentId: { type: "STRING", description: "MemoryOS agent id, e.g. file-inspector-agent or memory-manager-agent." },
      task: { type: "STRING" },
      limit: { type: "INTEGER" },
    } } },
    { name: "device_files", description: description("device_files"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } } },
    { name: "device_latest_image", description: description("device_latest_image"), parameters: { type: "OBJECT", properties: {} } },
    { name: "mesh_status", description: description("mesh_status"), parameters: { type: "OBJECT", properties: {} } },
    { name: "mesh_objects", description: description("mesh_objects"), parameters: { type: "OBJECT", properties: {
      id: { type: "STRING", description: "Optional mesh object id to inspect." },
      type: { type: "STRING", description: "Optional object type filter: image, document, text, link, voice, screen, file." },
      limit: { type: "INTEGER", description: "Maximum objects to return." },
    } } },
    { name: "mesh_pair_link", description: description("mesh_pair_link"), parameters: { type: "OBJECT", properties: {
      target: { type: "STRING", description: "Optional target device type: phone, ipad, tablet, laptop, or browser." },
    } } },
    { name: "mesh_self_test", description: description("mesh_self_test"), parameters: { type: "OBJECT", properties: {} } },
    { name: "mesh_send_command", description: description("mesh_send_command"), parameters: { type: "OBJECT", properties: {
      targetDeviceId: { type: "STRING", description: "Device id or any." },
      type: { type: "STRING", description: "open_url, ask_jarvis, approval_card, mission_handoff, object_card, screen_pointer." },
      title: { type: "STRING" },
      body: { type: "STRING" },
      payload: { type: "OBJECT" },
      priority: { type: "STRING" },
    }, required: ["title"] } },
    { name: "coop_symbiote_status", description: description("coop_symbiote_status"), parameters: { type: "OBJECT", properties: {} } },
    { name: "coop_symbiote_create_session", description: description("coop_symbiote_create_session"), parameters: { type: "OBJECT", properties: {
      title: { type: "STRING" },
      mode: { type: "STRING" },
      peerName: { type: "STRING" },
    } } },
    { name: "coop_symbiote_manifest", description: description("coop_symbiote_manifest"), parameters: { type: "OBJECT", properties: {
      limit: { type: "INTEGER" },
    } } },
    { name: "coop_symbiote_chat", description: description("coop_symbiote_chat"), parameters: { type: "OBJECT", properties: {
      sessionId: { type: "STRING" },
      text: { type: "STRING" },
      senderName: { type: "STRING" },
    }, required: ["sessionId", "text"] } },
    { name: "coop_symbiote_patch", description: description("coop_symbiote_patch"), parameters: { type: "OBJECT", properties: {
      sessionId: { type: "STRING" },
      filePath: { type: "STRING" },
      originalText: { type: "STRING" },
      replacementText: { type: "STRING" },
      summary: { type: "STRING" },
    }, required: ["sessionId", "filePath"] } },
    { name: "coop_symbiote_ghost_test", description: description("coop_symbiote_ghost_test"), parameters: { type: "OBJECT", properties: {
      sessionId: { type: "STRING" },
      patchId: { type: "STRING" },
    }, required: ["sessionId", "patchId"] } },
    { name: "coop_symbiote_debate", description: description("coop_symbiote_debate"), parameters: { type: "OBJECT", properties: {
      sessionId: { type: "STRING" },
      topic: { type: "STRING" },
    }, required: ["sessionId", "topic"] } },
    { name: "coop_symbiote_memory", description: description("coop_symbiote_memory"), parameters: { type: "OBJECT", properties: {
      sessionId: { type: "STRING" },
    } } },
    { name: "codebase_search", description: description("codebase_search"), parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, limit: { type: "INTEGER" } }, required: ["query"] } },
    { name: "jarvis_self_inspect", description: description("jarvis_self_inspect"), parameters: { type: "OBJECT", properties: {} } },
    { name: "draft_email", description: description("draft_email"), parameters: { type: "OBJECT", properties: { recipient: { type: "STRING" }, subject: { type: "STRING" }, body: { type: "STRING" } }, required: ["recipient", "subject", "body"] } },
    { name: "gmail_prepare_email", description: description("gmail_prepare_email"), parameters: { type: "OBJECT", properties: { recipient: { type: "STRING" }, subject: { type: "STRING" }, body: { type: "STRING" } }, required: ["recipient", "subject", "body"] } },
    { name: "gmail_send_prepared", description: description("gmail_send_prepared"), parameters: { type: "OBJECT", properties: { draftId: { type: "STRING" }, expectedRecipient: { type: "STRING" }, expectedSubject: { type: "STRING" }, expectedBodyHash: { type: "STRING" } }, required: ["draftId", "expectedRecipient", "expectedSubject", "expectedBodyHash"] } },
    { name: "send_email", description: description("send_email"), parameters: { type: "OBJECT", properties: { recipient: { type: "STRING" }, subject: { type: "STRING" }, body: { type: "STRING" } }, required: ["recipient", "subject", "body"] } },
    { name: "email_smart", description: description("email_smart"), parameters: { type: "OBJECT", properties: {
      recipient: { type: "STRING", description: "A saved contact's name (e.g. 'AJ', 'TG') OR a full email address." },
      email: { type: "STRING", description: "Optional explicit email address to use when the owner supplies one for a name that isn't saved yet." },
      subject: { type: "STRING", description: "Optional subject; defaults to a short placeholder if omitted." },
      body: { type: "STRING", description: "The message body." },
    }, required: ["recipient", "body"] } },
    { name: "contact_add_email", description: description("contact_add_email"), parameters: { type: "OBJECT", properties: {
      name: { type: "STRING", description: "The person's name to save this email under." },
      email: { type: "STRING", description: "Their email address." },
    }, required: ["name", "email"] } },
    { name: "browser_search", description: description("browser_search"), parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] } },
    { name: "browser_status", description: description("browser_status"), parameters: { type: "OBJECT", properties: {} } },
    { name: "browser_login_handoff", description: description("browser_login_handoff"), parameters: { type: "OBJECT", properties: { url: { type: "STRING", description: "Optional HTTP or HTTPS URL to open before checking for login." }, selector: { type: "STRING" }, limit: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_login_complete", description: description("browser_login_complete"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING" }, limit: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_page_brief", description: description("browser_page_brief"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING" }, limit: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_navigate", description: description("browser_navigate"), parameters: { type: "OBJECT", properties: { url: { type: "STRING" }, waitUntil: { type: "STRING", description: "One of commit, domcontentloaded, or load." }, timeoutMs: { type: "INTEGER" } }, required: ["url"] } },
    { name: "browser_snapshot", description: description("browser_snapshot"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING" }, limit: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_tabs", description: description("browser_tabs"), parameters: { type: "OBJECT", properties: { action: { type: "STRING", description: "One of list, new, switch, or close." }, pageId: { type: "STRING" }, url: { type: "STRING" } } } },
    { name: "browser_act", description: description("browser_act"), parameters: { type: "OBJECT", properties: {
      action: { type: "STRING", description: "One of click, fill, press, select, check, uncheck, hover, scroll, or download." },
      ref: { type: "STRING", description: "Element reference returned by browser_snapshot." },
      selector: { type: "STRING", description: "CSS selector fallback when no semantic reference is available." },
      value: { type: "STRING" },
      values: { type: "ARRAY", items: { type: "STRING" } },
      key: { type: "STRING" },
      append: { type: "BOOLEAN" },
      deltaY: { type: "INTEGER" },
      timeoutMs: { type: "INTEGER" },
    }, required: ["action"] } },
    { name: "browser_commit", description: description("browser_commit"), parameters: { type: "OBJECT", properties: {
      reason: { type: "STRING", description: "Short user-visible description of the consequential outcome." },
      operations: { type: "ARRAY", items: { type: "OBJECT", properties: {
        action: { type: "STRING", description: "One of click, fill, press, select, check, uncheck, upload, or download." },
        ref: { type: "STRING" },
        selector: { type: "STRING" },
        value: { type: "STRING" },
        values: { type: "ARRAY", items: { type: "STRING" } },
        key: { type: "STRING" },
        path: { type: "STRING" },
        paths: { type: "ARRAY", items: { type: "STRING" } },
      }, required: ["action"] } },
    }, required: ["reason", "operations"] } },
    { name: "browser_file_search", description: description("browser_file_search"), parameters: { type: "OBJECT", properties: {
      query: { type: "STRING" },
      extension: { type: "STRING" },
      location: { type: "STRING", description: "Optional: runtime, workspace, desktop, documents, or downloads." },
      limit: { type: "INTEGER" },
      timeoutMs: { type: "INTEGER" },
    } } },
    { name: "browser_inspect", description: description("browser_inspect"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING", description: "Optional CSS selector; defaults to body." }, limit: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_click", description: description("browser_click"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING", description: "CSS selector for one visible element." }, timeoutMs: { type: "INTEGER" } }, required: ["selector"] } },
    { name: "browser_type", description: description("browser_type"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING", description: "CSS selector for one visible non-password field." }, value: { type: "STRING" }, append: { type: "BOOLEAN" }, delayMs: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } }, required: ["selector", "value"] } },
    { name: "browser_extract", description: description("browser_extract"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING" }, format: { type: "STRING", description: "text or html." }, maxLength: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_screenshot", description: description("browser_screenshot"), parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "Optional safe PNG filename." }, fullPage: { type: "BOOLEAN" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_wait", description: description("browser_wait"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING" }, state: { type: "STRING", description: "attached, detached, visible, or hidden." }, milliseconds: { type: "INTEGER" }, timeoutMs: { type: "INTEGER" } } } },
    { name: "browser_verify", description: description("browser_verify"), parameters: { type: "OBJECT", properties: { selector: { type: "STRING" }, expectedText: { type: "STRING" }, urlIncludes: { type: "STRING" }, titleIncludes: { type: "STRING" } } } },
    { name: "screen_capture", description: description("screen_capture"), parameters: { type: "OBJECT", properties: { reason: { type: "STRING" } } } },
    { name: "instagram_reply", description: description("instagram_reply"), parameters: { type: "OBJECT", properties: { recipientId: { type: "STRING" }, message: { type: "STRING" } }, required: ["recipientId", "message"] } },
    // These three had definitions and handlers but no declaration, so `selectTools` — which
    // resolves names against `declarations` — could never surface them to the model, while
    // `toolAvailability()` and `catalog()` (both built from `definitions`) advertised them as
    // available. The model was told the Instagram send/like/DM tools existed and then had no way
    // to call them. Parameter shapes below match what the handlers actually read.
    { name: "instagram_like_current", description: description("instagram_like_current"), parameters: { type: "OBJECT", properties: { expectedHandle: { type: "STRING" } } } },
    { name: "instagram_prepare_dm", description: description("instagram_prepare_dm"), parameters: { type: "OBJECT", properties: { recipient: { type: "STRING" }, message: { type: "STRING" } }, required: ["recipient", "message"] } },
    { name: "instagram_send_current", description: description("instagram_send_current"), parameters: { type: "OBJECT", properties: { expectedRecipient: { type: "STRING" }, resolvedRecipient: { type: "STRING" }, expectedConversationUrl: { type: "STRING" }, message: { type: "STRING" } }, required: ["expectedRecipient", "message"] } },
    { name: "instagram_read_inbox", description: description("instagram_read_inbox"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER", description: "Max conversations to return (default 30)." } } } },
    { name: "instagram_read_conversation", description: description("instagram_read_conversation"), parameters: { type: "OBJECT", properties: { name: { type: "STRING", description: "The person's name or handle as it appears in your inbox." }, messages: { type: "INTEGER", description: "How many recent messages to return (default 30)." } }, required: ["name"] } },
    { name: "instagram_read_notifications", description: description("instagram_read_notifications"), parameters: { type: "OBJECT", properties: {} } },
    { name: "instagram_read_people", description: description("instagram_read_people"), parameters: { type: "OBJECT", properties: { which: { type: "STRING", description: "followers or following." }, handle: { type: "STRING", description: "Whose list to read; omit for your own account." }, cap: { type: "INTEGER", description: "Max people to harvest (default 200)." } }, required: ["which"] } },
    { name: "list_windows", description: description("list_windows"), parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } } },
    { name: "inspect_window", description: description("inspect_window"), parameters: { type: "OBJECT", properties: { title: { type: "STRING" }, limit: { type: "INTEGER" } }, required: ["title"] } },
    { name: "focus_window", description: description("focus_window"), parameters: { type: "OBJECT", properties: { title: { type: "STRING" } }, required: ["title"] } },
    { name: "invoke_control", description: description("invoke_control"), parameters: { type: "OBJECT", properties: { windowTitle: { type: "STRING" }, controlName: { type: "STRING" }, automationId: { type: "STRING" } }, required: ["windowTitle", "controlName"] } },
    { name: "set_control_value", description: description("set_control_value"), parameters: { type: "OBJECT", properties: { windowTitle: { type: "STRING" }, controlName: { type: "STRING" }, automationId: { type: "STRING" }, value: { type: "STRING" } }, required: ["windowTitle", "controlName", "value"] } },
    { name: "run_command", description: description("run_command"), parameters: { type: "OBJECT", properties: {
      command: { type: "STRING", description: "PowerShell command to execute on the local Windows machine." },
      timeout_ms: { type: "INTEGER", description: "Execution timeout in milliseconds. Maximum 30000. Defaults to 15000." },
    }, required: ["command"] } },
    { name: "write_file", description: description("write_file"), parameters: { type: "OBJECT", properties: {
      path: { type: "STRING", description: "File path. A bare filename (e.g. absdefgh.docx) is saved to the Desktop; ~ expands to the home dir; absolute paths are honored. Existing file is overwritten." },
      content: { type: "STRING", description: "The content. For .docx this is the document text (use newlines for separate paragraphs)." },
      docxFontPt: { type: "INTEGER", description: "For .docx only: font size in points (e.g. 72 = huge). Default 24." },
      docxColor: { type: "STRING", description: "For .docx only: font colour name (blue, red, green, black…) or 6-digit hex like 0000FF." },
      docxBold: { type: "BOOLEAN", description: "For .docx only: bold the text. Defaults true when font is large." },
    }, required: ["path", "content"] } },
    { name: "delete_file", description: description("delete_file"), parameters: { type: "OBJECT", properties: {
      path: { type: "STRING", description: "Absolute path to the file or empty directory to delete." },
    }, required: ["path"] } },
    { name: "read_clipboard", description: description("read_clipboard"), parameters: { type: "OBJECT", properties: {} } },
    { name: "write_clipboard", description: description("write_clipboard"), parameters: { type: "OBJECT", properties: {
      text: { type: "STRING", description: "Text content to write to the Windows clipboard." },
    }, required: ["text"] } },
    { name: "toast_notification", description: description("toast_notification"), parameters: { type: "OBJECT", properties: {
      title: { type: "STRING", description: "Toast notification title." },
      message: { type: "STRING", description: "Toast notification body message." },
    }, required: ["title", "message"] } },
    { name: "screen_analyze", description: description("screen_analyze"), parameters: { type: "OBJECT", properties: {
      question: { type: "STRING", description: "What to look for or analyze on screen. Omit for a general description of everything visible." },
    } } },
    { name: "computer_use", description: description("computer_use"), parameters: { type: "OBJECT", properties: {
      task: { type: "STRING", description: "Natural language task to execute visually on screen, e.g. 'search YouTube for lo-fi music and play the first result' or 'open Instagram DMs and send Avery a message saying hey'. State the outcome the owner asked for and nothing more. NEVER append your own safety wording such as 'leave it unsent', 'do not click Send' or 'stop before sending' — the runtime already pauses every send, post, like, purchase and delete at the final control for the owner's approval, and that wording cancels the send outright so the owner is never asked. If the owner explicitly wants a draft, put the text in prepareOnlyText instead." },
      maxSteps: { type: "INTEGER", description: "Maximum automation steps, 1 to 25. Defaults to 15." },
      startUrl: { type: "STRING", description: "Optional already-open HTTPS surface to keep re-focused during visible browser automation." },
      prepareOnlyText: { type: "STRING", description: "Optional exact draft text that may be prepared but must never be submitted during this capability call." },
    }, required: ["task"] } },
    { name: "screen_locate", description: description("screen_locate"), parameters: { type: "OBJECT", properties: {
      description: { type: "STRING", description: "Visual description of the element to find, e.g. 'YouTube search bar', 'Instagram messages icon', 'play button'." },
    }, required: ["description"] } },
    { name: "mouse_scroll", description: description("mouse_scroll"), parameters: { type: "OBJECT", properties: {
      direction: { type: "STRING", description: "Scroll direction: up or down." },
      amount: { type: "INTEGER", description: "Number of scroll notches, 1 to 10." },
      x: { type: "INTEGER", description: "Screen X coordinate to scroll at. Defaults to screen center." },
      y: { type: "INTEGER", description: "Screen Y coordinate to scroll at. Defaults to screen center." },
    }, required: ["direction"] } },
  ];

  function definitionFor(name) {
    return definitions.find((item) => item.name === name);
  }

  function loadConfirmations() {
    const now = Date.now();
    const values = readJson(confirmationsPath, []);
    const active = values.filter((item) => item.status === "pending" && new Date(item.expiresAt).getTime() > now);
    if (active.length !== values.length) writeJsonAtomic(confirmationsPath, active);
    return active;
  }

  function confirmationSummary(args = {}) {
    return Object.fromEntries(Object.entries(args).map(([key, value]) => {
      if (/token|secret|password|authorization|api.?key|cookie/i.test(key)) return [key, "[redacted]"];
      const limit = /body|message|content/i.test(key) ? 120 : 200;
      const cleaned = cleanString(value, limit);
      return [key, `${cleaned}${String(value || "").length > limit ? "..." : ""}`];
    }));
  }

  function requestConfirmation(tool, args, actor = {}) {
    const definition = definitionFor(tool);
    if (!actor.sessionId) throw errorWithStatus("A trusted local session is required for confirmation", 401);
    const item = {
      id: crypto.randomUUID(),
      tool,
      args,
      argumentHash: hash(args),
      risk: definition?.risk || "commit",
      actor: {
        deviceId: cleanString(actor.deviceId || "local-browser", 100),
        sessionId: cleanString(actor.sessionId, 200),
      },
      continuation: {
        actionTaskId: cleanString(actor.actionTaskId, 160) || null,
        actionStepId: cleanString(actor.actionStepId, 160) || null,
        placement: cleanString(actor.placement, 40) || null,
        surface: cleanString(actor.surface, 80) || null,
      },
      ownerChallenge: crypto.randomBytes(32).toString("base64url"),
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    writeJsonAtomic(confirmationsPath, [item, ...loadConfirmations()].slice(0, 50));
    return {
      id: item.id,
      tool,
      summary: confirmationSummary(args),
      // The card used to render `summary` — the raw argument bag — so an owner deciding whether to
      // send a message read `_commitBoundary: [object Object]` next to `plannerTask` and a truncated
      // `task`. `commit` is the same decision expressed as the three things that actually matter:
      // what the click does, where it lands, and which instruction it came from.
      commit: commitCard(args),
      risk: item.risk,
      expiresAt: item.expiresAt,
      message: `Confirmation required to run ${tool}.`,
    };
  }

  // Null for everything except a paused browser/screen commit, which is the only case that carries
  // a boundary descriptor. Every field here is copied, never composed — nothing is inferred.
  function commitCard(args = {}) {
    const boundary = args && typeof args._commitBoundary === "object" ? args._commitBoundary : null;
    if (!boundary) return null;
    return {
      intent: cleanString(boundary.intent, 200) || "Perform the pending action",
      target: cleanString(boundary.targetName, 160),
      url: cleanString(boundary.url, 300),
      surface: cleanString(boundary.pageTitle, 200),
      task: cleanString(boundary.task || args.task, 600),
      action: cleanString(boundary.action, 40),
      key: cleanString(boundary.key, 40),
      // Kept visible because "an unlabelled control" is a real caveat the owner should weigh, not
      // something to paper over with a confident-sounding label.
      unlabelled: !cleanString(boundary.targetName, 160),
      // WHO receives this. The card used to describe only the action — "Type X into the message
      // input, then send it" — and never named a recipient, so when four messages went into a group
      // chat the owner had nothing on screen to catch it with. Read off the page at boundary time;
      // `confirmed: false` means the page did not say, and is shown as unconfirmed rather than
      // quietly omitted. The two lanes nest the boundary differently, hence both lookups.
      recipient: (() => {
        const found = boundary.recipient || boundary.pendingAction?.recipient || null;
        if (!found) return null;
        return { text: cleanString(found.text, 200), confirmed: found.confirmed === true, kind: cleanString(found.kind, 20) };
      })(),
    };
  }

  // Node builds execFile errors as `Command failed: <file> <args…>\n<stderr>`, and for us `args`
  // is the entire PowerShell/C# script passed to -Command. That message was returned verbatim as
  // `error.message`, fed back to the model, and interpolated into the owner-facing failure text —
  // so every UI-Automation `throw` shipped hundreds of lines of its own source into the chat.
  // The useful part is the last line of stderr (usually the script's own `throw`); the script
  // body is noise to the owner and prompt-poison to the model.
  function cleanPowershellFailure(error, script) {
    const scriptText = String(script || "");
    const stderr = String(error?.stderr || "").trim();
    const raw = stderr || String(error?.message || "");
    // Echoed script lines are matched by whole-line equality, not `includes`. A thrown message is
    // a *substring* of its own source line (`throw 'No visible tab…'`), so a substring test
    // deleted the one line worth showing along with the source.
    const scriptLines = new Set(scriptText.split("\n").map((line) => line.trim()).filter(Boolean));
    const withoutInvocation = raw
      .replace(/^Command failed:[^\n]*\n?/i, "")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (scriptLines.has(trimmed)) return false;
        // PowerShell's positional error decorations carry no meaning for the owner.
        return !/^(?:\+\s|At line:|At char:|\s*~+\s*$|\s*\+\s*CategoryInfo|\s*\+\s*FullyQualifiedErrorId)/.test(line);
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (error?.killed || /ETIMEDOUT/i.test(String(error?.code || ""))) return "The desktop command timed out.";
    const message = withoutInvocation || "The desktop command failed without reporting a reason.";
    return message.slice(0, 300);
  }

  async function powershell(script, timeout = 10000) {
    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { timeout, windowsHide: true, maxBuffer: MAX_OUTPUT },
      );
      return stdout.trim();
    } catch (error) {
      const clean = new Error(cleanPowershellFailure(error, script));
      clean.code = error?.code;
      // Kept off `.message` so diagnostics survive without reaching the owner or the model.
      clean.rawStderr = String(error?.stderr || "").slice(0, 2000);
      throw clean;
    }
  }

  async function systemStatus() {
    const interfaces = Object.values(os.networkInterfaces()).flat().filter(Boolean)
      .filter((item) => item.family === "IPv4")
      .map((item) => ({ address: item.address, internal: item.internal, cidr: item.cidr }));
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSeconds: Math.round(os.uptime()),
      cpu: { model: os.cpus()[0]?.model || "unknown", logicalCores: os.cpus().length, loadAverage: os.loadavg() },
      memory: { totalBytes: os.totalmem(), freeBytes: os.freemem(), usedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100) },
      network: interfaces,
      observedAt: new Date().toISOString(),
    };
  }

  async function listProcesses(args) {
    const limit = asNumber(args.limit, 20, 1, 50);
    const script = `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${limit} Id,ProcessName,WorkingSet64,CPU | ConvertTo-Json -Compress`;
    const output = await powershell(script);
    const parsed = output ? JSON.parse(output) : [];
    return { processes: Array.isArray(parsed) ? parsed : [parsed] };
  }

  function requireNeuralVault() {
    if (!neuralVault) throw errorWithStatus("Neural Vault is not available in this runtime.", 412);
    return neuralVault;
  }

  async function openApp(args) {
    const key = cleanString(args.app, 40).toLowerCase();
    const app = appCatalog[key];
    if (!app) throw errorWithStatus(`Unsupported app. Allowed: ${Object.keys(appCatalog).join(", ")}`);
    const child = spawn(app.command, app.args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { opened: key, processStarted: true };
  }

  function normalizeOpenUrl(value) {
    const suppliedRaw = cleanString(value, 2000);
    const supplied = siteAliases[suppliedRaw.toLowerCase()] || suppliedRaw;
    if (!supplied) throw errorWithStatus("A URL is required");
    let target;
    try {
      target = new URL(/^[a-z][a-z0-9+.-]*:/i.test(supplied) ? supplied : `https://${supplied}`);
    } catch {
      throw errorWithStatus("The URL is invalid");
    }
    if (!["http:", "https:"].includes(target.protocol)) throw errorWithStatus("Only HTTP and HTTPS URLs are allowed");
    if (target.username || target.password) throw errorWithStatus("URLs containing credentials are not allowed");
    if (!target.hostname) throw errorWithStatus("The URL must include a hostname");
    return target.toString();
  }

  async function openUrl(args) {
    const normalized = normalizeOpenUrl(args.url);
    const desktop = await desktopControl({ action: "open_site", target: normalized });
    if (!desktop.visible) throw errorWithStatus(`Opened ${normalized}, but could not verify it on the visible desktop.`, 502);
    return { opened: true, visible: true, url: normalized, desktop };
  }

  async function youtubeOpenVideo(args = {}) {
    const query = cleanString(args.query || args.title || args.video || args.target, 300);
    if (!query) throw errorWithStatus("A YouTube video title or search query is required.");
    const latest = args.latest === true || /\b(latest|newest|most recent|recent upload)\b/i.test(query);
    const normalizedQuery = query.replace(/\b(latest|newest|most recent|recent upload|video|on youtube|youtube)\b/ig, " ").replace(/\s+/g, " ").trim() || query;
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedQuery)}${latest ? "&sp=CAI%253D" : ""}`;
    let videoId = "";
    let videoTitle = "";
    let channelTitle = "";
    let publishedTime = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let html = "";
      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
            "accept-language": "en-US,en;q=0.9",
          },
        });
        html = await response.text();
      } finally {
        clearTimeout(timer);
      }
      const renderers = [...html.matchAll(/"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})"([\s\S]{0,7000}?)(?="videoRenderer"|"channelRenderer"|"playlistRenderer"|$)/g)];
      const first = renderers[0];
      if (first) {
        videoId = first[1];
        const block = first[2] || "";
        videoTitle = block.match(/"title":\{"runs":\[\{"text":"([^"]+)"/)?.[1] || "";
        channelTitle = block.match(/"ownerText":\{"runs":\[\{"text":"([^"]+)"/)?.[1] || "";
        publishedTime = block.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/)?.[1] || "";
      }
      if (!videoId) {
        const ids = [
          ...[...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((match) => match[1]),
          ...[...html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g)].map((match) => match[1]),
        ];
        videoId = ids.find(Boolean) || "";
      }
    } catch {
      videoId = "";
    }
    if (videoId && (!videoTitle || !channelTitle)) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
          const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: controller.signal });
          const metadata = response.ok ? await response.json() : {};
          videoTitle = cleanString(metadata.title, 300) || videoTitle;
          channelTitle = cleanString(metadata.author_name, 200) || channelTitle;
        } finally {
          clearTimeout(timer);
        }
      } catch {}
    }
    const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : searchUrl;
    const desktop = await desktopControl({
      action: args.fullscreen === false ? "open_site" : "open_site_fullscreen",
      target: url,
      fullscreen: args.fullscreen !== false,
    });
    return {
      query,
      normalizedQuery,
      latest,
      openedVideo: Boolean(videoId),
      videoTitle,
      channelTitle,
      publishedTime,
      url,
      fallbackSearchOpened: !videoId,
      desktop,
    };
  }

  function psSingleQuoted(value) {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
  }

  function desktopHotkeySequence(name) {
    return {
      f: "f",
      space: " ",
      enter: "{ENTER}",
      escape: "{ESC}",
      tab: "{TAB}",
      shift_tab: "+{TAB}",
      ctrl_l: "^l",
      ctrl_r: "^r",
      ctrl_tab: "^{TAB}",
      ctrl_shift_tab: "^+{TAB}",
      f11: "{F11}",
      alt_left: "%{LEFT}",
      alt_right: "%{RIGHT}",
      page_down: "{PGDN}",
      page_up: "{PGUP}",
    }[cleanString(name, 40).toLowerCase()];
  }

  async function inspectScreen(args = {}) {
    const limit = asNumber(args.limit, 80, 1, 120);
    const script = [
      "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class InspectDpiOps {\n[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();\n}\n'@",
      "[InspectDpiOps]::SetProcessDPIAware() | Out-Null",
      "Add-Type -AssemblyName UIAutomationClient",
      "Add-Type -AssemblyName UIAutomationTypes",
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class ForegroundOps {\n[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n}\n'@",
      "$foreground=[ForegroundOps]::GetForegroundWindow()",
      "$root=[System.Windows.Automation.AutomationElement]::FromHandle($foreground)",
      "if($null -eq $root){ $root=[System.Windows.Automation.AutomationElement]::RootElement }",
      "function SafeText([object]$value){ return (([string]$value) -replace '[\\x00-\\x1F]',' ').Trim() }",
      "$rootName=SafeText $root.Current.Name",
      "$rootType=[string]$root.Current.ControlType.ProgrammaticName",
      "$rootRect=$root.Current.BoundingRectangle",
      "$primary=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
      "$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$items=@()",
      "foreach($node in $nodes){",
      "  try {",
      "    $rect=$node.Current.BoundingRectangle",
      "    if($node.Current.IsOffscreen -or $rect.Width -le 4 -or $rect.Height -le 4){ continue }",
      "    if([double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.Y) -or [double]::IsInfinity($rect.Y) -or [double]::IsNaN($rect.Width) -or [double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Height) -or [double]::IsInfinity($rect.Height)){ continue }",
      "    $name=SafeText $node.Current.Name",
      "    $help=SafeText $node.Current.HelpText",
      "    $automationId=SafeText $node.Current.AutomationId",
      "    $type=[string]$node.Current.ControlType.ProgrammaticName",
      "    $label=(($name+' '+$help+' '+$automationId).Trim())",
      "    if([string]::IsNullOrWhiteSpace($label)){ continue }",
      "    if($label.Length -gt 220){ continue }",
      "    if($rect.Width -gt 1000 -and $rect.Height -lt 80 -and $label.Length -gt 120){ continue }",
      "    $valueText=''",
      "    try {",
      "      if($node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){",
      "        $valuePattern=$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)",
      "        $valueText=SafeText $valuePattern.Current.Value",
      "      }",
      "    } catch {}",
      "    if($valueText.Length -gt 240){ $valueText=$valueText.Substring(0,240) }",
      "    $items += [ordered]@{",
      "      name=$name; helpText=$help; automationId=$automationId; controlType=$type;",
      "      x=[int]$rect.X; y=[int]$rect.Y; width=[int]$rect.Width; height=[int]$rect.Height;",
      "      centerX=[int]($rect.X+($rect.Width/2)); centerY=[int]($rect.Y+($rect.Height/2));",
      "      invoke=([bool]($node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty) -eq $true));",
      "      value=([bool]($node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true));",
      "      text=([bool]($node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsTextPatternAvailableProperty) -eq $true));",
      "      valueText=$valueText",
      "    }",
      "  } catch {}",
      "}",
      `$controls=@($items | Sort-Object y,x | Select-Object -First ${limit})`,
      "$payload=[ordered]@{foregroundWindow=[ordered]@{name=$rootName;controlType=$rootType};uiBounds=[ordered]@{x=[int]$rootRect.X;y=[int]$rootRect.Y;width=[int]$rootRect.Width;height=[int]$rootRect.Height};screenBounds=[ordered]@{x=[int]$primary.X;y=[int]$primary.Y;width=[int]$primary.Width;height=[int]$primary.Height};count=[int]$items.Count;controls=$controls}",
      "$payload | ConvertTo-Json -Depth 5 -Compress",
    ].join("\n");
    return parsePowerShellJson(await powershell(script, 12000), "Screen inspection");
  }

  function words(value) {
    return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])]
      .filter((word) => !new Set(["the", "and", "for", "with", "this", "that", "click", "press", "open", "make", "screen", "please", "sir", "full", "fullscreen"]).has(word));
  }

  function inferScreenAction(instruction, supplied) {
    const action = cleanString(supplied, 40).toLowerCase();
    if (["click", "double_click", "type", "press", "fullscreen"].includes(action)) return action;
    const lower = String(instruction || "").toLowerCase();
    if (/\b(full ?screen|maximi[sz]e)\b/.test(lower)) return "fullscreen";
    if (/\b(type|write|enter|fill)\b/.test(lower)) return "type";
    if (/\b(press|hit)\b/.test(lower)) return "press";
    return "click";
  }

  function inferTargetText(instruction) {
    const text = cleanString(instruction, 240)
      .replace(/\b(on|in|from)\s+my\s+(screen|laptop|computer|desktop)\b/ig, "")
      .replace(/\b(can you|please|jarvis|sir|click|press|open|select|choose|tap|move my cursor to|move the cursor to|then|and)\b/ig, " ")
      .replace(/\b(make|put|go|it|this|that)\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text;
  }

  function scoreVisibleControl(control, { instruction, targetText, action }) {
    const label = `${control.name || ""} ${control.helpText || ""} ${control.automationId || ""}`.toLowerCase();
    if (!label.trim()) return 0;
    const target = String(targetText || "").toLowerCase().trim();
    const targetWords = words(target || instruction);
    const instructionWords = words(instruction);
    let score = 0;
    if (target && label === target) score += 140;
    if (target && label.includes(target)) score += 110;
    const hits = targetWords.filter((word) => label.includes(word));
    score += hits.length * 18;
    if (targetWords.length && hits.length === targetWords.length) score += 45;
    const type = String(control.controlType || "").toLowerCase();
    const lowerInstruction = String(instruction || "").toLowerCase();
    const youtubeSearchInstruction = /\b(youtube|you tube)\b/.test(lowerInstruction)
      && /\b(search|search bar)\b/.test(lowerInstruction)
      && action === "type";
    const chromeAddressBar = /\b(address and search bar|search google or type a url|view_1012|omnibox)\b/.test(label);
    if (/button|hyperlink|listitem|menuitem|tabitem|edit/.test(type)) score += 16;
    if (/document|pane|window/.test(type)) score -= 55;
    if (action === "type" && /edit|combo/.test(type)) score += 45;
    if (youtubeSearchInstruction && chromeAddressBar) score -= 260;
    if (youtubeSearchInstruction && !chromeAddressBar && /edit|combo/.test(type) && /\bsearch\b/.test(label)) score += 95;
    if (action === "click" && /hyperlink|button|listitem/.test(type)) score += 25;
    if (/\b(first|top)\b/.test(lowerInstruction)) score += Math.max(0, 30 - Math.floor(Number(control.y || 0) / 80));
    if (/\b(video|result|watch)\b/.test(lowerInstruction) && /hyperlink|listitem|document/.test(type) && String(control.name || "").length > 12) score += 30;
    if (instructionWords.some((word) => label.includes(word))) score += 8;
    if (Number(control.width || 0) > 1200 && Number(control.height || 0) < 90) score -= 40;
    if (Number(control.width || 0) > 1800 && Number(control.height || 0) > 1000) score -= 90;
    return score;
  }

  function chooseVisibleControl(controls, options) {
    const ranked = (Array.isArray(controls) ? controls : [])
      .map((control) => ({ control, score: scoreVisibleControl(control, options) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.control.y || 0) - Number(b.control.y || 0));
    return { best: ranked[0] || null, ranked: ranked.slice(0, 8) };
  }

  function normalizeScreenPoint(point, inspection) {
    const ui = inspection?.uiBounds || {};
    const screen = inspection?.screenBounds || {};
    const x = Number(point?.x);
    const y = Number(point?.y);
    const uiWidth = Number(ui.width);
    const uiHeight = Number(ui.height);
    const screenWidth = Number(screen.width);
    const screenHeight = Number(screen.height);
    if (![x, y, uiWidth, uiHeight, screenWidth, screenHeight].every(Number.isFinite) || uiWidth <= 0 || uiHeight <= 0 || screenWidth <= 0 || screenHeight <= 0) {
      return { x, y, scaled: false };
    }
    const needsScale = x > screen.x + screenWidth || y > screen.y + screenHeight || uiWidth > screenWidth * 1.25 || uiHeight > screenHeight * 1.25;
    if (!needsScale) return { x, y, scaled: false };
    return {
      x: Math.round(Number(screen.x || 0) + ((x - Number(ui.x || 0)) * screenWidth / uiWidth)),
      y: Math.round(Number(screen.y || 0) + ((y - Number(ui.y || 0)) * screenHeight / uiHeight)),
      scaled: true,
      uiBounds: ui,
      screenBounds: screen,
    };
  }

  async function screenAct(args = {}) {
    const instruction = cleanString(args.instruction || args.goal || args.command, 600);
    if (!instruction) throw errorWithStatus("screen_act requires an instruction.");
    if (/\b(password|captcha|purchase|buy|sell|trade|submit|send|pay|checkout|wire|bank|delete account)\b/i.test(instruction)) {
      throw errorWithStatus("screen_act blocked a sensitive or consequential visible-screen action. Use an explicit approved workflow instead.", 403);
    }
    const action = inferScreenAction(instruction, args.action);
    const targetText = cleanString(args.targetText || args.target || inferTargetText(instruction), 240);
    const before = screenCapture ? await screenCapture({ reason: `screen_act before: ${instruction}` }) : null;
    const inspection = await inspectScreen({ limit: 100 });
    const choice = chooseVisibleControl(inspection.controls, { instruction, targetText, action });
    const result = {
      instruction,
      action,
      targetText,
      foregroundWindow: inspection.foregroundWindow,
      beforeCapture: before ? { path: before.path, dimensions: before.dimensions, capturedAt: before.capturedAt } : null,
      matchedControl: choice.best ? { ...choice.best.control, score: choice.best.score } : null,
      alternatives: choice.ranked.slice(1, 5).map((item) => ({ name: item.control.name, controlType: item.control.controlType, score: item.score, x: item.control.x, y: item.control.y })),
    };

    if (action === "press") {
      const hotkey = cleanString(args.hotkey || (/enter/i.test(instruction) ? "enter" : /escape|esc/i.test(instruction) ? "escape" : /space/i.test(instruction) ? "space" : "enter"), 40);
      result.performed = await desktopControl({ action: "hotkey", hotkey });
    } else if (action === "fullscreen") {
      const mode = cleanString(args.fullscreenMode || (/\b(browser|chrome|window)\b/i.test(instruction) ? "browser" : "player"), 40).toLowerCase();
      result.fullscreenMode = mode;
      result.performed = mode === "browser"
        ? await desktopControl({ action: "fullscreen" })
        : await desktopControl({ action: "hotkey", hotkey: "f" });
    } else {
      let clickX, clickY;
      const minimumUiScore = action === "type" ? 90 : 82;
      if (choice.best?.control && choice.best.score >= minimumUiScore) {
        const { centerX, centerY } = choice.best.control;
        const point = normalizeScreenPoint({ x: centerX, y: centerY }, inspection);
        result.normalizedPoint = point;
        clickX = point.x;
        clickY = point.y;
      } else if (computerUse) {
        // UI Automation tree didn't find the element — fall back to Gemini Vision grounding
        const located = await computerUse.locateElement(targetText || instruction);
        if (!located.found || (located.confidence || 0) < 0.65) {
          throw errorWithStatus(
            `Could not safely locate "${targetText || instruction}". Best UI match scored ${choice.best?.score || 0}; visual confidence was ${(located.confidence || 0).toFixed(2)}. No click was performed.`,
            404,
          );
        }
        result.matchedControl = { name: located.description, x: located.x, y: located.y, confidence: located.confidence, source: "visual_grounding" };
        clickX = located.x;
        clickY = located.y;
      } else {
        throw errorWithStatus(`Could not locate a visible screen target for "${targetText || instruction}".`, 404);
      }
      result.performed = await desktopControl({ action: "click", x: clickX, y: clickY });
      if (action === "double_click") result.performedSecondClick = await desktopControl({ action: "click", x: clickX, y: clickY });
      if (action === "type") {
        const text = cleanString(args.text || args.value, 5000);
        if (!text) throw errorWithStatus("screen_act type requires text.");
        result.typed = await desktopControl({ action: "type_text", text });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 650));
    const after = screenCapture ? await screenCapture({ reason: `screen_act after: ${instruction}` }) : null;
    result.afterCapture = after ? { path: after.path, dimensions: after.dimensions, capturedAt: after.capturedAt } : null;
    result.verified = Boolean(result.performed?.ok !== false && (result.afterCapture || action === "press" || action === "fullscreen"));
    if (!result.verified) throw errorWithStatus(`The visible-screen action could not be verified: ${instruction}`, 502);
    return result;
  }

  async function desktopControl(args = {}) {
    const action = cleanString(args.action, 60).toLowerCase();
    const allowed = new Set(["open_site_fullscreen", "open_site", "activate_site", "scroll_page", "fullscreen", "next_tab", "previous_tab", "tab_number", "hotkey", "click_text", "click", "type_text", "youtube_search_visible"]);
    if (!allowed.has(action)) throw errorWithStatus(`Unsupported desktop action: ${action}`);

    if (action === "activate_site") {
      const target = normalizeOpenUrl(args.target || args.url || "google");
      const hostname = new URL(target).hostname.replace(/^www\./, "");
      const siteTitle = hostname.includes("youtube.com") ? "YouTube"
        : hostname.includes("instagram.com") ? "Instagram"
          : hostname.includes("mail.google.com") ? "Gmail"
            : hostname.includes("github.com") ? "GitHub"
              : hostname.includes("reddit.com") ? "Reddit"
                : hostname.split(".")[0];
      const script = [
        "Add-Type -AssemblyName UIAutomationClient",
        "Add-Type -AssemblyName UIAutomationTypes",
        `$siteTitle=${psSingleQuoted(siteTitle)}`,
        "$shell=New-Object -ComObject WScript.Shell",
        "$activated=$false",
        "$selectedTab=''",
        "$selectedVia=''",
        "$p=$null",
        "$browserProcesses=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -eq 'chrome' -or $_.ProcessName -eq 'msedge') }",
        "foreach($candidate in $browserProcesses){",
        "  try {",
        "    $root=[System.Windows.Automation.AutomationElement]::FromHandle($candidate.MainWindowHandle)",
        "    if($null -eq $root){ continue }",
        "    $tabCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)",
        "    $tabs=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$tabCondition)",
        "    foreach($tab in $tabs){",
        "      try {",
        "        $name=([string]$tab.Current.Name).Trim()",
        "        if($name -notlike ('*'+$siteTitle+'*') -or $tab.Current.IsOffscreen){ continue }",
        "        if($tab.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsSelectionItemPatternAvailableProperty) -eq $true){",
        "          $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()",
        "          $selectedVia='selection_pattern'",
        "        } elseif($tab.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty) -eq $true){",
        "          $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()",
        "          $selectedVia='invoke_pattern'",
        "        } else { continue }",
        "        $selectedTab=$name",
        "        $p=$candidate",
        "        break",
        "      } catch {}",
        "    }",
        "    if($null -ne $p){ break }",
        "  } catch {}",
        "}",
        "if($null -eq $p){",
        "  $p=Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like ('*'+$siteTitle+'*') } | Select-Object -First 1",
        "}",
        "if($null -ne $p){",
        "  $activated=$shell.AppActivate($p.Id)",
        "  Start-Sleep -Milliseconds 300",
        "}",
        "$foreground=if($null -ne $p){[string](Get-Process -Id $p.Id -ErrorAction SilentlyContinue).MainWindowTitle}else{''}",
        "[pscustomobject]@{action='activate_site';hostname=" + psSingleQuoted(hostname) + ";expectedTitle=$siteTitle;activated=$activated;visible=[bool]($activated -and ($selectedTab -or $foreground -like ('*'+$siteTitle+'*')));selectedTab=$selectedTab;selectedVia=$selectedVia;foregroundTitle=$foreground} | ConvertTo-Json -Compress",
      ].join("\n");
      const activated = parsePowerShellJson(await powershell(script, 6500), "Desktop activation");
      if (!activated.visible) throw errorWithStatus(`Could not reactivate the visible ${siteTitle} browser surface.`, 502);
      return activated;
    }

    if (action === "scroll_page") {
      const target = normalizeOpenUrl(args.target || args.url || "google");
      const hostname = new URL(target).hostname.replace(/^www\./, "");
      const siteTitle = hostname.includes("youtube.com") ? "YouTube"
        : hostname.includes("instagram.com") ? "Instagram"
          : hostname.includes("mail.google.com") ? "Gmail"
            : hostname.includes("github.com") ? "GitHub"
              : hostname.includes("reddit.com") ? "Reddit"
                : hostname.split(".")[0];
      const direction = cleanString(args.direction || "down", 20).toLowerCase() === "up" ? "up" : "down";
      const script = [
        "Add-Type -AssemblyName UIAutomationClient",
        "Add-Type -AssemblyName UIAutomationTypes",
        "Add-Type -AssemblyName System.Windows.Forms",
        `$siteTitle=${psSingleQuoted(siteTitle)}`,
        `$direction=${psSingleQuoted(direction)}`,
        "$shell=New-Object -ComObject WScript.Shell",
        "$p=Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like ('*'+$siteTitle+'*') } | Select-Object -First 1",
        "if($null -eq $p){ throw ('No visible '+$siteTitle+' browser window was found.') }",
        "$activated=$shell.AppActivate($p.Id)",
        "Start-Sleep -Milliseconds 180",
        "$root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)",
        "$scrollNode=$null;$bestArea=0",
        "if($null -ne $root){",
        "  $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
        "  foreach($node in $nodes){",
        "    try {",
        "      $rect=$node.Current.BoundingRectangle",
        "      $supports=$node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty)",
        "      $area=[double]$rect.Width*[double]$rect.Height",
        "      if($supports -eq $true -and -not $node.Current.IsOffscreen -and $area -gt $bestArea){ $scrollNode=$node;$bestArea=$area }",
        "    } catch {}",
        "  }",
        "}",
        "$method='sendkeys';$before=-1;$after=-1",
        "if($null -ne $scrollNode){",
        "  $pattern=$scrollNode.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)",
        "  $before=[double]$pattern.Current.VerticalScrollPercent",
        "  $amount=if($direction -eq 'up'){[System.Windows.Automation.ScrollAmount]::LargeDecrement}else{[System.Windows.Automation.ScrollAmount]::LargeIncrement}",
        "  $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,$amount)",
        "  $method='uia-scroll-pattern'",
        "  Start-Sleep -Milliseconds 350",
        "  $after=[double]$pattern.Current.VerticalScrollPercent",
        "} else {",
        "  try { $root.SetFocus() } catch {}",
        "  [System.Windows.Forms.SendKeys]::SendWait($(if($direction -eq 'up'){'{PGUP}'}else{'{PGDN}'}))",
        "  Start-Sleep -Milliseconds 350",
        "}",
        "[pscustomobject]@{action='scroll_page';hostname=" + psSingleQuoted(hostname) + ";direction=$direction;activated=$activated;method=$method;before=$before;after=$after;scrolled=($method -eq 'sendkeys' -or $after -ne $before)} | ConvertTo-Json -Compress",
      ].join("\n");
      const scrolled = parsePowerShellJson(await powershell(script, 8000), "Desktop scrolling");
      if (!scrolled.activated || !scrolled.scrolled) throw errorWithStatus(`Could not scroll the visible ${siteTitle} surface.`, 502);
      return scrolled;
    }

    if (["open_site_fullscreen", "open_site"].includes(action)) {
      const target = normalizeOpenUrl(args.target || args.url || "google");
      const fullscreen = action === "open_site_fullscreen" || args.fullscreen === true;
      const hostname = new URL(target).hostname.replace(/^www\./, "");
      const siteTitle = hostname.includes("youtube.com") ? "YouTube"
        : hostname.includes("instagram.com") ? "Instagram"
          : hostname.includes("mail.google.com") ? "Gmail"
            : hostname.includes("github.com") ? "GitHub"
              : hostname.includes("reddit.com") ? "Reddit"
                : hostname.split(".")[0];
      const script = [
        `$url=${psSingleQuoted(target)}`,
        `$siteTitle=${psSingleQuoted(siteTitle)}`,
        "$shell=New-Object -ComObject WScript.Shell",
        "Start-Process $url",
        "Start-Sleep -Milliseconds 500",
        // The URL launch normally foregrounds its new tab. Never activate generic
        // 'Chrome' here: that previously pulled the JARVIS tab back over the target.
        "$activated=$false",
        "$deadline=(Get-Date).AddMilliseconds(2800)",
        "do {",
        "  $p=Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like ('*'+$siteTitle+'*') } | Select-Object -First 1",
        "  if($null -ne $p){ $activated=$shell.AppActivate($p.Id); if($activated){ break } }",
        "  Start-Sleep -Milliseconds 180",
        "} while((Get-Date) -lt $deadline)",
        fullscreen ? "if($activated){ $shell.SendKeys('{F11}'); Start-Sleep -Milliseconds 250 }" : "",
        "$foreground=(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like ('*'+$siteTitle+'*') } | Select-Object -First 1).MainWindowTitle",
        "[pscustomobject]@{action='open_site';url=$url;hostname=" + psSingleQuoted(hostname) + ";expectedTitle=$siteTitle;fullscreen=$" + (fullscreen ? "true" : "false") + ";activated=$activated;visible=[bool]$activated;foregroundTitle=[string]$foreground} | ConvertTo-Json -Compress",
      ].filter(Boolean).join("\n");
      const opened = parsePowerShellJson(await powershell(script, 8000), "Desktop placement");
      if (!opened.visible) throw errorWithStatus(`Could not place ${hostname} on the visible desktop. The target was opened, but its window/tab was not verified in front.`, 502);
      return opened;
    }

    if (action === "youtube_search_visible") {
      const text = cleanString(args.text || args.query || args.value, 500);
      if (!text) throw errorWithStatus("youtube_search_visible requires text.");
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName UIAutomationClient",
        "Add-Type -AssemblyName UIAutomationTypes",
        "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class DesktopOps {\n[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }\n[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n[DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);\n[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);\n[DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);\n}\n'@",
        "$shell=New-Object -ComObject WScript.Shell",
        "$titles=@('YouTube','Google Chrome','Chrome','Microsoft Edge','Edge')",
        "$activated=$false",
        "foreach($title in $titles){ if($shell.AppActivate($title)){ $activated=$true; break } }",
        "Start-Sleep -Milliseconds 450",
        "$selectedTab=''",
        "$selectedVia=''",
        "$handle=[DesktopOps]::GetForegroundWindow()",
        "$root=[System.Windows.Automation.AutomationElement]::RootElement",
        "if($null -ne $root){",
        "  $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
        "  $ytTab=$null",
        "  foreach($node in $nodes){",
        "    try {",
        "      $name=([string]$node.Current.Name).Trim()",
        "      $type=[string]$node.Current.ControlType.ProgrammaticName",
        "      $rectCheck=$node.Current.BoundingRectangle",
        "      if($type -eq 'ControlType.TabItem' -and $name -match 'YouTube' -and -not $node.Current.IsOffscreen -and $rectCheck.Width -gt 20 -and $rectCheck.Height -gt 10){ $ytTab=$node; break }",
        "    } catch {}",
        "  }",
        "  if($null -ne $ytTab){",
        "    if($ytTab.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsSelectionItemPatternAvailableProperty) -eq $true){",
        "      $ytTab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()",
        "      $selectedVia='selection_pattern'",
        "    } elseif($ytTab.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty) -eq $true){",
        "      $ytTab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()",
        "      $selectedVia='invoke_pattern'",
        "    } else {",
        "      throw 'YouTube tab was visible but had no selectable automation pattern.'",
        "    }",
        "    $selectedTab=([string]$ytTab.Current.Name).Trim()",
        "    Start-Sleep -Milliseconds 650",
        "  }",
        "}",
        "if([string]::IsNullOrWhiteSpace($selectedTab)){",
        "  throw 'No visible YouTube tab was found to search in.'",
        "}",
        "$handle=[DesktopOps]::GetForegroundWindow()",
        "$rect=New-Object DesktopOps+RECT",
        "[DesktopOps]::GetWindowRect($handle,[ref]$rect) | Out-Null",
        "$width=[Math]::Max(1,$rect.Right-$rect.Left)",
        "$height=[Math]::Max(1,$rect.Bottom-$rect.Top)",
        "$x=[int]($rect.Left+($width*0.50))",
        "$y=[int]($rect.Top+[Math]::Min(310,[Math]::Max(245,$height*0.30)))",
        "$searchBox=$null",
        "$root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)",
        "if($null -ne $root){",
        "  $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
        "  foreach($node in $nodes){",
        "    try {",
        "      $name=([string]$node.Current.Name).Trim()",
        "      $help=([string]$node.Current.HelpText).Trim()",
        "      $auto=([string]$node.Current.AutomationId).Trim()",
        "      $type=[string]$node.Current.ControlType.ProgrammaticName",
        "      $candidateRect=$node.Current.BoundingRectangle",
        "      $label=(($name+' '+$help+' '+$auto).Trim())",
        "      if($node.Current.IsOffscreen -or $candidateRect.Width -lt 80 -or $candidateRect.Height -lt 12){ continue }",
        "      if(($type -match 'Edit|Combo') -and $label -match 'Search' -and $label -notmatch 'Google|URL|Address' -and $candidateRect.Y -gt ($rect.Top+170) -and $candidateRect.Y -lt ($rect.Top+380)){ $searchBox=$node; break }",
        "    } catch {}",
        "  }",
        "}",
        "if($null -ne $searchBox){ $boxRect=$searchBox.Current.BoundingRectangle; $x=[int]($boxRect.X+($boxRect.Width/2)); $y=[int]($boxRect.Y+($boxRect.Height/2)) }",
        "[DesktopOps]::SetCursorPos($x,$y) | Out-Null",
        "[DesktopOps]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
        "Start-Sleep -Milliseconds 70",
        "[DesktopOps]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
        "Start-Sleep -Milliseconds 150",
        `$text=${psSingleQuoted(text)}`,
        "Set-Clipboard -Value $text",
        "Start-Sleep -Milliseconds 120",
        "[System.Windows.Forms.SendKeys]::SendWait('^a')",
        "Start-Sleep -Milliseconds 70",
        "[System.Windows.Forms.SendKeys]::SendWait('^v')",
        "Start-Sleep -Milliseconds 100",
        "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
        "[pscustomobject]@{action='youtube_search_visible';activated=$activated;selectedTab=$selectedTab;selectedVia=$selectedVia;text=$text;x=$x;y=$y;usedUiSearchBox=($null -ne $searchBox);window=($width.ToString()+'x'+$height.ToString())} | ConvertTo-Json -Compress",
      ].join("\n");
      return JSON.parse(await powershell(script, 8000));
    }

    if (["fullscreen", "next_tab", "previous_tab", "tab_number", "hotkey", "type_text"].includes(action)) {
      let sequence = "";
      if (action === "fullscreen") sequence = "{F11}";
      if (action === "next_tab") sequence = "^{TAB}";
      if (action === "previous_tab") sequence = "^+{TAB}";
      if (action === "tab_number") {
        const tabNumber = asNumber(args.tabNumber, 1, 1, 9);
        sequence = `^${tabNumber}`;
      }
      if (action === "hotkey") {
        sequence = desktopHotkeySequence(args.hotkey);
        if (!sequence) throw errorWithStatus("Unsupported desktop hotkey.");
      }
      const text = cleanString(args.text, 5000);
      const script = [
        action === "type_text" ? "Add-Type -AssemblyName System.Windows.Forms" : "",
        "$shell=New-Object -ComObject WScript.Shell",
        // Preserve the surface selected by the preceding verified navigation/click.
        // Generic Chrome activation used to jump back to JARVIS or another tab.
        "$activated=$true",
        action === "type_text"
          ? `$text=${psSingleQuoted(text)}; Set-Clipboard -Value $text; Start-Sleep -Milliseconds 140; [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 120`
          : `$shell.SendKeys(${psSingleQuoted(sequence)})`,
        "[pscustomobject]@{action=" + psSingleQuoted(action) + ";activated=$activated;sequence=" + psSingleQuoted(action === "type_text" ? "paste" : sequence) + "} | ConvertTo-Json -Compress",
      ].filter(Boolean).join(";");
      return JSON.parse(await powershell(script, 5000));
    }

    if (action === "click_text") {
      const targetText = cleanString(args.targetText || args.target || args.text, 200);
      if (!targetText) throw errorWithStatus("click_text requires targetText.");
      const script = [
        "Add-Type -AssemblyName UIAutomationClient",
        "Add-Type -AssemblyName UIAutomationTypes",
        "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class MouseOps {\n[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();\n[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);\n[DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);\n}\n'@",
        "[MouseOps]::SetProcessDPIAware() | Out-Null",
        `$needle=${psSingleQuoted(targetText)}.ToLowerInvariant()`,
        "$foreground=[MouseOps]::GetForegroundWindow()",
        "$roots=@()",
        "$fgRoot=[System.Windows.Automation.AutomationElement]::FromHandle($foreground)",
        "if($null -ne $fgRoot){ $roots += $fgRoot }",
        "$match=$null;$matchText='';$matchType='';$matchScore=0",
        "foreach($root in $roots){",
        "  if($null -eq $root -or $null -ne $match){ continue }",
        "  $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
        "  foreach($node in $nodes){",
        "    try {",
        "      $rect=$node.Current.BoundingRectangle",
        "      if($node.Current.IsOffscreen -or $rect.Width -le 3 -or $rect.Height -le 3){ continue }",
        "      if([double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.Y) -or [double]::IsInfinity($rect.Y) -or [double]::IsNaN($rect.Width) -or [double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Height) -or [double]::IsInfinity($rect.Height)){ continue }",
        "      $name=[string]$node.Current.Name",
        "      $help=[string]$node.Current.HelpText",
        "      $automationId=[string]$node.Current.AutomationId",
        "      $text=(($name+' '+$help+' '+$automationId).Trim()).ToLowerInvariant()",
        "      if([string]::IsNullOrWhiteSpace($text)){ continue }",
        "      $maxTextLength=[Math]::Max(180, $needle.Length * 4)",
        "      if($text.Length -gt $maxTextLength){ continue }",
        "      if($rect.Width -gt 900 -and $rect.Height -lt 70 -and $text.Length -gt 120){ continue }",
        "      $score=0",
        "      if($text -eq $needle){ $score=100 }",
        "      elseif($text.Contains($needle)){ $score=80 }",
        "      else {",
        "        $parts=$needle -split '\\s+' | Where-Object { $_.Length -ge 2 }",
        "        $hits=0",
        "        foreach($part in $parts){ if($text.Contains($part)){ $hits++ } }",
        "        if($parts.Count -gt 0 -and $hits -eq $parts.Count){ $score=60+$hits }",
        "      }",
        "      if($score -gt $matchScore){ $match=$node;$matchText=$name;if([string]::IsNullOrWhiteSpace($matchText)){ $matchText=$help };if([string]::IsNullOrWhiteSpace($matchText)){ $matchText=$automationId };$matchType=[string]$node.Current.ControlType.ProgrammaticName;$matchScore=$score }",
        "      if($matchScore -ge 100){ break }",
        "    } catch {}",
        "  }",
        "}",
        "if($null -eq $match -or $matchScore -lt 80){ throw ('No sufficiently reliable visible control text matched '+$needle) }",
        "$rect=$match.Current.BoundingRectangle",
        "$x=[int]($rect.X+($rect.Width/2));$y=[int]($rect.Y+($rect.Height/2))",
        "[MouseOps]::SetCursorPos($x,$y) | Out-Null",
        "[MouseOps]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
        "Start-Sleep -Milliseconds 60",
        "[MouseOps]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
        "[pscustomobject]@{action='click_text';targetText=$needle;matchedName=$matchText;controlType=$matchType;score=$matchScore;x=$x;y=$y;bounds=(@{x=$rect.X;y=$rect.Y;width=$rect.Width;height=$rect.Height})} | ConvertTo-Json -Compress",
      ].join("\n");
      try {
        const clicked = parsePowerShellJson(await powershell(script, 12000), "Desktop text click");
        if (Number(clicked.score || 0) < 80) throw errorWithStatus(`No sufficiently reliable visible control matched "${targetText}". No click was accepted.`, 404);
        return clicked;
      } catch (error) {
        if (/No (sufficiently reliable )?visible control text matched/.test(String(error.message || ""))) {
          throw errorWithStatus(`No visible control text matched "${targetText}".`, 404);
        }
        throw error;
      }
    }

    const x = asNumber(args.x, NaN, 0, 20000);
    const y = asNumber(args.y, NaN, 0, 20000);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw errorWithStatus("Click requires numeric x and y screen coordinates.");
    const script = [
      `$x=${Math.round(x)};$y=${Math.round(y)}`,
      "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class MouseOps {\n[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();\n[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X, int Y);\n[DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);\n}\n'@",
      "[MouseOps]::SetProcessDPIAware() | Out-Null",
      "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class ScreenMetrics {\n[DllImport(\"user32.dll\")] public static extern int GetSystemMetrics(int nIndex);\n}\n'@",
      "$screenWidth=[ScreenMetrics]::GetSystemMetrics(0);$screenHeight=[ScreenMetrics]::GetSystemMetrics(1)",
      "$scaled=$false",
      "if($x -lt 0 -or $x -ge $screenWidth -or $y -lt 0 -or $y -ge $screenHeight){ throw ('Click coordinate outside screen bounds '+$screenWidth+'x'+$screenHeight) }",
      "[MouseOps]::SetCursorPos($x,$y) | Out-Null",
      "[MouseOps]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)",
      "Start-Sleep -Milliseconds 60",
      "[MouseOps]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)",
      "[pscustomobject]@{action='click';x=$x;y=$y;screen=($screenWidth.ToString()+'x'+$screenHeight.ToString());scaled=$scaled} | ConvertTo-Json -Compress",
    ].join(";");
    return parsePowerShellJson(await powershell(script, 5000), "Desktop click");
  }

  async function closeApp(args) {
    const key = cleanString(args.app, 40).toLowerCase();
    const processName = appCatalog[key]?.process;
    if (!processName) throw errorWithStatus("That application cannot be closed by JARVIS.");
    const escaped = processName.replace(/'/g, "''");
    const output = await powershell(`$p=Get-Process -Name '${escaped}' -ErrorAction SilentlyContinue; if($p){$p|Stop-Process -ErrorAction Stop; @{closed=$true;count=@($p).Count}|ConvertTo-Json -Compress}else{@{closed=$false;count=0}|ConvertTo-Json -Compress}`);
    return JSON.parse(output);
  }

  async function networkInventory() {
    const script = [
      "$adapters=Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name,InterfaceDescription,Status,LinkSpeed,MacAddress",
      "$neighbors=Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {$_.State -ne 'Unreachable'} | Select-Object -First 80 InterfaceAlias,IPAddress,LinkLayerAddress,State",
      "$routes=Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {$_.DestinationPrefix -eq '0.0.0.0/0'} | Select-Object InterfaceAlias,NextHop,RouteMetric",
      "@{adapters=$adapters;neighbors=$neighbors;defaultRoutes=$routes}|ConvertTo-Json -Depth 5 -Compress",
    ].join(";");
    return JSON.parse(await powershell(script));
  }

  async function searchFiles(args) {
    const projectPath = ensureInside(workspaceRoot, cleanString(args.projectPath, 1000));
    const query = cleanString(args.query, 120).toLowerCase();
    if (!query) throw errorWithStatus("A filename query is required");
    const limit = asNumber(args.limit, 40, 1, 100);
    const ignored = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
    const results = [];
    const queue = [projectPath];
    while (queue.length && results.length < limit) {
      const current = queue.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const candidate = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(candidate);
        else if (entry.name.toLowerCase().includes(query)) results.push(path.relative(projectPath, candidate));
        if (results.length >= limit) break;
      }
    }
    return { projectPath, query, files: results };
  }

  async function webResearch(args) {
    const settings = getSettings();
    const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw errorWithStatus("Gemini is not configured, so grounded web research is unavailable.", 412);
    const query = cleanString(args.query, 700);
    if (!query) throw errorWithStatus("Web research query is required");
    const context = cleanString(args.context, 4000);
    const model = settings.geminiFastModel || settings.geminiModel || "gemini-3.5-flash"; // Cortex v4 0.2 — registry model, not obsolete 2.5
    const apiBase = String(settings.geminiApiBaseUrl || process.env.JARVIS_GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const now = new Date();
    const response = await fetch(`${apiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "Research this live/current question. Use Google Search grounding. Return a concise answer with dates/times when relevant.",
              `Current timestamp: ${now.toISOString()}. User timezone: America/New_York.`,
              context ? `Local context:\n${context}` : "",
              `Question: ${query}`,
            ].filter(Boolean).join("\n\n"),
          }],
        }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 800 },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw errorWithStatus(data?.error?.message || `Grounded web research failed (${response.status})`, 502);
    }
    const candidate = data.candidates?.[0] || {};
    const answer = (candidate.content?.parts || []).map((part) => part.text).filter(Boolean).join("\n").trim();
    const sources = (candidate.groundingMetadata?.groundingChunks || [])
      .map((chunk) => chunk.web)
      .filter((item) => item?.uri)
      .map((item) => ({ title: item.title || item.uri, url: item.uri }))
      .slice(0, 8);
    return {
      query,
      answer,
      sources,
      fetchedAt: now.toISOString(),
      source: "gemini_google_search",
      plainEnglish: answer || "Grounded web research returned no answer text.",
    };
  }

  async function newsHeadlines(args) {
    const settings = getSettings();
    const apiKey = settings.newsApiKey || process.env.NEWS_API_KEY;
    if (!apiKey) throw errorWithStatus("News API is not configured. Set NEWS_API_KEY or newsApiKey.", 412);
    const limit = asNumber(args.limit, 10, 1, 25);
    const query = cleanString(args.query, 120);
    const category = cleanString(args.category, 30);
    const url = new URL(query ? "https://newsapi.org/v2/everything" : "https://newsapi.org/v2/top-headlines");
    if (query) {
      url.searchParams.set("q", query);
      url.searchParams.set("sortBy", "publishedAt");
    } else {
      url.searchParams.set("country", "us");
      if (category) url.searchParams.set("category", category);
    }
    url.searchParams.set("pageSize", String(limit));
    const data = await fetchJson(url, { headers: { "X-Api-Key": apiKey } });
    return {
      articles: (data.articles || []).map((item) => ({
        title: item.title,
        source: item.source?.name,
        description: item.description,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
    };
  }

  async function weatherForecast(args) {
    const latitude = asNumber(args.latitude, NaN, -90, 90);
    const longitude = asNumber(args.longitude, NaN, -180, 180);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw errorWithStatus("Valid latitude and longitude are required");
    const headers = { "User-Agent": "JARVIS-OS/1.0 devan-local-assistant" };
    const point = await fetchJson(`https://api.weather.gov/points/${latitude},${longitude}`, { headers });
    const forecast = await fetchJson(point.properties.forecast, { headers });
    return {
      location: point.properties.relativeLocation?.properties,
      periods: (forecast.properties?.periods || []).slice(0, 8).map((period) => ({
        name: period.name,
        temperature: period.temperature,
        temperatureUnit: period.temperatureUnit,
        wind: `${period.windSpeed} ${period.windDirection}`,
        shortForecast: period.shortForecast,
        detailedForecast: period.detailedForecast,
      })),
    };
  }

  function memoryItems() {
    const raw = readJson(memoryPath, []);
    if (Array.isArray(raw)) return raw;
    const collected = [];
    for (const [category, values] of Object.entries(raw || {})) {
      for (const value of Array.isArray(values) ? values : []) {
        collected.push(typeof value === "string" ? { id: crypto.randomUUID(), category, text: value } : { category, ...value });
      }
    }
    return collected;
  }

  async function memorySearch(args) {
    const query = cleanString(args.query, 200);
    const limit = asNumber(args.limit, 10, 1, 30);
    const matches = memoryStore
      ? memoryStore.search(query, { limit })
      : memoryItems().filter((item) => stableJson(item).toLowerCase().includes(query.toLowerCase())).slice(0, limit);
    return { query, matches };
  }

  async function memoryAdd(args) {
    const text = cleanString(args.text, 1000);
    if (!text) throw errorWithStatus("Memory text is required");
    const item = memoryStore
      ? memoryStore.add({
          text,
          kind: cleanString(args.kind || "semantic", 40),
          category: cleanString(args.category || "personal", 50),
          source: cleanString(args.source || "conversation", 100),
          confidence: asNumber(args.confidence, 1, 0, 1),
          importance: asNumber(args.importance, 0.5, 0, 1),
          expiresAt: args.expiresAt || null,
        })
      : { id: crypto.randomUUID(), category: cleanString(args.category || "personal", 50), text, createdAt: new Date().toISOString() };
    if (!memoryStore) {
      const items = memoryItems();
      writeJsonAtomic(memoryPath, [item, ...items].slice(0, 500));
    }
    return { saved: true, memory: item };
  }

  async function draftEmail(args) {
    const recipient = cleanString(args.recipient, 320).replace(/[\r\n]/g, "");
    const subject = cleanString(args.subject, 200).replace(/[\r\n]/g, " ");
    return {
      draft: {
        recipient,
        subject,
        body: cleanString(args.body, 10000),
      },
      sent: false,
    };
  }

  async function browserSearch(args) {
    const query = cleanString(args.query, 500);
    if (!query) throw errorWithStatus("Search query is required");
    const target = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await execFileAsync("cmd.exe", ["/c", "start", "", target], { timeout: 5000, windowsHide: true }).catch((error) => {
      if (error.code !== "ETIMEDOUT") throw error;
    });
    return { opened: true, query, url: target };
  }

  async function instagramReply(args) {
    const settings = getSettings();
    const token = settings.instagramAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = settings.instagramAccountId || process.env.INSTAGRAM_ACCOUNT_ID;
    if (!token || !accountId) throw errorWithStatus("Instagram professional messaging is not configured.", 412);
    const result = await fetchJson(`https://graph.instagram.com/v23.0/${encodeURIComponent(accountId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: cleanString(args.recipientId, 200) }, message: { text: cleanString(args.message, 1000) } }),
    });
    return { sent: true, messageId: result.message_id || result.id };
  }

  async function instagramLikeCurrent(args = {}) {
    const expectedHandle = cleanString(args.expectedHandle, 80).replace(/^@/, "");
    const script = [
      "Add-Type -AssemblyName UIAutomationClient",
      "Add-Type -AssemblyName UIAutomationTypes",
      "$root=[System.Windows.Automation.AutomationElement]::FromHandle((Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Instagram*' } | Select-Object -First 1).MainWindowHandle)",
      "if($null -eq $root){ throw 'No visible Instagram window is active.' }",
      "$root.SetFocus()",
      "$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$reelUrl=''",
      "foreach($node in $nodes){",
      "  try {",
      "    if([string]$node.Current.ControlType.ProgrammaticName -eq 'ControlType.Document' -and $node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){",
      "      $value=[string]$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value",
      "      if($value -match 'instagram\\.com/reel/'){ $reelUrl=$value; break }",
      "    }",
      "  } catch {}",
      "}",
      "if([string]::IsNullOrWhiteSpace($reelUrl)){ throw 'The visible Instagram surface is not an open Reel URL.' }",
      "$buttons=@()",
      "foreach($node in $nodes){",
      "  try {",
      "    $name=([string]$node.Current.Name).Trim()",
      "    $type=[string]$node.Current.ControlType.ProgrammaticName",
      "    $rect=$node.Current.BoundingRectangle",
      "    if(($name -eq 'Like' -or $name -eq 'Unlike') -and $type -eq 'ControlType.Button' -and -not $node.Current.IsOffscreen -and $rect.Width -gt 4 -and $rect.Height -gt 4){",
      "      $buttons += [pscustomobject]@{Node=$node;Name=$name;X=[double]$rect.X;Y=[double]$rect.Y;Width=[double]$rect.Width;Height=[double]$rect.Height}",
      "    }",
      "  } catch {}",
      "}",
      "$primary=$buttons | Sort-Object Y | Select-Object -First 1",
      "if($null -eq $primary){ throw 'No exact Like or Unlike control was found on the open Reel.' }",
      "$alreadyLiked=($primary.Name -eq 'Unlike')",
      "$invoked=$false",
      "if(-not $alreadyLiked){",
      "  if($primary.Node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty) -ne $true){ throw 'The primary Reel Like control is not invokable.' }",
      "  $primary.Node.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()",
      "  $invoked=$true",
      "  Start-Sleep -Milliseconds 900",
      "}",
      "$verifyRoot=[System.Windows.Automation.AutomationElement]::FromHandle((Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Instagram*' } | Select-Object -First 1).MainWindowHandle)",
      "$verifyNodes=$verifyRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$unlikeFound=$false",
      "foreach($node in $verifyNodes){",
      "  try {",
      "    $name=([string]$node.Current.Name).Trim();$type=[string]$node.Current.ControlType.ProgrammaticName;$rect=$node.Current.BoundingRectangle",
      "    if($name -eq 'Unlike' -and $type -eq 'ControlType.Button' -and -not $node.Current.IsOffscreen -and $rect.Width -gt 4 -and $rect.Height -gt 4){ $unlikeFound=$true; break }",
      "  } catch {}",
      "}",
      "[pscustomobject]@{ok=$unlikeFound;platform='instagram';reelUrl=$reelUrl;expectedHandle=" + psSingleQuoted(expectedHandle) + ";alreadyLiked=$alreadyLiked;invoked=$invoked;before=$primary.Name;after=$(if($unlikeFound){'Unlike'}else{'unverified'});x=[int]($primary.X+($primary.Width/2));y=[int]($primary.Y+($primary.Height/2))} | ConvertTo-Json -Compress",
    ].join("\n");
    return parsePowerShellJson(await powershell(script, 12000), "Instagram Like verification");
  }

  async function instagramPrepareDm(args = {}) {
    const recipient = cleanString(args.recipient, 120);
    const message = cleanString(args.message, 2000);
    if (!recipient || !message) throw errorWithStatus("Instagram recipient and exact message are required.", 400);
    await desktopControl({ action: "activate_site", target: "https://www.instagram.com/direct/inbox/" });
    const script = [
      "Add-Type -AssemblyName UIAutomationClient",
      "Add-Type -AssemblyName UIAutomationTypes",
      "Add-Type -AssemblyName System.Windows.Forms",
      `$recipient=${psSingleQuoted(recipient)}`,
      `$expected=${psSingleQuoted(message)}`,
      "$needle=$recipient.ToLowerInvariant()",
      "$process=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Instagram*' } | Select-Object -First 1",
      "if($null -eq $process){ throw 'No visible Instagram window is active.' }",
      "$root=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)",
      "if($null -eq $root){ throw 'The Instagram accessibility surface is unavailable.' }",
      "try { $root.SetFocus() } catch {}",
      "$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$candidate=$null;$candidateName='';$candidateScore=-1",
      "foreach($node in $nodes){",
      "  try {",
      "    $name=([string]$node.Current.Name).Trim();$type=[string]$node.Current.ControlType.ProgrammaticName;$rect=$node.Current.BoundingRectangle",
      "    if($type -ne 'ControlType.Button' -or $node.Current.IsOffscreen -or $rect.Width -lt 100 -or $rect.Height -lt 30){ continue }",
      "    $lower=$name.ToLowerInvariant();$escaped=[regex]::Escape($needle)",
      "    $tokenMatch=[regex]::IsMatch($lower,'(^|[^a-z0-9._])'+$escaped+'([^a-z0-9._]|$)')",
      "    $score=if($tokenMatch){100}elseif($lower.Contains($needle)){60}else{-1}",
      "    if($name -like 'user-profile-picture*'){ $score+=20 }",
      "    if($score -gt $candidateScore){ $candidate=$node;$candidateName=$name;$candidateScore=$score }",
      "  } catch {}",
      "}",
      "if($null -eq $candidate -or $candidateScore -lt 60){ throw ('No Instagram Direct thread safely matched '+$recipient+'.') }",
      "$selectedVia='already_selected'",
      "if($candidate.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty) -eq $true){",
      "  $candidate.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()",
      "  $selectedVia='invoke_pattern'",
      "} elseif($candidate.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsTogglePatternAvailableProperty) -eq $true){",
      "  $toggle=$candidate.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)",
      "  if($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On){ $toggle.Toggle();$selectedVia='toggle_pattern' }",
      "} else { throw 'The matched Instagram Direct thread has no safe selection pattern.' }",
      "Start-Sleep -Milliseconds 700",
      "$root=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)",
      "$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$chatUrl='';$resolvedRecipient='';$composer=$null",
      "foreach($node in $nodes){",
      "  try {",
      "    $name=([string]$node.Current.Name).Trim();$type=[string]$node.Current.ControlType.ProgrammaticName;$rect=$node.Current.BoundingRectangle",
      "    if($type -eq 'ControlType.Document' -and $node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){",
      "      $value=[string]$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value",
      "      if($value -match 'instagram\\.com/direct/t/'){ $chatUrl=$value }",
      "    }",
      "    if(-not $resolvedRecipient -and $type -eq 'ControlType.Hyperlink' -and $name -like 'Open the profile page of *' -and $rect.X -gt 900){ $resolvedRecipient=$name.Substring(25).Trim() }",
      "    if($type -eq 'ControlType.Edit' -and ($name -eq 'Message...' -or ($rect.X -gt 900 -and $rect.Y -gt 1200))){ $composer=$node }",
      "  } catch {}",
      "}",
      "if([string]::IsNullOrWhiteSpace($chatUrl)){ throw 'The matched item did not open an Instagram Direct conversation URL.' }",
      "if($null -eq $composer){ throw 'The Instagram message composer was not found.' }",
      "$setVia='focused_paste'",
      "$composer.SetFocus()",
      "Start-Sleep -Milliseconds 120",
      "Set-Clipboard -Value $expected",
      "[System.Windows.Forms.SendKeys]::SendWait('^a')",
      "[System.Windows.Forms.SendKeys]::SendWait('^v')",
      "Start-Sleep -Milliseconds 500",
      "$verifyRoot=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)",
      "$verifyNodes=$verifyRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$draftVerified=$false;$sendAvailable=$false",
      "foreach($node in $verifyNodes){",
      "  try {",
      "    $name=([string]$node.Current.Name).Trim();$type=[string]$node.Current.ControlType.ProgrammaticName",
      "    if($type -eq 'ControlType.Edit' -and $node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){",
      "      $value=([string]$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value).Trim()",
      "      if($value -ceq $expected){ $draftVerified=$true }",
      "    }",
      "    if($name -eq 'Send' -and $type -eq 'ControlType.Button' -and -not $node.Current.IsOffscreen){ $sendAvailable=$true }",
      "  } catch {}",
      "}",
      "if(-not $draftVerified){ throw 'Instagram did not expose the exact prepared draft after writing it.' }",
      "[pscustomobject]@{ok=$true;platform='instagram';requestedRecipient=$recipient;matchedThread=$candidateName;selectedVia=$selectedVia;resolvedRecipient=$resolvedRecipient;conversationUrl=$chatUrl;messageLength=$expected.Length;draftVerified=$draftVerified;sendAvailable=$sendAvailable;setVia=$setVia;submitted=$false} | ConvertTo-Json -Compress",
    ].join("\n");
    return parsePowerShellJson(await powershell(script, 12000), "Instagram draft preparation");
  }

  async function instagramSendCurrent(args = {}) {
    const expectedRecipient = cleanString(args.expectedRecipient, 120);
    const resolvedRecipient = cleanString(args.resolvedRecipient, 200);
    const expectedConversationUrl = cleanString(args.expectedConversationUrl, 1000);
    const message = cleanString(args.message, 2000);
    if (!expectedRecipient || !message) throw errorWithStatus("Instagram recipient and exact message are required.", 400);
    const script = [
      "Add-Type -AssemblyName UIAutomationClient",
      "Add-Type -AssemblyName UIAutomationTypes",
      `$recipient=${psSingleQuoted(expectedRecipient)}`,
      `$recipientProof=${psSingleQuoted(resolvedRecipient || expectedRecipient)}`,
      `$expectedUrl=${psSingleQuoted(expectedConversationUrl)}`,
      `$expected=${psSingleQuoted(message)}`,
      "$process=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Instagram*' } | Select-Object -First 1",
      "if($null -eq $process){ throw 'No visible Instagram window is active.' }",
      "$root=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)",
      "$root.SetFocus()",
      "$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "$chatUrl=''",
      "$recipientSeen=$false",
      "$composer=$null",
      "$sendButton=$null",
      "foreach($node in $nodes){",
      "  try {",
      "    $name=([string]$node.Current.Name).Trim();$type=[string]$node.Current.ControlType.ProgrammaticName",
      "    if($name.IndexOf($recipientProof,[StringComparison]::OrdinalIgnoreCase) -ge 0){ $recipientSeen=$true }",
      "    if($type -eq 'ControlType.Document' -and $node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){",
      "      $value=[string]$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value",
      "      if($value -match 'instagram\\.com/direct/t/'){ $chatUrl=$value }",
      "    }",
      "    if($type -eq 'ControlType.Edit'){",
      "      $value=''",
      "      if($node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){ $value=[string]$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }",
      "      if($value -eq $expected -or $name -eq $expected){ $composer=$node }",
      "    }",
      "    if($name -eq 'Send' -and $type -eq 'ControlType.Button' -and -not $node.Current.IsOffscreen){ $sendButton=$node }",
      "  } catch {}",
      "}",
      "if([string]::IsNullOrWhiteSpace($chatUrl)){ throw 'The visible Instagram surface is not a Direct conversation URL.' }",
      "if($expectedUrl -and $chatUrl -ne $expectedUrl){ throw 'The visible Instagram conversation changed after draft preparation.' }",
      "if(-not $recipientSeen){ throw ('The visible Direct conversation does not prove recipient '+$recipient+'.') }",
      "if($null -eq $composer){ throw 'The Instagram composer does not contain the exact approved text.' }",
      "if($null -eq $sendButton -or $sendButton.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsInvokePatternAvailableProperty) -ne $true){ throw 'No invokable Instagram Send control was found.' }",
      "$sendButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()",
      "$verified=$false;$composerCleared=$false;$bubbleSeen=$false",
      "for($attempt=0;$attempt -lt 6;$attempt++){",
      "  Start-Sleep -Milliseconds 700",
      "  $verifyRoot=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)",
      "  $verifyNodes=$verifyRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)",
      "  $bubbleSeen=$false;$exactDraftStillPresent=$false",
      "  foreach($node in $verifyNodes){",
      "    try {",
      "      $name=([string]$node.Current.Name).Trim();$type=[string]$node.Current.ControlType.ProgrammaticName",
      "      if($type -eq 'ControlType.Edit'){",
      "        $value=''",
      "        if($node.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true){ $value=[string]$node.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }",
      "        if($value -eq $expected -or $name -eq $expected){ $exactDraftStillPresent=$true }",
      "      }",
      "      if($name -eq $expected -and $type -ne 'ControlType.Edit'){ $bubbleSeen=$true }",
      "    } catch {}",
      "  }",
      "  $composerCleared=-not $exactDraftStillPresent",
      "  if($composerCleared -and $bubbleSeen){ $verified=$true;break }",
      "}",
      "[pscustomobject]@{ok=$verified;platform='instagram';chatUrl=$chatUrl;expectedRecipient=$recipient;recipientSeen=$recipientSeen;messageLength=$expected.Length;invoked=$true;composerCleared=$composerCleared;bubbleSeen=$bubbleSeen} | ConvertTo-Json -Compress",
    ].join("\n");
    return parsePowerShellJson(await powershell(script, 18000), "Instagram Send verification");
  }

  // Resolve the user's REAL Desktop — on OneDrive "Known Folder Move" machines the visible
  // Desktop is %OneDrive%\Desktop, NOT ~/Desktop. Prefer OneDrive's when it exists.
  function realDesktopDir() {
    const od = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
    if (od) { const d = path.join(od, "Desktop"); try { if (fs.existsSync(d)) return d; } catch { /* fall through */ } }
    return path.join(os.homedir(), "Desktop");
  }

  function normalizeDocxColor(v) {
    const s = String(v || "").trim().toLowerCase().replace(/^#/, "");
    const named = { blue: "0000FF", red: "FF0000", green: "008000", black: "000000", white: "FFFFFF", yellow: "FFFF00", orange: "FFA500", purple: "800080", pink: "FF69B4", cyan: "00FFFF", gray: "808080", grey: "808080" };
    if (named[s]) return named[s];
    if (/^[0-9a-f]{6}$/.test(s)) return s.toUpperCase();
    if (/^[0-9a-f]{3}$/.test(s)) return s.split("").map((c) => c + c).join("").toUpperCase();
    return "000000";
  }

  const handlers = {
    system_status: systemStatus,
    list_processes: listProcesses,
    open_app: openApp,
    open_url: openUrl,
    screen_inspect: inspectScreen,
    screen_act: screenAct,
    youtube_open_video: youtubeOpenVideo,
    desktop_control: desktopControl,
    close_app: closeApp,
    network_inventory: networkInventory,
    atlas_capture: async (args) => {
      const store = atlas();
      if (!store) throw errorWithStatus("The day-model (ATLAS) is not available in this runtime.", 412);
      const text = cleanString(args.text, 600);
      if (!text) throw errorWithStatus("atlas_capture needs the owner's sentence in `text`.", 400);
      const result = atlasCapture.capture(store, text, { tz: cleanString(args.tz, 60) || ownerTz(), sourceKind: "chat" });
      if (!result.ok) return { ok: false, captured: false, message: "That didn't look like a task, reminder, event, or note — nothing was saved." };
      return { ok: true, captured: true, kind: result.kind, message: result.message, item: result.item };
    },
    search_projects: async (args) => {
      const query = cleanString(args.query, 120).toLowerCase();
      const projects = scanProjects();
      return { projects: query ? projects.filter((item) => stableJson(item).toLowerCase().includes(query)) : projects };
    },
    open_project: async (args) => openProjectFolder(ensureInside(workspaceRoot, cleanString(args.path, 1000))),
    search_files: searchFiles,
    apex_catalog_search: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const query = cleanString(args.query || "", 200);
      const rows = apex.searchCatalog(query) || [];
      return {
        query,
        count: rows.length,
        results: rows.map((r) => ({ name: r.name, kind: r.kind, source: r.source, path: r.path, rows: r.row_count, dateFrom: r.date_from, dateTo: r.date_to, columns: r.columns, summary: r.summary })),
      };
    },
    apex_strategies: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const id = cleanString(args.id || "", 80);
      if (id) {
        const s = apex.getStrategyById(id);
        if (!s) return { found: false, id, message: "No strategy by that id. Call apex_strategies with no id to list them." };
        const sp = s.spec || {};
        return { found: true, id: s.id, name: s.name, description: s.description, tags: s.tags, folder: s.folder, source: s.source, summary: s.summary, metrics: s.metrics, universe: sp.universe, signals: (sp.signals || []).map((b) => ({ id: b.id, type: b.type, params: b.params })), exit: sp.exit, sizing: sp.sizing, risk: sp.risk, updatedAt: s.updatedAt };
      }
      const list = apex.listStrategies() || [];
      return { count: list.length, strategies: list.map((s) => ({ id: s.id, name: s.name, folder: s.folder, tags: s.tags, source: s.source, summary: s.summary, sharpe: s.metrics && s.metrics.sharpe, updatedAt: s.updatedAt })) };
    },
    apex_forge: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const kind = cleanString(args.kind || "overview", 20).toLowerCase();
      if (kind === "variables") { const v = apex.listVariables() || []; return { count: v.length, variables: v.map((x) => ({ id: x.id, name: x.name, expr: x.expr, kind: x.kind, description: x.description, createdBy: x.createdBy })) }; }
      if (kind === "signals") { const s = apex.listSignals() || []; return { count: s.length, signals: s.map((x) => ({ id: x.id, name: x.name, expr: x.expr, description: x.description, fromCode: !!x.codePath, createdBy: x.createdBy })) }; }
      if (kind === "folders" || kind === "strategies") { const f = apex.listFolders() || []; return { count: f.length, folders: f.map((x) => ({ id: x.id, name: x.name, kind: x.kind, description: x.description, fromCode: !!x.codePath, updatedAt: x.updatedAt })) }; }
      // overview: everything the user has forged
      const folders = apex.listFolders() || [], bots = apex.listStrategies() || [], vars = apex.listVariables() || [], sigs = apex.listSignals() || [];
      return { overview: true, folders: folders.length, bots: bots.length, variables: vars.length, signals: sigs.length,
        recentFolders: folders.slice(0, 6).map((f) => f.name), recentBots: bots.slice(0, 6).map((b) => b.name),
        recentSignals: sigs.slice(0, 6).map((s) => s.name), recentVariables: vars.slice(0, 6).map((v) => v.name) };
    },
    apex_report: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const id = cleanString(args.id || "", 80);
      const name = cleanString(args.name || "", 120);
      let targetId = id;
      if (!targetId && name) { // resolve a strategy/folder name → id
        const hit = (apex.listStrategies() || []).find((s) => s.name.toLowerCase() === name.toLowerCase())
          || (apex.listFolders() || []).find((f) => f.name.toLowerCase() === name.toLowerCase());
        if (hit) targetId = hit.id;
      }
      if (!targetId) { const reps = apex.listReports(20) || []; return { needTarget: true, message: "Name or id required. Reports exist for:", reports: reps.map((r) => ({ targetId: r.targetId, name: r.name, createdAt: r.createdAt })) }; }
      const rep = apex.latestReport(targetId);
      if (!rep) return { found: false, targetId, message: "No deep-analysis report yet for that strategy. Run Actions → Deep Analysis in THE FORGE first." };
      return { found: true, name: rep.name, targetId: rep.targetId, metrics: rep.metrics, narrative: rep.report && rep.report.narrative, engineVersion: rep.engineVersion, createdAt: rep.createdAt };
    },
    apex_data_summary: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const name = cleanString(args.name, 200);
      const r = apex.dataSummary(name);
      if (!r) return { found: false, name, message: "No catalog entry by that name. Use apex_catalog_search to list what exists." };
      return { found: true, name: r.name, kind: r.kind, source: r.source, path: r.path, rows: r.row_count, dateFrom: r.date_from, dateTo: r.date_to, columns: r.columns, summary: r.summary, updatedAt: r.updated_at };
    },
    apex_news: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const ticker = cleanString(args.ticker || "", 12).toUpperCase();
      const limit = asNumber(args.limit, 10, 1, 30);
      if (ticker) {
        const impact = apex.getNewsImpact(ticker, limit) || [];
        return { ticker, count: impact.length, impact: impact.map((i) => ({ title: i.title, dir: i.sentiment_dir > 0 ? "bullish" : "bearish", magnitude: i.impact, sector: i.sector, storyRank: i.rank })) };
      }
      const stories = apex.getNews(limit) || [];
      return {
        count: stories.length,
        stories: stories.map((s) => ({ title: s.title, rank: s.rank, verified: s.verify_score, corroboration: s.article_count, lane: s.impact && s.impact.lane, impact: (s.impact && s.impact.tickers) || [] })),
      };
    },
    apex_market_snapshot: async () => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const ov = apex.getOverview() || { indices: [] }; const r = apex.getRegime(); const m = apex.getMovers(); const cg = apex.getCryptoGlobal(); const macro = apex.getMacro() || []; const news = apex.getNews(6) || [];
      const mv = (arr) => (arr || []).map((x) => ({ t: x.ticker, pct: x.changePct != null ? +x.changePct.toFixed(2) : null }));
      return {
        regime: r ? { score: r.score, label: r.label, fearGreed: r.fearGreedLabel, vix: r.vix, marketMomentumPct: r.momentum != null ? +r.momentum.toFixed(2) : null, breadthPctUp: r.pctUp != null ? Math.round(r.pctUp * 100) : null } : null,
        indices: (ov.indices || []).map((i) => ({ t: i.ticker, last: i.last, changePct: i.changePct != null ? +i.changePct.toFixed(2) : null })),
        crypto: cg ? { totalMcapTrillions: +(cg.totalMcap / 1e12).toFixed(2), btcDominance: +cg.btcDom.toFixed(1), change24hPct: +cg.mcapChangePct.toFixed(2) } : null,
        stocks: { gainers: mv(m.stocks.gainers), losers: mv(m.stocks.losers) },
        cryptoMovers: { gainers: mv(m.crypto.gainers), losers: mv(m.crypto.losers) },
        macro: macro.map((x) => ({ series: x.label, value: x.value, unit: x.unit })),
        topNews: news.map((s) => ({ title: s.title, lane: s.impact && s.impact.lane, tickers: ((s.impact && s.impact.tickers) || []).map((t) => t.t || t.s).filter(Boolean) })),
      };
    },
    apex_ticker_report: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const sym = cleanString(args.ticker, 12).toUpperCase();
      const isCrypto = /USDT?$/.test(sym) || sym === "BTC" || sym === "ETH";
      const quote = apex.getQuote(sym) || null;
      const fundamentals = isCrypto ? null : await apex.getFundamentals(sym);
      const newsImpact = (apex.getNewsImpact(sym, 6) || []).map((i) => ({ title: i.title, dir: i.sentiment_dir > 0 ? "bullish" : "bearish", sector: i.sector }));
      const insider = (apex.getInsider(sym) || []).slice(0, 8).map((t) => ({ name: t.name, side: t.side, shares: t.change, price: t.price, date: t.date }));
      return { ticker: sym, isCrypto, quote, fundamentals, newsImpact, insider };
    },
    apex_brief: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const type = cleanString(args.type || "now", 16);
      return apex.getBrief(type);
    },
    apex_health_check: async () => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const r = await apex.runHealthCheck();
      return { ok: r.ok, down: r.down, disabled: r.disabled, skipped: r.skipped, analysis: r.analysis, report: r.report, proposedFixes: r.fixes };
    },
    apex_health_apply: async (args) => {
      const apex = getApex();
      if (!apex) throw errorWithStatus("APEX data engine is not available in this runtime.", 412);
      const ids = Array.isArray(args.ids) ? args.ids.map((x) => cleanString(x, 40)) : null;
      const proposed = apex.getHealthFixes() || [];
      if (!proposed.length) return { applied: [], message: "No fixes are pending. Run apex_health_check first." };
      return apex.applyHealthFixes(ids);
    },
    kalshi_markets: async (args) => providers.kalshi.markets(cleanString(args.query, 700)),
    kalshi_market_discovery: async (args) => providers.kalshi.marketDiscovery({
      query: cleanString(args.query, 700),
      limit: asNumber(args.limit, 12, 1, 50),
      maxPages: asNumber(args.maxPages, 8, 1, 10),
    }),
    kalshi_balance: async () => providers.kalshi.balance(),
    kalshi_positions: async (args) => providers.kalshi.positions(args),
    kalshi_fills: async (args) => {
      const result = await providers.kalshi.fills(args);
      return {
        latestFill: result.latestFill,
        fillCount: result.fillCount,
        fills: result.fills,
        plainEnglish: result.plainEnglish,
        cursor: result.cursor,
      };
    },
    kalshi_portfolio: async () => providers.kalshi.portfolioSummary(),
    canvas_courses: async () => providers.canvas.courses(),
    canvas_assignments: async (args) => providers.canvas.assignments(args),
    canvas_browser_assignments: async (args) => {
      const settings = getSettings();
      const base = cleanString(args.url || settings.canvasBaseUrl || "https://northeastern.instructure.com", 500).replace(/\/+$/, "");
      const target = `${base}/calendar`;
      const navigation = await browser.navigate({ url: target });
      const snapshot = await browser.snapshot({});
      return {
        opened: true,
        url: navigation.url,
        title: snapshot.title,
        loginLikelyRequired: /log in|login|sign in|sso|password|username/i.test(`${snapshot.title} ${snapshot.pageText || ""}`),
        elements: snapshot.elements,
        securitySignals: snapshot.securitySignals || [],
      };
    },
    web_research: webResearch,
    research_v2: async (args, context = {}) => {
      if (!researchV2) researchV2 = createResearchV2({ getSettings, webResearch, urlRead: cortex.urlRead });
      return researchV2.run({
      query: cleanString(args.query, 1200),
      intent: cleanString(args.intent, 80),
      mode: cleanString(args.mode, 20),
      ...(args.maxSearches == null ? {} : { maxSearches: asNumber(args.maxSearches, 5, 1, 10) }),
      ...(args.readTopSources == null ? {} : { readTopSources: asNumber(args.readTopSources, 3, 0, 6) }),
      // Cortex v4 P1.2 — pass the live progress emitter through to the engine.
      ...(typeof context.onProgress === "function" ? { onProgress: context.onProgress } : {}),
    });
    },
    web_research_deep: async (args) => cortex.deepResearch({
      query: cleanString(args.query, 1200),
      context: cleanString(args.context, 4000),
      readTopSources: asNumber(args.readTopSources, 2, 0, 5),
    }),
    url_read: async (args) => cortex.urlRead({
      url: cleanString(args.url, 2000),
      maxChars: asNumber(args.maxChars, 18000, 500, 60000),
    }),
    ui_open_widget: async (args) => ({ uiAction: { type: "open-widget", id: cleanString(args.id, 60), focus: false } }),
    ui_focus_widget: async (args) => ({ uiAction: { type: "open-widget", id: cleanString(args.id, 60), focus: true } }),
    ui_close_widget: async (args) => ({ uiAction: { type: "close-widget", id: cleanString(args.id, 60) } }),
    ui_populate: async (args) => ({ uiAction: {
      type: "populate-widget", id: cleanString(args.id, 60), state: cleanString(args.state || "live", 20),
      data: args.data && typeof args.data === "object" ? args.data : {},
    } }),
    ui_render_card: async (args) => ({ card: {
      kind: cleanString(args.kind || "info", 30), title: cleanString(args.title, 160),
      body: cleanString(args.body, 4000), value: cleanString(args.value, 200), status: cleanString(args.status, 30),
      items: Array.isArray(args.items) ? args.items.map((item) => cleanString(item, 500)).filter(Boolean).slice(0, 12) : [],
    } }),
    compose_artifact: async (args) => composer.compose(args),
    artifact_status: async (args) => composer.status(args),
    pc_graph_rebuild: async (args) => pcGraph.rebuild({
      roots: Array.isArray(args.roots) ? args.roots.map((root) => cleanString(root, 1200)).filter(Boolean) : undefined,
      limit: asNumber(args.limit, 1200, 1, 50000),
    }),
    pc_graph_search: async (args) => pcGraph.search({
      query: cleanString(args.query, 500),
      limit: asNumber(args.limit, 12, 1, 50),
    }),
    pc_graph_timeline: async (args) => pcGraph.timeline({
      hours: asNumber(args.hours, 24, 1, 720),
      limit: asNumber(args.limit, 30, 1, 100),
    }),
    pc_graph_explain: async (args) => pcGraph.explain({
      target: cleanString(args.target || args.query, 500),
    }),
    pc_graph_inspect: async () => pcGraph.inspect(),
    agent_deploy: async (args) => skillAutopilot.deployAgent({
      agent: cleanString(args.agent || args.role || "coordinator", 50),
      title: cleanString(args.title, 180),
      objective: cleanString(args.objective || args.prompt, 4000),
      autonomyLevel: cleanString(args.autonomyLevel || "act", 40),
    }),
    skill_compile: async (args) => skillAutopilot.compile({
      name: cleanString(args.name, 160),
      trigger: cleanString(args.trigger, 200),
      objective: cleanString(args.objective || args.prompt, 4000),
      steps: Array.isArray(args.steps) ? args.steps : undefined,
    }),
    skill_run: async (args) => skillAutopilot.run({
      id: cleanString(args.id, 200),
      name: cleanString(args.name, 200),
      trigger: cleanString(args.trigger, 200),
      input: cleanString(args.input, 4000),
      objective: cleanString(args.objective, 4000),
      autonomyLevel: cleanString(args.autonomyLevel || "act", 40),
    }),
    skill_list: async (args) => skillAutopilot.list({ limit: asNumber(args.limit, 30, 1, 100) }),
    skill_inspect: async () => skillAutopilot.inspect(),
    news_headlines: newsHeadlines,
    weather_forecast: weatherForecast,
    memory_search: memorySearch,
    memory_add: memoryAdd,
    life_graph: async (args) => memoryStore.lifeGraph({ limit: asNumber(args.limit, 120, 1, 200) }),
    neural_vault_status: async () => requireNeuralVault().status(),
    neural_vault_context: async (args) => requireNeuralVault().getContextPack(
      cleanString(args.query || args.message, 1200),
      { limit: asNumber(args.limit, 8, 1, 20) },
    ),
    neural_vault_resolve: async (args) => requireNeuralVault().resolveReferences(cleanString(args.message || args.query, 1200)),
    neural_vault_actions: async (args) => {
      const vault = requireNeuralVault();
      const query = cleanString(args.query, 1000);
      return {
        query,
        matches: query ? vault.matchActionMacros(query) : [],
        macros: vault.listActionMacros(),
      };
    },
    neural_vault_integrations: async (args) => {
      const vault = requireNeuralVault();
      return {
        apiKeyMetadata: vault.listApiKeyMetadata(),
        health: vault.listIntegrationHealth({ limit: asNumber(args.limit, 40, 1, 100) }),
        capabilities: vault.listCapabilityMemory({ limit: 100 }),
      };
    },
    neural_vault_api_key_metadata: async (args) => ({
      metadata: requireNeuralVault().rememberApiKeyMetadata({
        provider: cleanString(args.provider, 80),
        keyLabel: cleanString(args.keyLabel || args.label, 160),
        envVarName: cleanString(args.envVarName, 160),
        status: cleanString(args.status || "unknown", 40),
        requiredForTools: Array.isArray(args.requiredForTools) ? args.requiredForTools.map((item) => cleanString(item, 120)).filter(Boolean) : [],
        notes: cleanString(args.notes, 1000),
      }),
    }),
    neural_vault_maintenance: async () => requireNeuralVault().maintenanceRun(),
    memory_os_v4_status: async () => requireNeuralVault().memoryOsStatus(),
    memory_os_v4_query: async (args) => requireNeuralVault().queryMemoryOs(
      cleanString(args.query || args.q, 1200),
      { limit: asNumber(args.limit, 10, 1, 50) },
    ),
    memory_os_v4_scan_files: async (args) => requireNeuralVault().scanMemoryFiles({ limit: asNumber(args.limit, 220, 1, 2500) }),
    memory_os_v4_run_agent: async (args) => requireNeuralVault().runMemoryAgent(cleanString(args.agentId || args.agent || "memory-manager-agent", 120), {
      task: cleanString(args.task, 1000),
      limit: asNumber(args.limit, 180, 1, 2500),
    }),
    device_files: async (args) => ({
      files: (deviceFiles ? deviceFiles() : []).slice(0, asNumber(args.limit, 30, 1, 80)),
    }),
    device_latest_image: async () => {
      const image = latestDeviceImage ? latestDeviceImage() : { found: false };
      if (!image?.found) throw errorWithStatus(image?.message || "No uploaded device image was found.", 404);
      return image;
    },
    mesh_status: async () => {
      if (!meshStatus) throw errorWithStatus("Device mesh status is not available in this runtime.", 412);
      return meshStatus();
    },
    mesh_objects: async (args) => {
      if (!meshObjects) throw errorWithStatus("Device mesh object portal is not available in this runtime.", 412);
      const objects = meshObjects();
      const id = cleanString(args.id, 200);
      if (id) {
        const object = objects.find((item) => item.id === id);
        if (!object) throw errorWithStatus("Mesh object not found.", 404);
        return { object };
      }
      const type = cleanString(args.type, 40).toLowerCase();
      return {
        objects: objects
          .filter((item) => !type || String(item.type || "").toLowerCase() === type)
          .slice(0, asNumber(args.limit, 30, 1, 100)),
      };
    },
    mesh_pair_link: async (args) => {
      if (!meshCreatePair) throw errorWithStatus("Device mesh pairing is not available in this runtime.", 412);
      return meshCreatePair({ target: cleanString(args.target || "phone", 80) });
    },
    mesh_self_test: async () => {
      if (!meshSelfTest) throw errorWithStatus("Device mesh self-test is not available in this runtime.", 412);
      return meshSelfTest();
    },
    mesh_send_command: async (args, context) => {
      if (!meshCreateCommand) throw errorWithStatus("Device mesh command routing is not available in this runtime.", 412);
      return meshCreateCommand({
        targetDeviceId: cleanString(args.targetDeviceId || "any", 100),
        type: cleanString(args.type || "ask_jarvis", 80),
        title: cleanString(args.title, 160),
        body: cleanString(args.body || args.message, 2000),
        payload: args.payload && typeof args.payload === "object" ? args.payload : {},
        priority: cleanString(args.priority || "normal", 30),
        sourceDeviceId: context.deviceId || "jarvis",
      });
    },
    coop_symbiote_status: async () => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return coopSymbioteMesh.status();
    },
    coop_symbiote_create_session: async (args) => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return { session: coopSymbioteMesh.createSession({
        title: cleanString(args.title || "Jarvis Co-Op Symbiote Mesh", 120),
        mode: cleanString(args.mode || "Code Review Mode", 80),
        peerName: cleanString(args.peerName || "", 80),
      }) };
    },
    coop_symbiote_manifest: async (args) => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return { files: coopSymbioteMesh.fileManifest({ limit: asNumber(args.limit, 80, 1, 240) }) };
    },
    coop_symbiote_chat: async (args) => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return coopSymbioteMesh.addChat(cleanString(args.sessionId, 120), {
        text: cleanString(args.text, 2000),
        senderName: cleanString(args.senderName || "Devansh", 80),
      });
    },
    coop_symbiote_patch: async (args) => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return coopSymbioteMesh.proposePatch(cleanString(args.sessionId, 120), {
        filePath: cleanString(args.filePath, 240),
        originalText: String(args.originalText || ""),
        replacementText: String(args.replacementText || ""),
        summary: cleanString(args.summary || "", 240),
        author: "Jarvis",
      });
    },
    coop_symbiote_ghost_test: async (args) => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return coopSymbioteMesh.ghostTest(cleanString(args.sessionId, 120), cleanString(args.patchId, 120));
    },
    coop_symbiote_debate: async (args) => {
      if (!coopSymbioteMesh) throw errorWithStatus("Co-Op Symbiote Mesh is not available in this runtime.", 412);
      return coopSymbioteMesh.debate(cleanString(args.sessionId, 120), { topic: cleanString(args.topic, 500) });
    },
    coop_symbiote_memory: async (args) => requireNeuralVault().coopMemorySummary(cleanString(args.sessionId, 120)),
    codebase_search: async (args) => ({
      query: cleanString(args.query, 500),
      matches: await codeKnowledge.search(cleanString(args.query, 500), { limit: asNumber(args.limit, 8, 1, 20) }),
    }),
    jarvis_self_inspect: async () => ({
      codebase: codeKnowledge.inspect(),
      capabilities: definitions,
      applications: Object.keys(appCatalog),
      mesh: meshStatus ? meshStatus() : null,
      neuralVault: neuralVault ? neuralVault.status() : null,
    }),
    draft_email: draftEmail,
    gmail_prepare_email: async (args) => {
      const draft = await providers.google.createDraft((await draftEmail(args)).draft);
      const verified = await providers.google.getDraft(draft.draftId);
      const verifiedBodyHash = crypto.createHash("sha256").update(cleanString(verified.rawBody, 10000)).digest("hex");
      if (verified.recipient.toLowerCase() !== draft.recipient.toLowerCase() || verified.subject !== draft.subject || verifiedBodyHash !== draft.bodyHash) {
        await providers.google.deleteDraft(draft.draftId).catch(() => undefined);
        throw errorWithStatus("Gmail draft read-after-write verification failed; the draft was not sent", 502);
      }
      return { ...draft, verified: true, verification: "provider-read-after-write" };
    },
    gmail_send_prepared: async (args) => providers.google.sendDraft({
      draftId: cleanString(args.draftId, 200),
      expectedRecipient: cleanString(args.expectedRecipient, 320),
      expectedSubject: cleanString(args.expectedSubject, 200),
      expectedBodyHash: cleanString(args.expectedBodyHash, 128),
    }),
    send_email: async (args) => providers.google.sendEmail((await draftEmail(args)).draft),
    // Contact-aware one-step send: resolve a name -> saved email and send with no extra approval;
    // if nothing is on file, don't send — say so; if a new address is given, send then offer to save.
    email_smart: async (args) => {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const rawTo = cleanString(args.recipient || args.to || args.name, 320);
      const body = cleanString(args.body, 10000);
      const subject = cleanString(args.subject, 200) || "(no subject)";
      if (!rawTo) throw errorWithStatus("Who should this go to?", 400);
      if (!body) throw errorWithStatus("The email needs something in the body.", 400);
      let email = "", contact = null, name = "";
      if (EMAIL_RE.test(rawTo)) {
        email = rawTo;
        name = cleanString(args.saveAs || args.contactName || "", 120);
      } else {
        name = rawTo;
        contact = contacts.find(rawTo, { channel: "email" });
        if (contact) email = contact.channels.email.address;
        else if (args.email && EMAIL_RE.test(cleanString(args.email, 320))) email = cleanString(args.email, 320);
      }
      if (!email) {
        return { ok: false, sent: false, status: "recipient_unknown", name, message: `I don't have an email on file for ${name || "that person"}. What's the address? Tell me once and I'll remember it.` };
      }
      const result = await providers.google.sendEmail({ recipient: email, subject, body });
      if (contact) { try { contacts.touch(contact.id); } catch { /* touch is best-effort */ } }
      const out = { ok: true, sent: true, to: email, subject, contact: contact ? contact.name : null, providerMessageId: result.providerMessageId, message: `Sent to ${contact ? contact.name : email}.` };
      if (!contact) {
        out.saveSuggestion = { name: name || null, email };
        out.message = name
          ? `Sent to ${email}. Want me to save ${email} as ${name}'s email so I remember next time?`
          : `Sent to ${email}. Want me to save this address to a contact?`;
      }
      return out;
    },
    contact_add_email: async (args) => {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      const name = cleanString(args.name, 120);
      const email = cleanString(args.email, 320);
      if (!name) throw errorWithStatus("Whose email is this? Give me a name to save it under.", 400);
      if (!EMAIL_RE.test(email)) throw errorWithStatus(`"${email}" doesn't look like an email address.`, 400);
      const existing = contacts.find(name, {});
      const saved = existing
        ? contacts.save({ id: existing.id, name: existing.name, channels: { email: { address: email } } })
        : contacts.save({ name, channels: { email: { address: email } } });
      return { ok: true, saved: true, name: saved.name, email, message: `Saved — ${saved.name}: ${email}. I'll use it next time.` };
    },
    browser_search: browserSearch,
    browser_status: (args, context) => browserForContext(context).status(args),
    browser_login_handoff: (args, context) => browserForContext(context).loginHandoff(args),
    browser_login_complete: (args, context) => browserForContext(context).completeLoginHandoff(args),
    browser_page_brief: (args, context) => browserForContext(context).pageBrief(args),
    browser_navigate: (args, context) => browserForContext(context).navigate(args),
    browser_snapshot: (args, context) => browserForContext(context).snapshot(args),
    browser_tabs: (args, context) => browserForContext(context).tabs(args),
    browser_act: (args, context) => browserForContext(context).act(args),
    browser_commit: (args, context) => browserForContext(context).commit(args),
    browser_file_search: (args, context) => browserForContext(context).findFiles(args),
    browser_inspect: (args, context) => browserForContext(context).inspect(args),
    browser_click: (args, context) => browserForContext(context).click(args),
    browser_type: (args, context) => browserForContext(context).type(args),
    browser_extract: (args, context) => browserForContext(context).extract(args),
    browser_screenshot: (args, context) => browserForContext(context).screenshot(args),
    browser_wait: (args, context) => browserForContext(context).wait(args),
    browser_verify: (args, context) => browserForContext(context).verify(args),
    screen_capture: async (args) => {
      if (!screenCapture) throw errorWithStatus("Screen capture is not available in this runtime", 412);
      return screenCapture({ reason: cleanString(args.reason, 240) });
    },
    instagram_reply: instagramReply,
    instagram_like_current: instagramLikeCurrent,
    instagram_prepare_dm: instagramPrepareDm,
    instagram_send_current: instagramSendCurrent,
    instagram_read_inbox: (args) => browserForContext().instagram({ action: "inbox", limit: asNumber(args?.limit, 30, 1, 60) }),
    instagram_read_conversation: (args = {}) => {
      const name = cleanString(args.name, 120);
      // If we already know this person's Instagram thread, hand the URL over so the read navigates
      // straight to it — no inbox row to click, nothing to intercept, and no wrong-thread risk.
      let threadUrl = "";
      const match = name ? contacts.find(name, { channel: "instagram" }) : null;
      const igAccount = match?.channels?.instagram;
      if (igAccount && contacts.isConversationUrl?.(igAccount.threadUrl || "", "instagram")) threadUrl = igAccount.threadUrl;
      return browserForContext().instagram({ action: "conversation", name, threadUrl, messages: asNumber(args.messages, 30, 5, 60) });
    },
    instagram_read_notifications: () => browserForContext().instagram({ action: "notifications" }),
    instagram_read_people: (args = {}) => {
      const which = /follower/i.test(String(args.which || "")) ? "followers" : "following";
      return browserForContext().instagram({ action: which, handle: cleanString(args.handle, 120), cap: asNumber(args.cap, 200, 1, 2000) });
    },
    list_windows: async (args) => { if (!windowsBroker) throw errorWithStatus("Windows broker is not available", 412); return windowsBroker.call("list_windows", args); },
    inspect_window: async (args) => { if (!windowsBroker) throw errorWithStatus("Windows broker is not available", 412); return windowsBroker.call("inspect_window", args); },
    focus_window: async (args) => { if (!windowsBroker) throw errorWithStatus("Windows broker is not available", 412); return windowsBroker.call("focus_window", args); },
    invoke_control: async (args) => { if (!windowsBroker) throw errorWithStatus("Windows broker is not available", 412); return windowsBroker.call("invoke_control", args); },
    set_control_value: async (args) => { if (!windowsBroker) throw errorWithStatus("Windows broker is not available", 412); return windowsBroker.call("set_control_value", args); },
    run_command: async (args) => {
      const cmd = cleanString(args.command, 4000);
      if (!cmd) throw errorWithStatus("command is required");
      // A RESOURCE-EXHAUSTION HEURISTIC, not a security boundary. Everything here is trivially
      // expressible another way — `%{}` for a loop, `&('i'+'ex')` or `[scriptblock]::Create()`
      // for Invoke-Expression, `cmd /c start` for Start-Process — and the command runs with
      // -ExecutionPolicy Bypass. Treating this list as containment would be a mistake; the gate
      // that actually holds is the owner confirmation, which `run_command` now requires at EVERY
      // autonomy level (see autonomy-policy.js). The list is widened anyway so the obvious
      // runaway forms are caught before they burn the machine.
      const BLOCKED_PS = [
        // loops, including the pipeline forms the original list missed entirely
        /\bwhile\s*\(/i, /\bfor\s*\(/i, /\bforeach\s*\(/i, /\bdo\s*\{/i,
        /\bForEach-Object\b/i, /\|\s*%\s*[{(]/, /\b\d+\s*\.\.\s*\d{4,}/,
        /\bWhile\s*\(\s*\$true\s*\)/i,
        // dynamic evaluation
        /\bInvoke-Expression\b|\biex\b/i, /\[scriptblock\]::Create/i, /\bInvoke-Command\b/i,
        // process launch
        /\bStart-Process\b|\bNew-Object\s+System\.Diagnostics\.Process\b/i,
        /\[Diagnostics\.Process\]::Start/i, /\bcmd(\.exe)?\s+\/c\b/i,
        /\bInvoke-Item\b/i,
        // background jobs that outlive the timeout
        /\bStart-Job\b|\bSuspend-Job\b|\bRemove-Job\b/i, /\bRegister-ScheduledTask\b|\bschtasks\b/i,
        // defence tampering
        /\bSet-MpPreference\b|\bDisable-WindowsOptionalFeature\b/i, /\bAdd-MpPreference\b/i,
      ];
      const blocked = BLOCKED_PS.find((re) => re.test(cmd));
      if (blocked) throw errorWithStatus("Command contains a disallowed PowerShell construct", 403);
      const timeoutMs = asNumber(args.timeout_ms, 15000, 1000, 30000);
      try {
        const { stdout, stderr } = await execFileAsync(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
          { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_OUTPUT },
        );
        return { ok: true, stdout: stdout.trim().slice(0, 50000), stderr: (stderr || "").trim().slice(0, 5000), exitCode: 0 };
      } catch (err) {
        // `execute()`'s explicitlyFailed branch reads only `error`/`result`, neither of which was
        // set here — so every non-zero exit became the content-free
        // "run_command completed without verifying the requested outcome" and the real stderr was
        // discarded before anything could see it. Plenty of ordinary tools exit 1 with a useful
        // message; that message is the whole point of running the command.
        const stderr = (err.stderr || "").trim();
        const stdout = (err.stdout || "").trim();
        const timedOut = Boolean(err.killed);
        const reason = timedOut
          ? "the command timed out"
          : (stderr.split("\n").filter(Boolean).pop() || stdout.split("\n").filter(Boolean).pop() || err.message || "no output");
        return {
          ok: false,
          error: `Command exited ${err.code ?? 1}: ${String(reason).slice(0, 400)}`,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 5000),
          exitCode: err.code ?? 1,
          timedOut,
        };
      }
    },
    write_file: async (args) => {
      const raw = cleanString(args.path, 1000);
      if (!raw) throw errorWithStatus("path is required");
      // Bare filename → Desktop; ~ → home; absolute honored. (So "absdefgh.docx" lands on the Desktop.)
      const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
      const filePath = path.isAbsolute(expanded) ? path.resolve(expanded) : path.join(realDesktopDir(), expanded);
      assertWritableTarget(filePath, runtimeDir); // write: system, persistence and Jarvis-state paths
      const content = String(args.content ?? "");
      const ext = path.extname(filePath).toLowerCase();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      if (ext === ".docx") {
        // Generate a REAL Word document with the requested formatting (docx lib).
        const { Document, Packer, Paragraph, TextRun } = require("docx");
        const fontPt = Math.max(1, Math.min(400, Number(args.docxFontPt) || 24));
        const color = normalizeDocxColor(args.docxColor);
        const bold = args.docxBold != null ? Boolean(args.docxBold) : fontPt >= 40;
        const paragraphs = (content || " ").split(/\r?\n/).map((line) =>
          new Paragraph({ children: [new TextRun({ text: line, size: Math.round(fontPt * 2), color, bold })] }));
        const doc = new Document({ sections: [{ children: paragraphs }] });
        fs.writeFileSync(filePath, await Packer.toBuffer(doc));
        // HONEST verification: the file must exist AND be a valid .docx (a ZIP starting with "PK").
        const exists = fs.existsSync(filePath);
        const head = exists ? fs.readFileSync(filePath).subarray(0, 2).toString("latin1") : "";
        if (!exists || head !== "PK") throw errorWithStatus("docx was not written correctly (failed on-disk verification)", 500);
        return { ok: true, path: filePath, bytesWritten: fs.statSync(filePath).size, kind: "docx", verified: true, fontPt, color, text: content.slice(0, 200) };
      }

      const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap
      if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
        throw errorWithStatus(`File content exceeds 50 MB limit`, 413);
      }
      fs.writeFileSync(filePath, content, "utf8");
      const bytesWritten = Buffer.byteLength(content, "utf8");
      const verified = fs.existsSync(filePath) && fs.statSync(filePath).size === bytesWritten;
      if (!verified) throw errorWithStatus("file was not written correctly (failed on-disk verification)", 500);
      return { ok: true, path: filePath, bytesWritten, kind: ext.replace(/^\./, "") || "txt", verified: true };
    },
    delete_file: async (args) => {
      const filePath = cleanString(args.path, 1000);
      if (!filePath) throw errorWithStatus("path is required");
      assertWritableTarget(filePath, runtimeDir); // delete: system, persistence and Jarvis-state paths
      const stat = fs.statSync(filePath, { throwIfNoEntry: false });
      if (!stat) throw errorWithStatus(`File not found: ${filePath}`, 404);
      if (stat.isDirectory()) {
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
      return { ok: true, deleted: filePath, wasDirectory: stat.isDirectory() };
    },
    read_clipboard: async () => {
      const text = await powershell("Get-Clipboard -Raw", 5000);
      return { ok: true, text: text.slice(0, 10000), length: text.length };
    },
    write_clipboard: async (args) => {
      const text = String(args.text || "").slice(0, 50000);
      const tmp = path.join(os.tmpdir(), `jarvis-clip-${crypto.randomBytes(6).toString("hex")}.txt`);
      fs.writeFileSync(tmp, text, "utf8");
      try {
        await powershell(`Get-Content -Path '${tmp.replace(/'/g, "''")}' -Raw | Set-Clipboard`, 5000);
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
      return { ok: true, length: text.length };
    },
    toast_notification: async (args) => {
      const title = cleanString(args.title, 200).replace(/[<>&"]/g, "");
      const message = cleanString(args.message, 500).replace(/[<>&"]/g, "");
      const xml = `<toast><visual><binding template="ToastGeneric"><text>${title}</text><text>${message}</text></binding></visual></toast>`;
      const tmp = path.join(os.tmpdir(), `jarvis-toast-${crypto.randomBytes(6).toString("hex")}.xml`);
      fs.writeFileSync(tmp, xml, "utf8");
      const escapedTmp = tmp.replace(/'/g, "''");
      const script = [
        `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null`,
        `[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]|Out-Null`,
        `$x=[Windows.Data.Xml.Dom.XmlDocument]::new()`,
        `$x.LoadXml((Get-Content -Path '${escapedTmp}' -Raw))`,
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Jarvis').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
      ].join(";");
      try {
        await powershell(script, 8000);
      } finally {
        try { fs.unlinkSync(tmp); } catch {}
      }
      return { ok: true, title, message };
    },
    computer_use: async (args, context = {}) => {
      if (!computerUse) throw errorWithStatus("computer_use requires screen capture — not available in this runtime.", 412);
      const task = cleanString(args.task || args.instruction || args.goal || args.command, 1200);
      if (!task) throw errorWithStatus("computer_use requires a task description.", 400);
      if (/\b(password|captcha|purchase|buy|sell|trade|submit.*payment|pay|checkout|wire|bank|delete account)\b/i.test(task)) {
        throw errorWithStatus("computer_use blocked a sensitive or financial action. Use an explicit approved workflow instead.", 403);
      }
      // The planner writes the task string, and it kept writing its own caution INTO it:
      // asked "send priya hi on instagram", it produced
      //   "...type 'hi' into the message input, and leave it unsent at the exact Send button."
      // The outcome compiler reads that phrase and clears the commit, so the run never reaches the
      // approval boundary at all. The owner asked to send, the planner quietly demoted it to a
      // draft, and nothing ever asked the owner anything. Caution that removes the owner's choice
      // is not caution.
      //
      // Draft-only has a designated channel — the `prepareOnlyText` parameter — which the owner's
      // own wording routes into. Prose in `task` with that parameter unset is the planner
      // editorialising, and it is recorded so the result can say so instead of reporting "done".
      const requestedPrepareOnlyText = cleanString(args.prepareOnlyText || args.prepare_only_text, 2000);
      const { executableTask, ownerAskedToSend, plannerDemotedTheSend, honourPrepareOnlyText, restraintSurvivedStripping, restored } = resolveExecutableTask({
        ownerRequest: cleanString(context.ownerRequest, 2000),
        task,
        prepareOnlyText: requestedPrepareOnlyText,
      });
      // Whether the owner's intent survived the planner's paraphrase is the single most consequential
      // decision on this path, and it was invisible. Lengths only — never the sentences themselves.
      trace("intent", restored ? "restored" : "as-written", {
        ownerRequestChars: cleanString(context.ownerRequest, 2000).length,
        ownerAskedToSend,
        plannerDemotedTheSend,
        restored,
        restraintSurvivedStripping,
      });
      // Telling the planner not to write the restraint was not enough — it kept doing it, in fresh
      // wording each time. `resolveExecutableTask` removes it, and where stripping would leave a
      // task that no longer asks for anything, restores the owner's stated intent explicitly. It
      // never sends: it lets the run reach the approval boundary, where the owner is asked.
      const complexitySignals = (task.match(/\b(?:then|after|across|multiple|compare|analyse|analyze|evidence|source|different|tabs?|report|download|upload|repository|workflow)\b/gi) || []).length;
      const defaultMaxSteps = complexitySignals >= 6 ? 40 : complexitySignals >= 3 ? 32 : 24;
      const maxSteps = Math.min(asNumber(args.maxSteps || args.max_steps, defaultMaxSteps, 1, 40), 40);
      let startUrl = cleanString(args.startUrl || args.start_url || context.startUrl, 2000);
      // If the owner has already told us who this is, go straight to their conversation.
      //
      // This is the difference between "send hi to tg" working and the failure it has been. The
      // inbox carries two rows both named Tg; they tie, the tie is refused, the run falls back to
      // search, and search returns a group thread which a single-recipient send must never use. All
      // of that machinery exists to answer a question the owner can answer once. A stored thread URL
      // skips the inbox, the search, the ranking, and every ambiguity that comes with them.
      const outcomeIntent = compileOutcome(executableTask, { id: "contact-lookup" });
      const namedPerson = outcomeIntent.entities?.people?.[0] || "";
      const surfaceChannel = /instagram|insta/i.test(`${executableTask} ${startUrl}`) ? "instagram"
        : /whats\s*app/i.test(executableTask) ? "whatsapp"
          : /\b(gmail|email|mail)\b/i.test(executableTask) ? "email" : "";
      const knownContact = namedPerson && surfaceChannel ? contacts.routeFor(namedPerson, surfaceChannel) : null;
      let taskToRun = executableTask;
      // A saved CONVERSATION is a shortcut. A saved PROFILE is a trap.
      //
      // `routeFor` returns threadUrl || profileUrl, and this branch took either as "the place to
      // start" while telling the run "the correct conversation is already open on screen". On a
      // profile that sentence is false: the run lands on a page with no conversation, works there,
      // and never enters a chat — so no conversation URL ever exists to learn from, and that person
      // is searched from scratch on every future message, forever. Measured: the two contacts with a
      // stored conversation ran in 21s and 57s; the one holding only a profile stayed at five
      // minutes across four separate successful sends and learned nothing from any of them.
      //
      // Judged by the SAME rule that decides whether a conversation may be saved. Two copies of
      // "is this a conversation" would drift, and drift here means starting on a profile while
      // believing it is a chat — which is the failure this whole branch exists to end.
      const savedThread = contacts.isConversationUrl(surfaceChannel, knownContact?.url)
        ? knownContact.url
        : "";
      if (knownContact?.handle && !savedThread && surfaceChannel === "instagram") {
        // Their PROFILE, because a profile belongs to exactly one account.
        //
        // This route worked. Three consecutive messages reached the right person through it, each
        // one navigating to the handle's profile, clicking Message, and typing into the chat that
        // opened. It was then replaced with "search Direct for the handle" — and the very next
        // message, and the two after it, landed in the owner's GROUP chat, because the message
        // search matches conversations and a group ranked top for the name.
        //
        // The replacement was made for speed: a profile leaves no conversation URL to remember, so
        // that contact never gets the fast path. That is a real cost and it was the wrong trade.
        // Slow and right beats fast and wrong, and a route that can silently deliver to the wrong
        // people is not an optimisation.
        //
        // What makes the profile safe is structural, not a matter of ranking well: instagram.com/
        // <handle> IS that account. There is no candidate list, so there is nothing for a group to
        // win. The composer that opens from it is a one-to-one chat by construction.
        startUrl = `https://www.instagram.com/${knownContact.handle}/`;
        contacts.touch(knownContact.contactId);
        // The instruction MUST stay short, and quote ONLY the message.
        //
        // A verbose version of this — 'Click the "Message" button ... do not search for anyone, the
        // search matches group conversations as well as people ...' — poisoned entity extraction:
        // the compiler scraped "open", "anyone" and "matches" out of the prose as recipients, and
        // "Message" (which was in quotes) as a SECOND message. Two message values means the
        // deterministic "type the one message" step cannot tell which to send, so every step fell
        // through to the remote planner, which then failed on the heavy DM page. Proven offline:
        // this phrasing yields people:[] and exactly one message, which is what lets the whole
        // type-and-send run with no model call at all on that page. The profile URL already fixes
        // the recipient; the words do not need to re-explain it.
        const openExactly = "Click the Message button on this profile";
        const payload = outcomeIntent.entities?.messageValues?.[0] || "";
        if (payload) {
          taskToRun = `${openExactly}, then type ${JSON.stringify(payload)} into the message box${outcomeIntent.commit?.required ? ", then send it." : " and leave it unsent."}`;
        } else if (namedPerson) {
          // The rewrite CANNOT be optional, because the name is what causes the search.
          //
          // It used to happen only when the message text could be extracted, and extraction is
          // skipped on the recovery path where the planner has demoted a send and the system
          // restores it. On that path the owner's word — "aj" — stayed in the instruction, the agent
          // searched for it by name, found two people, and refused with "Top match margin 0.000 is
          // insufficient for a consequential action" — for a contact already saved, whose handle we
          // were holding, that the owner had already picked once. The whole point of knowing someone
          // is not having to ask again.
          //
          // Swapping their name for their handle keeps the rest of the instruction intact and leaves
          // nothing ambiguous to search for.
          const nameLike = new RegExp(namedPerson.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          taskToRun = `${executableTask.replace(nameLike, `@${knownContact.handle}`)} ${openExactly}`;
        }
        trace("contacts", "route-handle-only", { channel: knownContact.channel, rewroteTask: taskToRun !== executableTask, viaPayload: Boolean(payload) });
      } else if (savedThread) {
        startUrl = savedThread;
        contacts.touch(knownContact.contactId);
        // Navigating to the thread is only half of it. The planner's task still said "search for tg,
        // select tg's chat", so the run landed in the right conversation and then obediently typed
        // into the search box and clicked through to his profile — walking out of the place it had
        // just been taken to. A task must not instruct a search for someone already on screen.
        //
        // The rewritten task carries no person name on purpose: a name re-triggers identity
        // resolution, which is the search machinery this route exists to skip. Identity here is
        // established by the stored thread, which the owner chose themselves.
        const payload = outcomeIntent.entities?.messageValues?.[0] || "";
        if (payload) {
          taskToRun = outcomeIntent.commit?.required
            ? `The correct conversation is already open on screen. Type ${JSON.stringify(payload)} into the message input, then send it.`
            : `The correct conversation is already open on screen. Type ${JSON.stringify(payload)} into the message input and leave it unsent.`;
        }
        trace("contacts", "route-hit", { channel: knownContact.channel, rewroteTask: taskToRun !== executableTask });
      }
      const dailySurface = (context.surface || (context.placement === "visible" ? "daily-browser" : "managed-browser")) === "daily-browser";
      const stepLog = [];
      const automationOptions = {
        maxSteps,
        surface: dailySurface ? "daily-browser" : (context.surface || "managed-browser"),
        approvedExternal: context.confirmed === true,
        // Honoured only when the owner did not ask for a send. The planner sets this on its own
        // initiative — observed setting it on a plain "send hi to priya" — and left unchecked it
        // holds back the very action the owner requested, with no confirmation to approve.
        prepareOnlyText: honourPrepareOnlyText ? requestedPrepareOnlyText : "",
        taskId: context.actionTaskId || cleanString(args.taskId, 200) || undefined,
        resume: args._commitBoundary || null,
        delivery: context.placement === "visible" ? "visible" : "runtime",
        startUrl,
        focusSurface: dailySurface && startUrl ? async () => desktopControl({ action: "activate_site", target: startUrl }) : null,
        onStep: async (s) => {
          if (s.phase !== "planned") stepLog.push({ step: s.step, phase: s.phase, mode: s.mode, action: s.action, reasoning: s.reasoning, done: s.done, error: s.error || null });
          await context.onRuntimeActionStep?.(s);
        },
        controlState: context.controlState,
      };
      let takeoverStarted = false;
      if (dailySurface && desktopTakeover) {
        automationOptions.taskId ||= `desktop-${crypto.randomUUID()}`;
        desktopTakeover.start({ taskId: automationOptions.taskId, objective: task, mode: "takeover", sessionId: context.sessionId });
        desktopTakeover.observe("Reading the active Windows desktop before the first action");
        takeoverStarted = true;
      }
      const actionRuntimeControl = automationOptions.controlState;
      automationOptions.controlState = async () => {
        const takeoverControl = desktopTakeover?.controlState?.() || "running";
        if (takeoverControl !== "running") return takeoverControl;
        return typeof actionRuntimeControl === "function" ? actionRuntimeControl() : "running";
      };
      const runtimeStep = automationOptions.onStep;
      automationOptions.onStep = async (step) => {
        if (dailySurface) desktopTakeover?.applyAgentStep?.(step);
        await runtimeStep?.(step);
      };
      let result;
      try {
        result = dailySurface
          ? await computerUse.execute(taskToRun, automationOptions)
          : await universalHeadlessBrowser.execute(taskToRun, automationOptions);
      } catch (error) {
        if (takeoverStarted) desktopTakeover?.fail?.(error.message);
        throw error;
      }
      if (takeoverStarted) {
        if (result.requiresConfirmation) desktopTakeover?.pause?.("Waiting for owner approval before the consequential action");
        else if (result.success) desktopTakeover?.complete?.(result.result || "Desktop task completed and verified");
        else if (result.cancelled) desktopTakeover?.cancel?.(result.result || "Desktop task cancelled");
        else desktopTakeover?.fail?.(result.error || result.result || "Desktop task did not reach a verified outcome");
      }
      if (result.requiresConfirmation && context.confirmed !== true) {
        // `executedTask` is what actually ran, which after intent restoration differs from what the
        // planner wrote. The approval card is built from these fields, so it has to carry the real
        // one or it will describe an action nobody is about to take.
        return { confirmationRequired: true, task, executedTask: taskToRun, prepareOnlyTextIgnored: Boolean(requestedPrepareOnlyText) && !honourPrepareOnlyText, prepared: result.result, pendingAction: result.pendingAction || null, steps: stepLog, stepsCompleted: result.stepsCompleted };
      }
      if (result.requiresLogin) {
        return { ok: true, completed: false, requiresLogin: true, task, result: result.result, loginUrl: result.loginUrl || result.finalUrl || startUrl || null, taskId: result.taskId || automationOptions.taskId || null, statePath: result.statePath || null, steps: stepLog.length ? stepLog : result.history || [], mode: result.mode };
      }
      // The universal browser presents the completed page from the authenticated
      // JARVIS profile when visible delivery was explicitly requested. Opening
      // the URL again through the desktop browser created duplicate, often
      // unauthenticated tabs and broke task ownership.
      const reveal = result.handoff || null;
      // The agent reports a refusal through `error` (blocked, stagnant page, ambiguous target,
      // planner timeout) and a narrative through `result`. This mapped only `result`, so every
      // failure of the first kind arrived at execute() carrying NEITHER field — and the generic
      // fallback below turned a specific, actionable reason into "computer_use completed without
      // verifying the requested outcome.", which is the sentence the owner actually saw. Same
      // defect class as B-13 in run_command: the reason existed and was dropped at the boundary.
      // A run the planner demoted to a draft did not do what the owner asked, however cleanly it
      // finished. `completed: false` routes it away from the "Done, sir." sentence and the reason
      // travels with it, so the owner learns their send became a draft instead of being told it
      // succeeded.
      // Only when the restraint survived stripping is the run still a silent draft; then it must
      // not be summarised as done. A successfully stripped run reaches the approval boundary on its
      // own merits and is judged like any other.
      const demotionNotice = restraintSurvivedStripping
        ? "The task text told the browser to stop before sending, so nothing was sent. That restriction was added by the planner, not requested."
        : null;
      // An ambiguous identity is a question, not a dead end.
      //
      // Two rows both named "Tg" is not a malfunction — the owner knows which is which instantly and
      // the machine cannot. Refusing made that the owner's problem ("specify the exact handle") for
      // someone they message daily. Handing back the candidates turns one refusal into one question,
      // asked once, and the answer is kept.
      // A row gives a display name and nothing else, so two rows reading "Tg" produce a choice
      // between "Tg" and "Tg" — the same non-answer as refusing. Each candidate is opened and read
      // so the card can show the account behind it: handle, picture, thread. That costs a page load
      // per candidate and runs only here, where the alternative is a dead end.
      const shouldOfferChoice = Boolean(result.blocked) && Boolean(namedPerson) && (result.candidates || []).length > 0;
      const identityChoices = shouldOfferChoice
        ? await enrichCandidates({
            browserService: managedBrowser,
            taskId: `identify-${crypto.randomUUID()}`,
            candidates: result.candidates || [],
            // Without the query, a row that merely quotes the name in an old message ranks as a
            // candidate for who that person is — the live card offered "Casey i will tg not to · 1y".
            query: namedPerson,
            inboxUrl: surfaceChannel === "instagram" ? "https://www.instagram.com/direct/inbox/" : (startUrl || result.finalUrl || ""),
          }).catch(() => [])
        : [];
      const identityCard = result.blocked && identityChoices.length > 0 && namedPerson
        ? {
            kind: "contact-choice",
            title: identityChoices.length > 1 ? `Which "${namedPerson}"?` : `Is this "${namedPerson}"?`,
            body: identityChoices.length > 1
              ? "Pick the right one and I will remember it, so this is never asked again."
              : "Confirm and I will remember it, so this is never asked again.",
            query: namedPerson,
            channel: surfaceChannel || "instagram",
            task,
            candidates: identityChoices,
          }
        : null;
      // Learn the conversation, so the SECOND message to anyone is as fast as the first message to
      // the one contact that happened to have a stored thread URL.
      //
      // That single stored URL is the entire reason one recipient was fast: with it the agent opens
      // the chat directly and needs no model to find the composer or the send control. Everyone else
      // paid for a search and a disambiguation on every single message, forever. Recording the URL
      // once a send has actually succeeded closes that gap without anyone editing a contact.
      //
      // Only on a verified success, and `rememberThread` refuses anything that is not a real
      // conversation URL and will not overwrite one that already works — a wrong thread URL would
      // quietly deliver to the wrong person, which is much worse than being slow.
      //
      // Resolved again HERE rather than reusing the lookup from the start of the run, because the
      // contact frequently does not exist yet at that point: the owner is asked "which one?", picks,
      // the contact is created, and the send proceeds. `knownContact` was captured before any of
      // that, so it was null for exactly the people who most needed to be learned — a newly picked
      // contact ended up with a handle and no conversation, and searched from scratch on every
      // future message. Observed: two contacts with a conversation and fast, one without and slow
      // forever, despite all three having been messaged successfully.
      if (result.success && surfaceChannel && namedPerson) {
        try {
          // Who this send was for, even after the task stopped saying their name.
          //
          // The handle-only route rewrites the task to "Open the Instagram Direct conversation with
          // @someone…" — deliberately, because a name re-triggers the identity search. Approving
          // re-runs THAT task, so there is no name left to look anyone up by, and the lookup came
          // back empty: `no conversation saved for unknown contact — evidence urls:
          // ["https://www.instagram.com/direct/t/…"]`. The conversation URL was correct and present
          // and thrown away for want of a recipient, which is why this contact stayed slow through
          // four successful sends.
          //
          // A handle identifies a person at least as well as a name, and `routeFor` already matches
          // on handles, so the rewritten task is still perfectly able to say who it meant.
          const handleInTask = /@([A-Za-z0-9._]{2,40})/.exec(String(taskToRun || ""))?.[1] || "";
          const learnFor = knownContact?.contactId
            ? knownContact
            : (contacts.routeFor(namedPerson, surfaceChannel)
              || (handleInTask ? contacts.routeFor(handleInTask, surfaceChannel) : null));
          // The page it was on WHEN IT SENT — not where the run happened to finish.
          //
          // `finalUrl` is the last page of the whole run, and a send that goes through someone's
          // profile leaves it sitting back on that profile. So the conversation the message actually
          // went into was never written down, and that person re-searched from scratch on every
          // future message, forever. Observed: two contacts with a saved conversation ran in 21s and
          // 57s; a third kept ending on a profile URL, learned nothing, and stayed at five minutes.
          //
          // Sending is precisely the moment the conversation is known, and the run already records
          // where it was standing then. Newest first, with the end of the run as a last resort;
          // `rememberThread` still rejects anything that is not a real conversation on a known host.
          const sentOn = (result.evidence || [])
            .filter((item) => item?.kind === "post-commit-observation" && item.url)
            .map((item) => item.url)
            .reverse();
          const tried = [...sentOn, result.finalUrl || ""];
          let learned = false;
          for (const candidateUrl of tried) {
            if (learnFor?.contactId && contacts.rememberThread(learnFor.contactId, surfaceChannel, candidateUrl)) { learned = true; break; }
          }
          // Three attempts at this have now failed on guesses about which URL is offered here.
          // Printing the actual candidates ends the guessing: one run says whether the conversation
          // URL is absent, is present but rejected, or was never reached at all.
          if (!learned) {
            console.log(`[contacts:learn] no conversation saved for ${learnFor?.contactId ? "known contact" : "unknown contact"}`
              + ` — evidence urls: ${JSON.stringify(sentOn.slice(0, 4))}, finalUrl: ${JSON.stringify(result.finalUrl || "")}`
              + `, evidence kinds: ${JSON.stringify((result.evidence || []).map((item) => item?.kind).slice(0, 8))}`);
          }
        } catch { /* never fail a delivered send over a cache write */ }
      }
      return { ok: result.success, task, executedTask: executableTask, result: result.result, error: result.error || demotionNotice, blocked: result.blocked || false, candidates: result.candidates || null, card: identityCard, completed: restraintSurvivedStripping ? false : undefined, plannerDemotedTheSend, restraintStripped: plannerDemotedTheSend && !restraintSurvivedStripping, steps: stepLog.length ? stepLog : result.history || result.steps || [], evidence: result.evidence || [], statePath: result.statePath || null, taskId: result.taskId || automationOptions.taskId || null, stepsCompleted: result.stepsCompleted, mode: result.mode, finalUrl: result.finalUrl || null, finalTitle: result.finalTitle || null, reveal };
    },
    screen_locate: async (args) => {
      if (!computerUse) throw errorWithStatus("screen_locate requires screen capture.", 412);
      const elementDescription = cleanString(args.description || args.target || args.element, 400);
      if (!elementDescription) throw errorWithStatus("screen_locate requires a description of the element to find.", 400);
      const located = await computerUse.locateElement(elementDescription);
      return { ok: located.found, ...located };
    },
    mouse_scroll: async (args) => {
      if (!computerUse) throw errorWithStatus("mouse_scroll requires screen capture.", 412);
      const direction = ["up", "down", "left", "right"].includes(args.direction) ? args.direction : "down";
      const amount = Math.max(1, Math.min(10, asNumber(args.amount, 3, 1, 10)));
      let sx = args.x != null ? Math.round(Number(args.x)) : null;
      let sy = args.y != null ? Math.round(Number(args.y)) : null;
      if (sx == null || sy == null) {
        try {
          const cap = await screenCapture({ reason: "mouse_scroll center" });
          const dims = (cap?.dimensions || "1920x1080").split("x");
          if (sx == null) sx = (Number(cap?.bounds?.x) || 0) + Math.round(Number(dims[0]) / 2);
          if (sy == null) sy = (Number(cap?.bounds?.y) || 0) + Math.round(Number(dims[1]) / 2);
        } catch { sx = sx ?? 960; sy = sy ?? 540; }
      }
      const scrollResult = await computerUse.mouseScroll(sx, sy, direction, amount);
      return { ok: scrollResult.ok, x: sx, y: sy, direction, amount };
    },
    screen_analyze: async (args) => {
      if (!screenCapture) throw errorWithStatus("Screen capture is not available in this runtime", 412);
      const question = cleanString(args.question || "Describe everything visible on this screen in detail.", 500);
      let capture;
      try {
        capture = await screenCapture({ reason: "screen_analyze" });
      } catch (err) {
        throw errorWithStatus(`Screen capture failed: ${err.message}`, 500);
      }
      let imageBase64;
      try {
        if (capture?.imageBase64) {
          imageBase64 = capture.imageBase64;
        } else if (capture?.imagePath) {
          imageBase64 = fs.readFileSync(capture.imagePath).toString("base64");
        } else {
          throw errorWithStatus("Screen capture returned no image data", 500);
        }
      } catch (err) {
        if (err.statusCode) throw err;
        throw errorWithStatus(`Failed to load captured image: ${err.message}`, 500);
      }
      const settings = getSettings();
      const apiKey = settings?.geminiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) throw errorWithStatus("Gemini API key is not configured for screen analysis", 412);
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: settings.geminiActionModel || settings.geminiModel || "gemini-3.5-flash", // Cortex v4 0.2 — vision-capable registry model
        contents: [{ role: "user", parts: [
          { inlineData: { data: imageBase64, mimeType: "image/png" } },
          { text: question },
        ] }],
      });
      const analysis = result.candidates?.[0]?.content?.parts?.[0]?.text || result.text || "";
      return { ok: true, question, analysis, capturedAt: capture?.capturedAt || new Date().toISOString() };
    },
  };

  async function execute(tool, args = {}, context = {}) {
    const definition = definitionFor(tool);
    const handler = handlers[tool];
    if (!definition || !handler) throw errorWithStatus(`Unknown capability: ${tool}`, 404);
    if (tool === "open_url") {
      try {
        normalizeOpenUrl(args.url);
      } catch (error) {
        return {
          ok: false,
          status: "failed",
          capability: definition,
          error: error.message,
          statusCode: error.statusCode || 400,
        };
      }
    }
    const cutoff = Date.now() - 60_000;
    while (actionHistory.length && actionHistory[0] < cutoff) actionHistory.shift();
    const policy = evaluateAutonomy({
      definition,
      tool,
      args,
      profile: getAutonomyProfile ? getAutonomyProfile() : { level: "act" },
      context,
      recentActionCount: actionHistory.length,
    });
    if (!policy.allowed) {
      return {
        ok: false,
        status: policy.needsElevation ? "autonomy_elevation_required" : "denied",
        capability: definition,
        policy,
        error: policy.reason,
      };
    }
    const safeBrowserContinuation = new Set([
      "browser_navigate",
      "browser_status",
      "browser_login_handoff",
      "browser_login_complete",
      "browser_page_brief",
      "browser_snapshot",
      "browser_tabs",
      "browser_act",
      "browser_file_search",
      "browser_inspect",
      "browser_extract",
      "browser_screenshot",
      "browser_wait",
      "browser_verify",
      "screen_capture",
      "screen_inspect",
      "screen_act",
      "device_files",
      "device_latest_image",
      "mesh_status",
      "mesh_objects",
      "mesh_pair_link",
      "mesh_send_command",
      "coop_symbiote_status",
      "coop_symbiote_create_session",
      "coop_symbiote_manifest",
      "coop_symbiote_chat",
      "coop_symbiote_patch",
      "coop_symbiote_ghost_test",
      "coop_symbiote_debate",
      "coop_symbiote_memory",
      "web_research_deep",
      "url_read",
      "compose_artifact",
      "artifact_status",
      "pc_graph_rebuild",
      "pc_graph_search",
      "pc_graph_timeline",
      "pc_graph_explain",
      "pc_graph_inspect",
      "agent_deploy",
      "skill_compile",
      "skill_run",
      "skill_list",
      "skill_inspect",
      "neural_vault_status",
      "neural_vault_context",
      "neural_vault_resolve",
      "neural_vault_actions",
      "neural_vault_integrations",
      "neural_vault_api_key_metadata",
      "neural_vault_maintenance",
      "memory_os_v4_status",
      "memory_os_v4_query",
      "memory_os_v4_scan_files",
      "memory_os_v4_run_agent",
      "mesh_self_test",
      "desktop_control",
      "computer_use",
    ]);
    const indirectBlocked = context.indirect && !safeBrowserContinuation.has(tool) && (
      definition.risk !== "observe"
      || ["list_processes", "network_inventory", "search_files", "memory_search"].includes(tool)
    );
    if (indirectBlocked) {
      return { ok: false, status: "denied", capability: definition, error: "Indirect tool output cannot authorize this capability." };
    }
    if (context.source === "voice" && ["execute", "commit"].includes(definition.risk)) {
      return { ok: false, status: "denied", capability: definition, error: "Phone voice sessions cannot authorize computer-control or commit actions." };
    }
    if ((definition.confirmationRequired || policy.requiresConfirmation) && !context.confirmed) {
      if (!context.sessionId) {
        return {
          ok: false,
          status: "approval_session_required",
          capability: definition,
          error: "This action was prepared by a background agent and requires approval from an active local session.",
        };
      }
      return { ok: false, status: "confirmation_required", confirmation: requestConfirmation(tool, args, context), capability: definition };
    }

    const started = Date.now();
    try {
      const result = await handler(args, context);
      if (result?.confirmationRequired && !context.confirmed) {
        // The card must describe what approving it will DO. `args` is what the planner asked for,
        // which after intent restoration is no longer what runs — the observed card read "prepare
        // the message text hi in the composer without sending it" above a pending Send click. An
        // approval prompt that misdescribes its own action is worse than none, because it teaches
        // the owner that the description is not worth reading.
        const confirmationArgs = {
          ...args,
          ...(result.executedTask ? { task: result.executedTask } : {}),
          ...(result.executedTask && result.executedTask !== args.task ? { plannerTask: args.task } : {}),
          ...(result.prepareOnlyTextIgnored ? { prepareOnlyText: undefined } : {}),
          _commitBoundary: result.pendingAction || null,
        };
        return {
          ok: false,
          status: "confirmation_required",
          confirmation: requestConfirmation(tool, confirmationArgs, context),
          capability: definition,
          prepared: result.prepared || null,
        };
      }
      const explicitlyFailed = result && typeof result === "object"
        && (result.ok === false || result.success === false);
      // A failure that comes with a question for the owner is not a dead end, and throwing discards
      // the question along with everything else on the result.
      //
      // This is what a blocked identity looks like: the run stopped because two people share a name,
      // the candidates were opened and enriched, a contact-choice card was built — and then the
      // throw dropped it and the caller got a bare 502. The one case the card exists for was the one
      // case it could never reach the owner. It is returned as a normal unsuccessful result instead,
      // carrying the card, so the UI can ask.
      if (explicitlyFailed && result.card) {
        return {
          ok: false,
          status: "needs_owner_input",
          capability: definition,
          result,
          error: cleanString(result.error || `${tool} needs the owner to identify who was meant.`, 1000),
        };
      }
      if (explicitlyFailed) {
        throw errorWithStatus(
          cleanString(result.error || result.result || `${tool} completed without verifying the requested outcome.`, 1000),
          502,
        );
      }
      if (definition.risk !== "observe") actionHistory.push(Date.now());
      // "verified" used to be a hardcoded string on every handler that did not throw, so the word
      // meant only "no exception was raised". Downstream — jarvis-bridge's `execution.receipt
      // ?.status === "verified"` and the owner-approval receipt — treated it as proof the action
      // landed. An observation is complete the moment it returns; a side-effecting action is not,
      // and now has to show a positive signal from its adapter to earn the word.
      const outcomeSignal = (() => {
        if (definition.risk === "observe") return "observation returned";
        if (result && typeof result === "object") {
          if (result.verified === true) return "adapter reported verified === true";
          if (result.confirmed === true) return "adapter reported confirmed === true";
          if (typeof result.verification === "string" && result.verification.trim()) return `adapter verification: ${result.verification.trim().slice(0, 120)}`;
        }
        return null;
      })();
      const durationMs = Date.now() - started;
      const receipt = createReceipt({
        action: `capability.${tool}`,
        target: tool,
        risk: definition.risk,
        status: outcomeSignal ? "verified" : "executed_unverified",
        input: hash(args),
        plan: [`Validate ${tool} arguments`, "Execute bounded adapter", "Verify provider or local result"],
        result: JSON.stringify(result).slice(0, 2000),
        verification: outcomeSignal
          ? [outcomeSignal, `Duration ${durationMs}ms`]
          : ["Executor returned without throwing; the adapter reported no verified outcome", `Duration ${durationMs}ms`],
        deviceId: context.deviceId || "local-browser",
      });
      return { ok: true, status: "completed", capability: definition, result, receipt };
    } catch (error) {
      const receipt = createReceipt({
        action: `capability.${tool}`,
        target: tool,
        risk: definition.risk,
        status: "failed",
        input: hash(args),
        result: cleanString(error.message, 1000),
        verification: ["Execution failed; no success claim was emitted"],
        deviceId: context.deviceId || "local-browser",
      });
      return { ok: false, status: "failed", capability: definition, error: error.message, statusCode: error.statusCode || 500, receipt };
    }
  }

  async function approveConfirmation(id, context = {}) {
    const confirmations = loadConfirmations();
    const confirmation = confirmations.find((item) => item.id === id);
    if (!confirmation) throw errorWithStatus("Confirmation is invalid or expired", 403);
    if (!context.sessionId || confirmation.actor.sessionId !== context.sessionId) throw errorWithStatus("Confirmation belongs to another session", 403);
    if (context.deviceId && confirmation.actor.deviceId !== context.deviceId) throw errorWithStatus("Confirmation belongs to another device", 403);
    const expectedChallenge = Buffer.from(String(confirmation.ownerChallenge || ""));
    const suppliedChallenge = Buffer.from(String(context.ownerChallenge || ""));
    if (!expectedChallenge.length || expectedChallenge.length !== suppliedChallenge.length || !crypto.timingSafeEqual(expectedChallenge, suppliedChallenge)) {
      throw errorWithStatus("Owner confirmation challenge is invalid", 403);
    }
    writeJsonAtomic(confirmationsPath, confirmations.filter((item) => item.id !== id));
    return execute(confirmation.tool, confirmation.args, {
      ...confirmation.continuation,
      ...context,
      confirmed: true,
      confirmationId: id,
    });
  }

  function denyConfirmation(id, context = {}) {
    const confirmations = loadConfirmations();
    const confirmation = confirmations.find((item) => item.id === id);
    if (!confirmation) throw errorWithStatus("Confirmation is invalid or expired", 403);
    if (!context.sessionId || confirmation.actor.sessionId !== context.sessionId) throw errorWithStatus("Confirmation belongs to another session", 403);
    const expectedChallenge = Buffer.from(String(confirmation.ownerChallenge || ""));
    const suppliedChallenge = Buffer.from(String(context.ownerChallenge || ""));
    if (!expectedChallenge.length || expectedChallenge.length !== suppliedChallenge.length || !crypto.timingSafeEqual(expectedChallenge, suppliedChallenge)) {
      throw errorWithStatus("Owner confirmation challenge is invalid", 403);
    }
    writeJsonAtomic(confirmationsPath, confirmations.filter((item) => item.id !== id));
    const receipt = createReceipt({
      action: `capability.${confirmation.tool}.deny`,
      target: confirmation.tool,
      risk: confirmation.risk,
      status: "denied",
      input: confirmation.argumentHash,
      result: "Owner denied the prepared action. No executor was called.",
      verification: ["One-time challenge consumed", "Capability handler not executed"],
      deviceId: context.deviceId || "local-browser",
    });
    return { ok: false, status: "denied", confirmationId: id, tool: confirmation.tool, message: `Denied ${confirmation.tool}. No action was executed.`, receipt };
  }

  return {
    definitions,
    declarations,
    apps: Object.keys(appCatalog),
    execute,
    privateBrowser: managedBrowser,
    browserNavigationMemory: universalHeadlessBrowser.navigationMemory,
    desktopTakeover,
    close: () => {
      browser.close?.();
      pcGraph.close();
      skillAutopilot.close();
    },
    approveConfirmation,
    denyConfirmation,
    cancelConfirmationsForTask: (taskId) => {
      const id = cleanString(taskId, 160);
      const active = loadConfirmations();
      const cancelled = active.filter((item) => item.continuation?.actionTaskId === id);
      if (cancelled.length) writeJsonAtomic(confirmationsPath, active.filter((item) => item.continuation?.actionTaskId !== id));
      return { taskId: id, cancelled: cancelled.length, confirmationIds: cancelled.map((item) => item.id) };
    },
    cancelAutomationTask: async (taskId) => {
      const id = cleanString(taskId, 200);
      const results = await Promise.allSettled([
        managedBrowser.releaseTask({ taskId: id, close: true }),
      ]);
      if (desktopTakeover?.status?.().taskId === id) desktopTakeover.cancel("Runtime task cancelled by owner");
      return { taskId: id, released: results.map((item) => item.status === "fulfilled") };
    },
    pendingConfirmations: (sessionId, { includeOwnerChallenge = false } = {}) => loadConfirmations()
      .filter((item) => !sessionId || item.actor.sessionId === sessionId)
      .map((item) => ({
        id: item.id,
        tool: item.tool,
        risk: item.risk,
        summary: confirmationSummary(item.args || {}),
        // The pending-list card and the inline card must describe the action the same way; the UI
        // falls back to this list whenever the inline payload is missing.
        commit: commitCard(item.args || {}),
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        argumentHash: item.argumentHash,
        actionTaskId: item.continuation?.actionTaskId || null,
        actionStepId: item.continuation?.actionStepId || null,
        placement: item.continuation?.placement || null,
        surface: item.continuation?.surface || null,
        ...(includeOwnerChallenge ? { ownerChallenge: item.ownerChallenge } : {}),
      })),
  };
}

module.exports = { createCapabilityEngine };
