const { app, BrowserWindow, Menu, shell, dialog, Tray, nativeImage, screen, globalShortcut } = require("electron");
const { fork } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

// ── Hardware video decode (must be before app.ready) ──────────────────────
// Enables D3D11/DXVA2 GPU video decode on Windows — prevents software fallback
// that causes choppy playback. Blob URLs bypass this; HTTP src uses it.
app.commandLine.appendSwitch("enable-features", "HardwareMediaKeyHandling,MediaFoundationD3D11Decode,NativeMediaSessionAPI");
app.commandLine.appendSwitch("disable-features", "UseCrashedCodec");
app.commandLine.appendSwitch("enable-native-hevc-decoding");
app.commandLine.appendSwitch("enable-gpu");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-gpu-compositing-workaround");
app.commandLine.appendSwitch("enable-vsync");
app.commandLine.appendSwitch("disable-software-rasterizer");

const DEV_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || process.env.JARVIS_APP_PORT || 8799);
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}`;
const SMOKE_TEST = process.argv.includes("--smoke-test");

let mainWindow = null;
let overlayWindow = null;
let overlayBounds = null;
let overlayPoll = null;
let tray = null;
let serverProcess = null;
let ownsServer = false;
let serverShutdownRequested = false;
let serverShutdownTimer = null;

function logLine(message) {
  try {
    const directory = path.join(runtimeDir(), "logs");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "electron-main.log"), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never block desktop startup.
  }
}

function appRoot() {
  return app.isPackaged ? app.getAppPath() : DEV_ROOT;
}

function runtimeDir() {
  if (process.env.JARVIS_RUNTIME_DIR) return process.env.JARVIS_RUNTIME_DIR;
  return app.isPackaged ? path.join(app.getPath("userData"), "runtime") : path.join(DEV_ROOT, "runtime");
}

function serverNodeExecutable() {
  if (app.isPackaged) return process.execPath;
  const configured = process.env.JARVIS_NODE_EXECUTABLE;
  if (configured && fs.existsSync(configured)) return configured;
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const candidates = String(process.env.PATH || "").split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory.replace(/^"|"$/g, ""), executable));
  return candidates.find((candidate) => fs.existsSync(candidate)) || process.execPath;
}

function requestJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(body || "{}") });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`Timed out waiting for ${url}`));
    });
    request.on("error", reject);
  });
}

function postJson(url, body = {}, timeoutMs = 1800) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const parsed = new URL(url);
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      timeout: timeoutMs,
      headers: { "content-type": "application/json", "content-length": payload.length },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        try { resolve({ statusCode: response.statusCode, body: JSON.parse(responseBody || "{}") }); }
        catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Timed out waiting for ${url}`)));
    request.on("error", reject);
    request.end(payload);
  });
}

async function waitForServer(timeoutMs = 120_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const health = await requestJson(`${APP_URL}/api/health`, 2500);
      if (health.statusCode === 200 && health.body?.ok) return health.body;
      lastError = `Unexpected health status ${health.statusCode}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  throw new Error(`Jarvis server did not become healthy. ${lastError}`);
}

async function isExistingServerHealthy() {
  try {
    const health = await requestJson(`${APP_URL}/api/health`, 1200);
    return health.statusCode === 200 && health.body?.ok;
  } catch {
    return false;
  }
}

function startServer() {
  const root = appRoot();
  const serverPath = path.join(root, "server.js");
  if (!fs.existsSync(serverPath)) throw new Error(`Missing server entry: ${serverPath}`);
  const logDir = path.join(runtimeDir(), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, "electron-server.out.log"), "a");
  const err = fs.openSync(path.join(logDir, "electron-server.err.log"), "a");
  const serverExecPath = serverNodeExecutable();
  serverProcess = fork(serverPath, [], {
    cwd: app.isPackaged ? app.getPath("userData") : DEV_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      JARVIS_HOST: HOST,
      JARVIS_RUNTIME_DIR: runtimeDir(),
      JARVIS_DESKTOP_APP: "1",
      ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    execPath: serverExecPath,
    stdio: ["ignore", out, err, "ipc"],
  });
  ownsServer = true;
  serverProcess.on("message", (message) => {
    if (message?.type === "jarvis.desktop-takeover") updateOverlay(message.state);
  });
  logLine(`started server child pid=${serverProcess.pid} execPath=${serverExecPath} serverPath=${serverPath} cwd=${app.isPackaged ? app.getPath("userData") : DEV_ROOT}`);
  serverProcess.once("exit", (code, signal) => {
    const finishDesktopQuit = serverShutdownRequested;
    if (serverShutdownTimer) clearTimeout(serverShutdownTimer);
    serverShutdownTimer = null;
    logLine(`server child exited code=${code ?? ""} signal=${signal ?? ""}`);
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("JARVIS server stopped", `The local server exited (${code ?? signal ?? "unknown"}).`);
    }
    serverProcess = null;
    ownsServer = false;
    if (finishDesktopQuit) app.exit(0);
  });
}

function createMenu() {
  return Menu.buildFromTemplate([
    {
      label: "JARVIS",
      submenu: [
        { label: "Open Command Center", click: () => mainWindow?.show() },
        { label: "Open In Browser", click: () => shell.openExternal(APP_URL) },
        { type: "separator" },
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
        { label: "Developer Tools", accelerator: "F12", click: () => mainWindow?.webContents.openDevTools({ mode: "detach" }) },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
  ]);
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("JARVIS OS");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show JARVIS", click: () => mainWindow?.show() },
    { label: "Open Phone Pairing", click: () => shell.openExternal(`${APP_URL}/?open=mesh`) },
    { label: "Open In Browser", click: () => shell.openExternal(APP_URL) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  tray.on("click", () => mainWindow?.show());
}

function virtualDisplayBounds() {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function overlayCoordinates(state = {}) {
  if (!overlayBounds) return state;
  const shift = (point) => {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return point;
    const physical = { x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) };
    const dip = typeof screen.screenToDipPoint === "function" ? screen.screenToDipPoint(physical) : physical;
    const shifted = { ...point, x: dip.x - overlayBounds.x, y: dip.y - overlayBounds.y };
    if (Number(point.width) > 0 || Number(point.height) > 0) {
      const farPhysical = { x: physical.x + (Number(point.width) || 0), y: physical.y + (Number(point.height) || 0) };
      const farDip = typeof screen.screenToDipPoint === "function" ? screen.screenToDipPoint(farPhysical) : farPhysical;
      shifted.width = Math.max(1, farDip.x - dip.x);
      shifted.height = Math.max(1, farDip.y - dip.y);
    }
    return shifted;
  };
  return {
    ...state,
    target: shift(state.target),
    cursor: shift(state.cursor),
    marks: Array.isArray(state.marks) ? state.marks.map(shift) : [],
  };
}

function updateOverlay(state = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const active = Boolean(state.overlayVisible && state.active);
  overlayWindow.webContents.send("desktop-takeover-state", overlayCoordinates(state));
  if (active) overlayWindow.showInactive();
  else overlayWindow.hide();
}

async function createOverlayWindow() {
  overlayBounds = virtualDisplayBounds();
  overlayWindow = new BrowserWindow({
    ...overlayBounds,
    title: "JARVIS Desktop Takeover Overlay",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "overlay-preload.cjs"),
    },
  });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setContentProtection(true);
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await overlayWindow.loadFile(path.join(__dirname, "overlay.html"));
  overlayWindow.on("closed", () => { overlayWindow = null; });
  screen.on("display-added", () => {
    overlayBounds = virtualDisplayBounds();
    overlayWindow?.setBounds(overlayBounds, false);
  });
  screen.on("display-removed", () => {
    overlayBounds = virtualDisplayBounds();
    overlayWindow?.setBounds(overlayBounds, false);
  });
  screen.on("display-metrics-changed", () => {
    overlayBounds = virtualDisplayBounds();
    overlayWindow?.setBounds(overlayBounds, false);
  });
}

function registerTakeoverShortcuts() {
  globalShortcut.register("CommandOrControl+Alt+Escape", () => {
    void postJson(`${APP_URL}/api/desktop-takeover/cancel`, { reason: "Owner pressed the global emergency-stop shortcut" }).catch(() => undefined);
  });
  globalShortcut.register("CommandOrControl+Alt+Space", async () => {
    try {
      const status = await requestJson(`${APP_URL}/api/desktop-takeover/status`);
      const paused = status.body?.takeover?.phase === "paused";
      await postJson(`${APP_URL}/api/desktop-takeover/${paused ? "resume" : "pause"}`, { reason: `Owner ${paused ? "resumed" : "paused"} using the global shortcut` });
    } catch {}
  });
}

function startOverlayPolling() {
  if (overlayPoll) clearInterval(overlayPoll);
  overlayPoll = setInterval(async () => {
    try {
      const response = await requestJson(`${APP_URL}/api/desktop-takeover/status`, 700);
      if (response.statusCode === 200) updateOverlay(response.body?.takeover || {});
    } catch {}
  }, 350);
  overlayPoll.unref?.();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "JARVIS OS",
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#02070b",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (!SMOKE_TEST) mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (!app.isQuitting && !SMOKE_TEST) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  await mainWindow.loadURL(APP_URL);
}

async function boot() {
  app.setName("JARVIS OS");
  logLine(`boot packaged=${app.isPackaged} appRoot=${appRoot()} runtime=${runtimeDir()}`);
  Menu.setApplicationMenu(createMenu());
  if (!(await isExistingServerHealthy())) startServer();
  else logLine(`reusing existing server at ${APP_URL}`);
  const health = await waitForServer();
  logLine(`server healthy startedAt=${health.startedAt || ""}`);
  if (SMOKE_TEST) {
    console.log(JSON.stringify({ ok: true, appUrl: APP_URL, health }, null, 2));
    app.quit();
    return;
  }
  await createWindow();
  await createOverlayWindow();
  registerTakeoverShortcuts();
  startOverlayPolling();
  createTray();
}

app.whenReady().then(() => boot().catch((error) => {
  logLine(`boot failed: ${error.stack || error.message}`);
  console.error(error);
  if (!SMOKE_TEST) dialog.showErrorBox("JARVIS failed to start", error.message);
  app.exit(1);
}));

app.on("activate", () => {
  if ((!mainWindow || mainWindow.isDestroyed()) && !SMOKE_TEST) void createWindow();
  else mainWindow?.show();
});

app.on("before-quit", (event) => {
  app.isQuitting = true;
  if (overlayPoll) clearInterval(overlayPoll);
  overlayPoll = null;
  globalShortcut.unregisterAll();
  overlayWindow?.destroy();
  overlayWindow = null;
  if (ownsServer && serverProcess && !serverShutdownRequested) {
    event.preventDefault();
    serverShutdownRequested = true;
    const child = serverProcess;
    try { child.send({ type: "jarvis.shutdown" }); }
    catch { child.kill(); }
    serverShutdownTimer = setTimeout(() => {
      try { if (!child.killed) child.kill(); } catch {}
      app.exit(0);
    }, 5_000);
  } else if (ownsServer && serverProcess && serverShutdownRequested) {
    event.preventDefault();
  }
});
