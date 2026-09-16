"use strict";

// Node side of the takeover input agent (see pc-input.ps1). One long-lived PowerShell process
// with the SendInput helper already compiled; every event is one line in, one line out, a few
// milliseconds end to end. The previous path (desktop_control → a fresh PowerShell with Add-Type
// per click) cost hundreds of milliseconds and could only click — unusable behind a live video.

const path = require("path");
const { spawn } = require("child_process");

const SCRIPT = path.join(__dirname, "pc-input.ps1");
const ACK_TIMEOUT_MS = 3000;

function createPcInput({ log = () => {} } = {}) {
  let child = null;
  let ready = null;          // promise resolved when the agent prints {"ready":true}
  let seq = 0;
  let buffer = "";
  const pending = new Map();
  let counts = { events: 0, errors: 0, startedAt: "" };

  function failAll(reason) {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); pending.delete(id); }
  }

  function onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.ready) { ready?.resolve(); return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(true);
    else { counts.errors += 1; p.reject(new Error(msg.error || "input agent error")); }
  }

  function ensure() {
    if (child) return ready.promise;
    let resolve, reject;
    const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
    ready = { promise, resolve, reject };
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.on("error", (e) => { log(`input agent spawn error: ${e.message}`); child = null; ready?.reject(new Error(e.message)); failAll("input agent spawn error"); });
    child.stdin.on("error", () => {});
    counts = { events: 0, errors: 0, startedAt: new Date().toISOString() };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1); if (line) onLine(line); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (t) => log(`agent stderr: ${String(t).trim().slice(0, 300)}`));
    child.on("exit", (code) => { log(`input agent exited (${code})`); child = null; ready?.reject(new Error("input agent exited")); failAll("input agent exited"); });
    const bootTimer = setTimeout(() => { if (child && pending.size === 0) ready.reject(new Error("input agent did not start")); }, 15000);
    promise.finally(() => clearTimeout(bootTimer)).catch(() => {});
    return promise;
  }

  async function send(event) {
    await ensure();
    const id = ++seq;
    counts.events += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error("input agent timeout")); }, ACK_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...event, id })}\n`);
    });
  }

  // A batch keeps one HTTP round trip per gesture burst (pointer moves during a drag).
  async function sendMany(events) {
    const results = [];
    for (const ev of events) {
      try { await send(ev); results.push({ ok: true }); }
      catch (e) { results.push({ ok: false, error: e.message }); }
    }
    return results;
  }

  function warm() { return ensure().catch((e) => log(`warm-up failed: ${e.message}`)); }

  function stop() {
    if (!child) return;
    try { child.stdin.end(); } catch { /* already closed */ }
    const c = child;
    setTimeout(() => { try { c.kill(); } catch { /* gone */ } }, 500);
  }

  function status() { return { running: Boolean(child), pid: child?.pid || 0, ...counts }; }

  return { send, sendMany, warm, stop, status };
}

module.exports = { createPcInput };
