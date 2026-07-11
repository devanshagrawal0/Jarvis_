import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8799);
const BASE_URL = process.env.JARVIS_VISUAL_URL || `http://127.0.0.1:${PORT}`;
const RESULT_DIR = path.join(ROOT, "test-results", "jarvis-new");
const CURRENT = path.join(RESULT_DIR, "current.png");
const REFERENCE = path.join(ROOT, "design", "reference-new", "image-a-main.png");
const REF_COPY = path.join(RESULT_DIR, "reference.png");
const WIDTH = 1672;
const HEIGHT = 941;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function canReach(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canReach(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function main() {
  ensureDir(RESULT_DIR);
  if (!fs.existsSync(REFERENCE)) throw new Error(`Missing reference image: ${REFERENCE}`);
  fs.copyFileSync(REFERENCE, REF_COPY);

  let serverProcess = null;
  if (!(await canReach(BASE_URL))) {
    serverProcess = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
      detached: false
    });
    const ready = await waitForServer(BASE_URL);
    if (!ready) throw new Error(`Could not start Jarvis server at ${BASE_URL}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce"
    });
    const page = await context.newPage();
    const captureId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await page.goto(`${BASE_URL}/?visualTest=1&capture=${captureId}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('[data-visual-ready="true"]', { timeout: 10000 });
    await page.addStyleTag({
      content: `html,body,#root{width:${WIDTH}px!important;height:${HEIGHT}px!important;overflow:hidden!important;} *{cursor:none!important;}`
    });
    await page.screenshot({ path: CURRENT, fullPage: false, scale: "css", type: "png" });
    const checks = await page.evaluate(() => ({
      url: location.href,
      visualReady: document.querySelector("[data-visual-ready='true']") !== null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      verticalOverflow: document.documentElement.scrollHeight - window.innerHeight,
      consoleMarker: "capture-complete",
      assets: Array.from(document.querySelectorAll("script[src],link[rel='stylesheet'][href]")).map((node) => node.getAttribute("src") || node.getAttribute("href"))
    }));
    console.log(JSON.stringify({ current: path.relative(ROOT, CURRENT).replaceAll("\\", "/"), ...checks }, null, 2));
  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
