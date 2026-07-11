const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

function createWindowsBrokerClient(rootDir) {
  const token = crypto.randomBytes(32).toString("base64url");
  const pending = new Map();
  let child;
  let sequence = 0;

  function start() {
    if (child && !child.killed) return;
    child = spawn(process.execPath, [path.join(rootDir, "server", "windows-broker-service.js")], {
      cwd: rootDir,
      env: { ...process.env, JARVIS_BROKER_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.ok) request.resolve(message.result);
        else request.reject(new Error(message.error || "Windows broker failed"));
      } catch {
        // Ignore malformed broker output; each request still has a timeout.
      }
    });
    child.on("exit", () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Windows broker stopped"));
      }
      pending.clear();
      child = null;
    });
  }

  function call(method, params = {}, timeoutMs = 35000) {
    start();
    const id = `${process.pid}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Windows broker timed out running ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, token, method, params })}\n`);
    });
  }

  return {
    call,
    health: () => call("health"),
    stop() {
      if (child && !child.killed) child.kill();
      child = null;
    },
  };
}

module.exports = { createWindowsBrokerClient };
