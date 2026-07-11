const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function errorWithStatus(message, statusCode = 400, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: options.redirect || "error",
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 1000) };
    }
    if (!response.ok) {
      const message = data?.error_description
        || data?.error?.message
        || data?.errors?.[0]?.message
        || data?.message
        || `Provider request failed (${response.status})`;
      throw errorWithStatus(message, response.status === 401 || response.status === 403 ? 401 : 502, {
        providerStatus: response.status,
      });
    }
    return { data, response };
  } catch (error) {
    if (error.name === "AbortError") throw errorWithStatus("Provider request timed out", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPagedArray(fetchImpl, initialUrl, options = {}, maxItems = 200) {
  const items = [];
  let nextUrl = String(initialUrl);
  const allowedOrigin = new URL(nextUrl).origin;
  for (let page = 0; page < 10 && nextUrl && items.length < maxItems; page += 1) {
    const { data, response } = await fetchJson(fetchImpl, nextUrl, options);
    if (!Array.isArray(data)) throw errorWithStatus("Expected a paginated array response", 502);
    items.push(...data);
    const link = String(response.headers.get("link") || "");
    const next = link.split(",").map((part) => part.trim()).find((part) => /rel="?next"?/i.test(part));
    const match = next?.match(/<([^>]+)>/);
    nextUrl = match?.[1] || "";
    if (nextUrl && new URL(nextUrl).origin !== allowedOrigin) {
      throw errorWithStatus("Cross-origin pagination URL rejected", 502);
    }
  }
  return items.slice(0, maxItems);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function createOAuthStateStore(runtimeDir) {
  const filePath = path.join(runtimeDir, "oauth-states.json");

  function read() {
    try {
      const values = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }

  function active() {
    const now = Date.now();
    const values = read();
    const current = values.filter((item) => new Date(item.expiresAt).getTime() > now);
    if (current.length !== values.length) writeJsonAtomic(filePath, current);
    return current;
  }

  function issue(provider, sessionId, redirectUri) {
    const state = crypto.randomBytes(32).toString("base64url");
    const item = {
      stateHash: crypto.createHash("sha256").update(state).digest("hex"),
      provider,
      sessionId: cleanString(sessionId, 200),
      redirectUri,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    writeJsonAtomic(filePath, [item, ...active()].slice(0, 30));
    return state;
  }

  function consume(provider, state, sessionId) {
    const stateHash = crypto.createHash("sha256").update(cleanString(state, 500)).digest("hex");
    const values = active();
    const item = values.find((entry) => entry.provider === provider && entry.stateHash === stateHash);
    if (!item || !sessionId || item.sessionId !== sessionId) {
      throw errorWithStatus("OAuth state is invalid, expired, or belongs to another browser session", 403);
    }
    writeJsonAtomic(filePath, values.filter((entry) => entry !== item));
    return item;
  }

  return { issue, consume, filePath };
}

module.exports = {
  cleanString,
  createOAuthStateStore,
  errorWithStatus,
  fetchJson,
  fetchPagedArray,
};
