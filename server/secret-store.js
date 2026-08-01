const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SECRET_FIELDS = new Set([
  "geminiKey",
  "openaiKey",
  "higgsfieldKey",
  "githubToken",
  "kalshiKeyId",
  "kalshiPrivateKey",
  "canvasClientSecret",
  "canvasRefreshToken",
  "canvasToken",
  "figmaAccessToken",
  "googleAccessToken",
  "googleClientSecret",
  "googleRefreshToken",
  "newsApiKey",
  "instagramAccessToken",
  "instagramAccountId",
  "playwrightExtensionToken",
]);

function runPowerShell(script, input = "") {
  return execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { input, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
  ).trim();
}

function createSecretStore(runtimeDir) {
  const filePath = path.join(runtimeDir, "secrets.dpapi");
  let cache;

  function decrypt() {
    if (cache) return { ...cache };
    if (!fs.existsSync(filePath)) {
      cache = {};
      return {};
    }
    if (process.platform !== "win32") throw new Error("The local secret vault requires Windows DPAPI");
    const encrypted = fs.readFileSync(filePath, "utf8").trim();
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$cipher=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
      "$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Text.Encoding]::UTF8.GetString($plain)",
    ].join(";");
    cache = JSON.parse(runPowerShell(script, encrypted) || "{}");
    return { ...cache };
  }

  function encrypt(values) {
    if (process.platform !== "win32") throw new Error("The local secret vault requires Windows DPAPI");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const serialized = JSON.stringify(values);
    const script = [
      "Add-Type -AssemblyName System.Security",
      "$plain=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())",
      "$cipher=[System.Security.Cryptography.ProtectedData]::Protect($plain,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
      "[Convert]::ToBase64String($cipher)",
    ].join(";");
    const encrypted = runPowerShell(script, serialized);
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, encrypted, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
    cache = { ...values };
  }

  function save(patch) {
    const current = decrypt();
    for (const [key, value] of Object.entries(patch || {})) {
      if (!SECRET_FIELDS.has(key)) continue;
      if (typeof value === "string" && value.trim()) current[key] = value.trim();
      else if (value === null) delete current[key];
    }
    encrypt(current);
    return { ...current };
  }

  function split(values) {
    const publicValues = {};
    const secretValues = {};
    for (const [key, value] of Object.entries(values || {})) {
      if (SECRET_FIELDS.has(key)) secretValues[key] = value;
      else publicValues[key] = value;
    }
    return { publicValues, secretValues };
  }

  return { load: decrypt, save, split, fields: SECRET_FIELDS, filePath };
}

module.exports = { createSecretStore, SECRET_FIELDS };
