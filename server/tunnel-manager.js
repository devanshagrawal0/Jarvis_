"use strict";

/**
 * Tunnel Manager — Cloudflare Quick Tunnel auto-start.
 * Gives every Jarvis instance a public HTTPS URL automatically,
 * so phone pairing QR codes work from any network, zero config.
 *
 * Strategy (in order):
 *   1. npm `cloudflared` package (JacobLinCool) — downloads binary on first run
 *   2. `cloudflared` binary already in PATH
 *   3. Graceful no-op (LAN-only fallback)
 */

const { spawn } = require("child_process");
const path = require("path");
const { EventEmitter } = require("events");

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const RESTART_DELAY_MS = 6000;
const STARTUP_TIMEOUT_MS = 25000;

class TunnelManager extends EventEmitter {
  constructor() {
    super();
    this._url = null;
    this._proc = null;
    this._restartTimer = null;
    this._port = null;
    this._stopped = false;
    this._startCount = 0;
  }

  get url() { return this._url; }
  get active() { return Boolean(this._url); }

  async start(port) {
    this._port = port;
    this._stopped = false;

    // Try npm cloudflared package first (handles binary download automatically)
    const npmResult = await this._tryNpmPackage(port);
    if (npmResult) return npmResult;

    // Fall back to cloudflared in PATH
    const pathResult = await this._tryBinaryInPath(port);
    if (pathResult) return pathResult;

    console.warn("[tunnel] cloudflared not found. Phone pairing will require LAN/manual URL.");
    console.warn("[tunnel] Install: npm install -g cloudflared  OR  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation");
    return null;
  }

  async _tryNpmPackage(port) {
    try {
      // The `cloudflared` npm package's value is auto-downloading the binary.
      // It exports `bin` (absolute path to the downloaded cloudflared executable).
      // We spawn that binary exactly like _tryBinaryInPath, just with the explicit path.
      const { bin } = require("cloudflared");
      if (!bin) return null;
      const fs = require("fs");
      if (!fs.existsSync(bin)) return null;
      return await this._spawnBinary(bin, port, "npm-cloudflared");
    } catch {
      return null;
    }
  }

  async _tryBinaryInPath(port) {
    return this._spawnBinary("cloudflared", port, "path-binary");
  }

  async _spawnBinary(binaryPath, port, source) {
    return new Promise((resolve) => {
      this._startCount++;
      let resolved = false;

      const proc = spawn(binaryPath, [
        "tunnel",
        "--url", `http://localhost:${port}`,
        "--no-autoupdate",
        "--metrics", "localhost:0",
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      this._proc = proc;
      this._source = source;

      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(null); }
      }, STARTUP_TIMEOUT_MS);

      const onData = (chunk) => {
        const text = chunk.toString();
        const match = text.match(TUNNEL_URL_PATTERN);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          this._url = match[0];
          console.log(`[tunnel] ✓ Quick Tunnel (${source}): ${this._url}`);
          this.emit("url", this._url);
          resolve(this._url);
        }
      };

      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);

      proc.on("error", () => {
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve(null); }
      });

      proc.on("exit", (code) => {
        if (this._stopped) return;
        this._url = null;
        this.emit("disconnected", { code });
        this._restartTimer = setTimeout(() => this._spawnBinary(binaryPath, port, source), RESTART_DELAY_MS);
      });
    });
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._restartTimer);
    this._url = null;
    if (this._proc) {
      try {
        if (typeof this._proc.stop === "function") this._proc.stop();
        else if (typeof this._proc.kill === "function") this._proc.kill("SIGTERM");
      } catch {}
      this._proc = null;
    }
  }

  /** Status payload for API responses / UI */
  status() {
    return {
      active: this.active,
      url: this._url,
      startCount: this._startCount,
      source: this._url ? (this._source || "cloudflare-quick-tunnel") : "unavailable",
    };
  }
}

const tunnelManager = new TunnelManager();

module.exports = {
  tunnelManager,
  startTunnel: (port) => tunnelManager.start(port),
  stopTunnel: () => tunnelManager.stop(),
  getTunnelUrl: () => tunnelManager.url,
  isTunnelActive: () => tunnelManager.active,
  getTunnelStatus: () => tunnelManager.status(),
};
