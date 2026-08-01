"use strict";

const { spawnSync } = require("node:child_process");

const PROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$bytes=[Convert]::FromBase64String($raw)",
  "$out=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($out))",
].join(";");

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$raw=[Console]::In.ReadToEnd()",
  "$bytes=[Convert]::FromBase64String($raw)",
  "$out=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($out))",
].join(";");

function runDpapi(script, bytes, powershellPath) {
  const result = spawnSync(powershellPath, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    input: Buffer.from(bytes).toString("base64"),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    throw new Error("Windows current-user key protection failed.");
  }
  return Buffer.from(String(result.stdout).trim(), "base64");
}

function createWindowsDpapiProtector({ powershellPath = "powershell.exe", platform = process.platform } = {}) {
  if (platform !== "win32") throw new Error("DPAPI current-user protection is only available on Windows.");
  return Object.freeze({
    id: "windows-dpapi-current-user-v1",
    protect(bytes) { return runDpapi(PROTECT_SCRIPT, bytes, powershellPath); },
    unprotect(bytes) { return runDpapi(UNPROTECT_SCRIPT, bytes, powershellPath); },
  });
}

module.exports = { createWindowsDpapiProtector };
