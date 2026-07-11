"use strict";
/* Shared fetch helper for APEX adapters — timeout + default User-Agent
   (SEC EDGAR requires a descriptive UA or it blocks requests). CommonJS. */

const DEFAULT_UA = "MangoTrades-APEX/1.0 (personal research; contact via app)";

async function fetchJson(url, { headers, method = "GET", body, timeoutMs = 15000, accept = "application/json" } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "user-agent": DEFAULT_UA, accept, ...(headers || {}) },
      body,
      signal: ctrl.signal,
      redirect: "follow",
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 2000) }; }
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
      e.status = res.status; e.data = data; throw e;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") { const e = new Error(`timeout after ${timeoutMs}ms`); e.status = 504; throw e; }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(url, { headers: { "user-agent": DEFAULT_UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`); e.status = res.status; throw e; }
    return text;
  } finally { clearTimeout(timer); }
}

module.exports = { fetchJson, fetchText, DEFAULT_UA };
