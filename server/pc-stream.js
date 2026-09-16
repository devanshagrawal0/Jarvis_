"use strict";

// Phone takeover stream: the PC desktop as real-time video (WebRTC) instead of polled JPEGs.
//
//   ffmpeg (ddagrab → GPU scale → h264_amf, ~100 ms) ──WHIP──▶ MediaMTX (:8889 / UDP :8189)
//   phone <video> ◀──WHEP (signalling proxied through :8799, media straight over the tailnet)──┘
//
// This module owns both processes: it starts MediaMTX if it is not already listening, starts and
// stops the ffmpeg publisher, parses ffmpeg's own stats line for the live fps/bitrate, and stops
// the publisher on its own when no viewer has asked for the stream for a while (a stream nobody
// watches still costs an encoder). Nothing here talks to the phone directly — server.js exposes it.

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const MEDIAMTX_PORT = 8889;
const STREAM_PATH = "pc";
const IDLE_STOP_MS = 90_000;

const FFMPEG_CANDIDATES = [
  process.env.JARVIS_FFMPEG,
  "C:\\Users\\Devansh\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe",
  "ffmpeg",
].filter(Boolean);

function findFfmpeg() {
  for (const candidate of FFMPEG_CANDIDATES) {
    if (candidate === "ffmpeg") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

// Quality presets are the whole knob the phone gets. Bitrate is what the tailnet (WireGuard over
// Wi-Fi/LTE) has to carry; resolution is what the AMF encoder has to chew per frame.
const PRESETS = {
  best: { width: 1920, height: 1080, fps: 60, bitrate: "10M", bufsize: "1500k" },
  balanced: { width: 1920, height: 1080, fps: 30, bitrate: "6M", bufsize: "1M" },
  light: { width: 1280, height: 720, fps: 60, bitrate: "5M", bufsize: "700k" },
};

function probe(port, pathname, method = "GET", timeout = 800) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, timeout }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", () => resolve(0));
    req.on("timeout", () => { req.destroy(); resolve(0); });
    req.end();
  });
}

function createPcStream({ toolsDir, runtimeDir, log = () => {} } = {}) {
  const mediamtxDir = path.join(toolsDir, "mediamtx");
  const mediamtxExe = path.join(mediamtxDir, process.platform === "win32" ? "mediamtx.exe" : "mediamtx");
  const logDir = path.join(runtimeDir, "pc-stream");
  fs.mkdirSync(logDir, { recursive: true });

  let mediamtx = null;      // child we spawned (null if one was already running outside us)
  let publisher = null;     // ffmpeg child
  let preset = "balanced";
  let startedAt = "";
  let lastViewerAt = 0;
  let lastError = "";
  let stats = { frame: 0, fps: 0, bitrateKbps: 0, speed: 0, at: 0 };
  let idleTimer = null;
  let stderrTail = [];

  async function mediamtxListening() {
    // Any HTTP answer at all means the WebRTC server is up (the player page is served at /pc/).
    return (await probe(MEDIAMTX_PORT, `/${STREAM_PATH}/`)) > 0;
  }

  async function ensureMediamtx() {
    if (await mediamtxListening()) return true;
    if (!fs.existsSync(mediamtxExe)) throw new Error(`MediaMTX not installed at ${mediamtxExe}`);
    const out = fs.openSync(path.join(logDir, "mediamtx.log"), "a");
    mediamtx = spawn(mediamtxExe, [path.join(mediamtxDir, "mediamtx.yml")], { cwd: mediamtxDir, stdio: ["ignore", out, out], windowsHide: true, detached: false });
    mediamtx.on("exit", (code) => { log(`mediamtx exited (${code})`); mediamtx = null; });
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      if (await mediamtxListening()) return true;
    }
    throw new Error("MediaMTX did not start listening on :8889");
  }

  // ffmpeg prints one "frame= 1234 fps= 60 ... bitrate=8000.0kbits/s ... speed=1x" line per second
  // on stderr (carriage-return separated). That line IS the health signal; there is no other.
  function parseStats(chunk) {
    const text = String(chunk);
    stderrTail = stderrTail.concat(text.split(/\r?\n|\r/).filter(Boolean)).slice(-30);
    const m = /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?bitrate=\s*([\d.]+)kbits\/s.*?speed=\s*([\d.]+)x/s.exec(text);
    if (m) stats = { frame: Number(m[1]), fps: Number(m[2]), bitrateKbps: Number(m[3]), speed: Number(m[4]), at: Date.now() };
  }

  function armIdleStop() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (publisher && Date.now() - lastViewerAt >= IDLE_STOP_MS) { log("no viewer for 90 s — stopping the publisher"); void stop("idle"); }
      else if (publisher) armIdleStop();
    }, IDLE_STOP_MS + 1000);
  }

  async function streamReady() {
    // MediaMTX answers a WHEP POST for a path with no publisher with 404; anything else means the
    // track is there (a 400 for our empty body is the expected "ready" answer).
    const code = await probe(MEDIAMTX_PORT, `/${STREAM_PATH}/whep`, "POST");
    return code > 0 && code !== 404;
  }

  async function start({ quality = "balanced" } = {}) {
    lastViewerAt = Date.now();
    if (publisher) { armIdleStop(); return status(); }
    // Wait for any in-flight stop to finish first. ddagrab (Desktop Duplication) allows only a
    // limited number of live capturers, so spawning a new ffmpeg while the previous one is still
    // dying makes BOTH run at ~0.01x and produce no frames — the "did not start streaming" flake.
    if (stoppingPromise) { try { await stoppingPromise; } catch { /* it's gone either way */ } }
    if (publisher) { armIdleStop(); return status(); }
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) throw new Error("ffmpeg is not installed on the PC");
    await ensureMediamtx();
    preset = PRESETS[quality] ? quality : "balanced";
    const p = PRESETS[preset];
    lastError = "";
    stats = { frame: 0, fps: 0, bitrateKbps: 0, speed: 0, at: 0 };
    stderrTail = [];
    const args = [
      "-hide_banner", "-nostdin", "-loglevel", "warning", "-stats",
      "-init_hw_device", "d3d11va", "-filter_threads", "4",
      // Desktop Duplication → system memory → CPU scale → libx264. Diagnosed 2026-09-16 end to end:
      // the AMD GPU encoder (h264_amf) delivered 6 MB of RTP but the WebRTC decoder assembled ZERO
      // frames (framesReceived 0, endless PLI) — h264_amf's bitstream is not WebRTC-decodable, and
      // no profile/level/SPS tweak fixed it. libx264 through the identical pipeline decoded the real
      // desktop at 1920×1080 (framesReceived 189). baseline profile + zerolatency, no B-frames
      // (WebRTC forbids them). ~1 core at 1080p30, ~all-core headroom to 1080p60.
      "-filter_complex", `ddagrab=framerate=${p.fps}:draw_mouse=1,hwdownload,format=bgra,scale=${p.width}:${p.height}:flags=bilinear:threads=4,format=yuv420p`,
      "-c:v", "libx264", "-profile:v", "baseline", "-preset", "ultrafast", "-tune", "zerolatency",
      "-b:v", p.bitrate, "-maxrate", p.bitrate, "-bufsize", p.bufsize,
      "-g", String(p.fps * 2), "-bf", "0", "-bsf:v", "dump_extra=freq=keyframe",
      "-f", "whip", `http://127.0.0.1:${MEDIAMTX_PORT}/${STREAM_PATH}/whip`,
    ];
    publisher = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    startedAt = new Date().toISOString();
    // full stderr to disk — the only place ffmpeg explains a failed capture or handshake
    const ffLog = fs.createWriteStream(path.join(logDir, "ffmpeg.log"), { flags: "a" });
    ffLog.write(`\n--- ${startedAt} ${args.join(" ")}\n`);
    publisher.stderr.on("data", (c) => { ffLog.write(c); parseStats(c); });
    publisher.on("close", () => ffLog.end());
    publisher.on("exit", (code, signal) => {
      const tail = stderrTail.slice(-4).join(" | ");
      if (code && code !== 0) lastError = `ffmpeg exited (${code}): ${tail}`;
      log(`publisher exited code=${code} signal=${signal} ${tail}`);
      publisher = null;
      clearTimeout(idleTimer);
    });
    // Ready = MediaMTX has the path AND ffmpeg is actually encoding real frames. A stalled ddagrab
    // still registers the path (so streamReady alone passes) but emits ~1 frame, so also require the
    // frame counter to advance. If neither happens in ~8 s, kill it and fail loudly.
    let ready = false;
    for (let i = 0; i < 55; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      if (!publisher) break;
      if (stats.frame > 15 && (await streamReady())) { ready = true; break; }
    }
    if (!ready && publisher) {
      const stalled = stats.frame <= 15;
      log(`start failed (frames=${stats.frame}) — killing`);
      await stop("stalled-start");
      throw new Error(stalled ? "The screen encoder stalled (another capture may be running). Try again." : "The stream did not come online.");
    }
    armIdleStop();
    return status();
  }

  let stoppingPromise = null;
  async function stop(reason = "requested") {
    clearTimeout(idleTimer);
    const child = publisher;
    if (!child) return status();
    log(`stopping publisher (${reason})`);
    stoppingPromise = new Promise((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      try { child.kill(); } catch { done(); }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } done(); }, 2500);
    });
    await stoppingPromise;
    stoppingPromise = null;
    publisher = null;
    return status();
  }

  function viewerSeen() { lastViewerAt = Date.now(); }

  function status() {
    const p = PRESETS[preset];
    const fresh = stats.at && Date.now() - stats.at < 4000;
    return {
      running: Boolean(publisher),
      pid: publisher?.pid || 0,
      preset,
      width: p.width, height: p.height, targetFps: p.fps, targetBitrate: p.bitrate,
      startedAt,
      fps: fresh ? stats.fps : 0,
      bitrateKbps: fresh ? stats.bitrateKbps : 0,
      frames: stats.frame,
      error: lastError,
      mediamtx: { exe: mediamtxExe, spawnedByUs: Boolean(mediamtx) },
      ffmpeg: findFfmpeg() ? "installed" : "missing",
      whepPath: `/${STREAM_PATH}/whep`,
    };
  }

  // WHEP signalling proxy. The phone only ever talks to :8799 (same origin, owner-authenticated);
  // this forwards the SDP exchange to MediaMTX and rewrites the resource Location so PATCH/DELETE
  // come back through the same door. Media flows UDP phone ↔ :8189 directly.
  function proxyWhep(req, res, { subpath = "", publicBase }) {
    viewerSeen();
    const target = `/${STREAM_PATH}/whep${subpath}`;
    const headers = { "content-type": req.headers["content-type"] || "application/sdp" };
    if (req.headers["if-match"]) headers["if-match"] = req.headers["if-match"];
    const up = http.request({ host: "127.0.0.1", port: MEDIAMTX_PORT, path: target, method: req.method, headers, timeout: 8000 }, (r) => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) {
        if (k === "location" && typeof v === "string") out.location = v.replace(new RegExp(`^(?:https?://[^/]+)?/${STREAM_PATH}/whep`), publicBase);
        else if (["content-type", "etag", "accept-patch"].includes(k)) out[k] = v;
      }
      res.writeHead(r.statusCode || 502, out);
      r.pipe(res);
    });
    up.on("error", (e) => { if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: `stream server unreachable: ${e.message}` })); });
    up.on("timeout", () => up.destroy(new Error("timeout")));
    req.pipe(up);
  }

  async function shutdown() { await stop("shutdown"); if (mediamtx) { try { mediamtx.kill(); } catch { /* gone */ } } }

  return { start, stop, status, viewerSeen, proxyWhep, shutdown, PRESETS };
}

module.exports = { createPcStream, PRESETS };
