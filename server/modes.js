"use strict";

// One-tap game modes. The phone slide calls /api/modes/run; this runs the chain on the PC:
// takeover cinematic -> display 1080p·320Hz -> default audio A20 X -> launch the game -> read RAM,
// then the cinematic closes the moment the game window actually appears.
// (No internet/network tuning yet — that comes later.)

const { execFile } = require("child_process");
const path = require("path");
const os = require("os");

const TOOLS = path.join(__dirname, "..", "tools", "modes");
const PUBLIC = path.join(__dirname, "..", "public");

function ps(args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args],
      { timeout, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: String(stdout || "").trim(), err: String(stderr || (err && err.message) || "").trim() });
      });
  });
}
const psFile = (file, args = []) => ps(["-File", path.join(TOOLS, file), ...args]);
const psCmd = (cmd) => ps(["-Command", cmd]);
const clip = (s, n = 90) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function closeTakeoverWhenReady(udd) {
  const t0 = Date.now(), MAX = 55000;
  try {
    while (Date.now() - t0 < MAX) {
      const r = await psCmd("(Get-Process 'VALORANT-Win64-Shipping' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count");
      if (r.ok && parseInt(r.out || "0", 10) > 0) { await wait(1400); break; } // game window is up
      await wait(1500);
    }
  } catch { /* ignore */ }
  await psFile("close-takeover.ps1", [udd]).catch(() => {});
}

// Riot forces every launch through RiotClientServices; --launch-product boots Valorant itself
// (not just the client home). Lands on Valorant's own menu — we do NOT auto-click PLAY (Vanguard).
const RIOT_PATHS = [
  "C:\\Riot Games\\Riot Client\\RiotClientServices.exe",
  "$env:ProgramFiles\\Riot Games\\Riot Client\\RiotClientServices.exe",
  "${env:ProgramFiles(x86)}\\Riot Games\\Riot Client\\RiotClientServices.exe",
];

async function runValorant() {
  const steps = [];

  // 1) throw up the fullscreen cinematic first, forced to the foreground, so it covers the sequence
  const udd = path.join(os.tmpdir(), "jarvis-takeover-" + Date.now());
  await psFile("takeover.ps1", [fileUrl(path.join(PUBLIC, "mode-takeover.html")), udd]).catch(() => {});
  await wait(400);

  // (no display step: the H27P6's 1080p·320Hz dual mode is a monitor-side OSD toggle that isn't
  // reachable over the display API or DDC/CI — verified. 320Hz stays a one-click joystick switch.)

  // 2) default audio -> A20 X game endpoint (matched by interface name, not the "A20 X Chat" one)
  const audio = await psFile("set-audio.ps1", ["A20 X"]);
  steps.push({ step: "audio", ok: audio.ok, detail: audio.ok ? (clip(audio.out) || "A20 X") : clip(audio.err) || "failed" });

  // 3) launch Valorant via Riot Client with the product/patchline args.
  // A Riot Client already running in background swallows the launch args and just shows its home,
  // so we KILL every Riot Client process first, then a fresh start boots straight into Valorant.
  // (We do NOT kill VALORANT/Vanguard if the game is somehow already up.)
  const cand = RIOT_PATHS.map((p) => `"${p}"`).join(",");
  const launchCmd =
    `Get-Process -Name 'RiotClientServices','RiotClientUx','Riot Client','RiotClientCrashHandler' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; ` +
    `Start-Sleep -Milliseconds 2500; ` +
    `$c=@(${cand}); $exe=$c | Where-Object { Test-Path $_ } | Select-Object -First 1; ` +
    `if ($exe) { Start-Process -FilePath $exe -ArgumentList '--launch-product=valorant','--launch-patchline=live'; 'launched ' + $exe } ` +
    `else { throw 'RiotClientServices.exe not found' }`;
  const launch = await psCmd(launchCmd, 15000);
  steps.push({ step: "launch", ok: launch.ok, detail: launch.ok ? clip(launch.out) || "Valorant opening" : clip(launch.err) || "failed" });

  // 4) RAM readout
  const ram = await psCmd("$o=Get-CimInstance Win32_OperatingSystem; [math]::Round($o.FreePhysicalMemory/1MB,1)");
  steps.push({ step: "system", ok: ram.ok, detail: ram.ok ? `${ram.out} GB RAM free` : "n/a" });

  // 5) let the cinematic ride until the game window shows, then close it (don't block the response)
  void closeTakeoverWhenReady(udd);

  const ok = steps.filter((s) => s.step === "audio" || s.step === "launch").every((s) => s.ok);
  return { ok, steps };
}

const MODES = { valorant: runValorant };

async function runMode(id) {
  const fn = MODES[String(id || "").toLowerCase()];
  if (!fn) return { ok: false, error: `unknown mode "${id}"` };
  return fn();
}

module.exports = { runMode };
