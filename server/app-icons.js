"use strict";

// Icon cache for the phone's app list. One long-lived PowerShell worker (app-icons.ps1) renders
// the shell's own image for each AppID into runtime/app-icons/<md5>.png; this module hands out
// paths and warms the whole list in the background the first time it is asked for.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const SCRIPT = path.join(__dirname, "app-icons.ps1");

function createAppIcons({ runtimeDir, log = () => {} } = {}) {
  const dir = path.join(runtimeDir, "app-icons");
  fs.mkdirSync(dir, { recursive: true });
  let child = null;
  let buffer = "";
  const pending = new Map();   // appId -> [{resolve}]
  let warmed = false;

  const fileFor = (appId) => path.join(dir, `${crypto.createHash("md5").update(String(appId)).digest("hex")}.png`);

  function ensure() {
    if (child) return child;
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
        const [status, appId, err] = line.split("\t");
        const waiters = pending.get(appId) || [];
        pending.delete(appId);
        if (status !== "ok") log(`icon failed for ${appId}: ${err || "?"}`);
        for (const w of waiters) w(status === "ok" ? fileFor(appId) : null);
      }
    });
    child.stderr.on("data", (t) => log(`icon worker: ${String(t).trim().slice(0, 200)}`));
    child.on("exit", (code) => { log(`icon worker exited (${code})`); child = null; for (const [, ws] of pending) for (const w of ws) w(null); pending.clear(); });
    return child;
  }

  // Resolves to the PNG path, or null if the shell has no image for it. Cached on disk forever;
  // a failed render is not cached, so a later request tries again.
  function iconFor(appId) {
    const file = fileFor(appId);
    if (fs.existsSync(file)) return Promise.resolve(file);
    return new Promise((resolve) => {
      const list = pending.get(appId);
      if (list) { list.push(resolve); return; }
      pending.set(appId, [resolve]);
      ensure().stdin.write(`${appId}\t${file}\n`);
      setTimeout(() => { const ws = pending.get(appId); if (ws) { pending.delete(appId); for (const w of ws) w(null); } }, 8000);
    });
  }

  // Render every icon once, sequentially through the worker, so the list is complete by the
  // time the owner scrolls. ~100 ms each; 126 apps ≈ 13 s, once.
  function warm(appIds) {
    if (warmed) return;
    warmed = true;
    (async () => {
      let done = 0;
      for (const id of appIds) { if (!fs.existsSync(fileFor(id))) await iconFor(id); done += 1; }
      log(`icons warm (${done})`);
    })().catch((e) => log(`warm failed: ${e.message}`));
  }

  function stop() { try { child?.stdin.end(); } catch { /* closed */ } }

  return { iconFor, warm, stop, fileFor };
}

module.exports = { createAppIcons };
