"use strict";

// Real facts about this PC for the phone's Control tab — each one read from the machine, cached
// for as long as it can reasonably be trusted, never estimated:
//   audio   master volume / mute (CoreAudio worker, pc-audio.ps1)          live
//   displays count + resolutions (node-screenshots)                         30 s
//   power   the active Windows power plan (powercfg)                        60 s, and set
const path = require("path");
const { spawn, execFile } = require("child_process");

const AUDIO_SCRIPT = path.join(__dirname, "pc-audio.ps1");

function createPcFacts({ log = () => {} } = {}) {
  // ── audio worker ──
  let audio = null, audioReady = null, audioBuf = "";
  const audioQueue = [];
  function audioEnsure() {
    if (audio) return audioReady;
    let resolve, reject;
    audioReady = new Promise((ok, no) => { resolve = ok; reject = no; });
    audio = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", AUDIO_SCRIPT], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    audio.on("error", (e) => { log(`audio worker spawn error: ${e.message}`); audio = null; reject(new Error(e.message)); });
    audio.stdin.on("error", () => {});
    audio.stdout.setEncoding("utf8");
    audio.stdout.on("data", (chunk) => {
      audioBuf += chunk;
      let nl;
      while ((nl = audioBuf.indexOf("\n")) >= 0) {
        const line = audioBuf.slice(0, nl).trim(); audioBuf = audioBuf.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) { resolve(); continue; }
        const w = audioQueue.shift(); if (w) { clearTimeout(w.timer); msg.ok ? w.resolve(msg) : w.reject(new Error(msg.error || "audio")); }
      }
    });
    audio.stderr.on("data", (t) => log(`audio worker: ${String(t).trim().slice(0, 200)}`));
    audio.on("exit", (code) => { log(`audio worker exited (${code})`); audio = null; for (const w of audioQueue.splice(0)) w.reject(new Error("audio worker exited")); reject(new Error("audio worker exited")); });
    return audioReady;
  }
  async function audioCmd(cmd) {
    await audioEnsure();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const i = audioQueue.findIndex((w) => w.resolve === resolve); if (i >= 0) audioQueue.splice(i, 1); reject(new Error("audio timeout")); }, 4000);
      audioQueue.push({ resolve, reject, timer });
      audio.stdin.write(`${cmd}\n`);
    });
  }
  const getAudio = () => audioCmd("get").then((m) => ({ volume: m.volume, muted: m.muted })).catch(() => null);
  const setVolume = (v) => audioCmd(`set ${Math.max(0, Math.min(1, Number(v) || 0)).toFixed(3)}`).then((m) => ({ volume: m.volume, muted: m.muted }));
  const setMute = (m) => audioCmd(`mute ${m ? 1 : 0}`).then((r) => ({ volume: r.volume, muted: r.muted }));

  // ── displays ──
  let displaysCache = { at: 0, value: [] };
  function displays() {
    if (Date.now() - displaysCache.at < 30000) return displaysCache.value;
    try {
      const { Monitor } = require("node-screenshots");
      displaysCache = { at: Date.now(), value: Monitor.all().map((m) => ({ width: m.width(), height: m.height(), x: m.x(), y: m.y(), primary: Boolean(m.isPrimary?.()), scale: Number(m.scaleFactor?.() || 1) })) };
    } catch { displaysCache = { at: Date.now(), value: [] }; }
    return displaysCache.value;
  }

  // ── power plan ──
  let powerCache = { at: 0, value: null };
  function powercfg(args) {
    return new Promise((resolve, reject) => execFile("powercfg.exe", args, { timeout: 4000, windowsHide: true }, (err, out) => err ? reject(err) : resolve(String(out || ""))));
  }
  async function powerPlan() {
    if (Date.now() - powerCache.at < 60000 && powerCache.value) return powerCache.value;
    try {
      const active = await powercfg(["/getactivescheme"]);   // "Power Scheme GUID: <guid>  (Balanced)"
      const list = await powercfg(["/list"]);
      const plans = [...list.matchAll(/GUID:\s*([0-9a-f-]{36})\s+\(([^)]+)\)/gi)].map((m) => ({ id: m[1].toLowerCase(), name: m[2] }));
      const cur = /GUID:\s*([0-9a-f-]{36})/i.exec(active);
      powerCache = { at: Date.now(), value: { active: cur ? cur[1].toLowerCase() : "", plans } };
    } catch { powerCache = { at: Date.now(), value: { active: "", plans: [] } }; }
    return powerCache.value;
  }
  async function setPowerPlan(id) {
    const plan = (await powerPlan()).plans.find((p) => p.id === String(id).toLowerCase());
    if (!plan) throw new Error("No such power plan.");
    await powercfg(["/setactive", plan.id]);
    powerCache.at = 0;
    return powerPlan();
  }

  function stop() { try { audio?.stdin.end(); } catch { /* closed */ } }

  return { getAudio, setVolume, setMute, displays, powerPlan, setPowerPlan, stop };
}

module.exports = { createPcFacts };
