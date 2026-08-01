"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function defaultMemoryVNextRoot(env = process.env) {
  const local = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "Jarvis", "memory-vNext", "core");
}

function ensureProtectedRuntimePath(runtimeDir = defaultMemoryVNextRoot(), options = {}) {
  const resolved = path.resolve(runtimeDir);
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, "..", "..", ".."));
  if (!options.allowUnsafeTestPath) {
    if (isInside(workspaceRoot, resolved)) throw new Error("Memory vNext runtime must not live inside the repository.");
    if (resolved.toLocaleLowerCase("en-US").includes(`${path.sep}onedrive${path.sep}`)) {
      throw new Error("Memory vNext runtime must not live inside OneDrive.");
    }
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(resolved, 0o700); } catch {}
  const real = fs.realpathSync(resolved);
  if (real !== resolved && !options.allowUnsafeTestPath) {
    throw new Error("Memory vNext runtime path must not resolve through an unexpected link.");
  }
  return resolved;
}

module.exports = { defaultMemoryVNextRoot, ensureProtectedRuntimePath, isInside };
