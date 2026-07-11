const { app, BrowserWindow, Menu, shell, dialog, Tray, nativeImage } = require("electron");
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
let tray = null;
let serverProcess = null;
let ownsServer = false;

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
  serverProcess = fork(serverPath, [], {
    cwd: app.isPackaged ? app.getPath("userData") : DEV_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      JARVIS_HOST: HOST,
      JARVIS_RUNTIME_DIR: runtimeDir(),
      JARVIS_DESKTOP_APP: "1",
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", out, err, "ipc"],
  });
  ownsServer = true;
  logLine(`started server child pid=${serverProcess.pid} serverPath=${serverPath} cwd=${app.isPackaged ? app.getPath("userData") : DEV_ROOT}`);
  serverProcess.once("exit", (code, signal) => {
    logLine(`server child exited code=${code ?? ""} signal=${signal ?? ""}`);
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("JARVIS server stopped", `The local server exited (${code ?? signal ?? "unknown"}).`);
    }
    serverProcess = null;
    ownsServer = false;
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
  createTray();
}

app.whenReady().then(() => boot().catch((error) => {
  logLine(`boot failed: ${error.stack || error.message}`);
  console.error(error);
  if (!SMOKE_TEST) dialog.showErrorBox("JARVIS failed to start", error.message);
  app.exit(1);
}));

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && !SMOKE_TEST) void createWindow();
  else mainWindow?.show();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (ownsServer && serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
