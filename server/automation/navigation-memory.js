"use strict";

const fs = require("fs");
const path = require("path");

const SAFE_LEARN_ACTIONS = new Set(["click", "hover", "scroll", "go_back", "reload", "new_tab", "switch_tab"]);
const CONSEQUENCE_WORDS = /\b(send|post|publish|submit|delete|remove|purchase|buy|sell|pay|checkout|transfer|apply|follow|subscribe|like|create repository|create repo)\b/i;
const PRIVATE_LABEL = /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[a-z0-9_.-]{2,}|\+?\d[\d\s().-]{7,})/i;
const PERSON_LIKE_LABEL = /^[A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){1,3}$/;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function clean(value, max = 180) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value) {
  return clean(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}._/-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function routeSignature(value) {
  try {
    const url = new URL(String(value || ""));
    const pathname = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => (/^(?:\d{3,}|[a-f0-9]{12,}|[a-z0-9_-]{24,})$/i.test(part) ? ":id" : part.toLowerCase()))
      .slice(0, 6)
      .join("/");
    return `${url.origin}/${pathname}`.replace(/\/$/, "");
  } catch {
    // B-20 — the visible-desktop lane has no URL, only a foreground window title, so every
    // non-URL surface returned "" and `safeActionRecord` bailed out before learning anything.
    // That is why outcome memory existed but only the headless browser lane could ever use it.
    // A window title works as a route key once it is normalized and stripped of the volatile
    // document-name prefix most apps put in front ("notes.txt - Notepad" and "todo.txt -
    // Notepad" are the same surface). URLs are untouched — they still take the branch above.
    const surface = normalized(value).split(/\s+[-—|]\s+/).pop();
    return surface ? `surface://${surface}` : "";
  }
}

function semanticElement(element = {}) {
  const rawLabel = clean(element.name || element.text || element.placeholder || element.title || element.ariaLabel, 160);
  if (!rawLabel || PRIVATE_LABEL.test(rawLabel) || PERSON_LIKE_LABEL.test(rawLabel)) return null;
  const label = normalized(rawLabel);
  if (!label) return null;
  return { role: normalized(element.role || element.tag || "control"), label };
}

function safeActionRecord({ snapshot, action, targetElement } = {}) {
  if (!SAFE_LEARN_ACTIONS.has(String(action?.action || ""))) return null;
  const description = `${action?.reason || ""} ${action?.expected || ""} ${targetElement?.name || ""} ${targetElement?.text || ""}`;
  if (CONSEQUENCE_WORDS.test(description) || targetElement?.sensitive) return null;
  const route = routeSignature(snapshot?.url);
  if (!route) return null;
  if (["go_back", "reload", "new_tab", "switch_tab"].includes(action.action)) {
    return { route, action: action.action, role: "navigation", label: action.action };
  }
  const target = semanticElement(targetElement);
  if (!target) return null;
  return { route, action: action.action, ...target };
}

function createNavigationMemory({ runtimeDir, maxEntries = 600, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");
  const filePath = path.join(runtimeDir, "browser-navigation-memory.json");
  let records = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    records = Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    records = [];
  }

  function prune() {
    const cutoff = Date.now() - ttlMs;
    records = records
      .filter((item) => Date.parse(item.updatedAt || 0) >= cutoff)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, maxEntries);
  }

  function persist() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    prune();
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, records }, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  }

  function record({ snapshot, action, targetElement, ok, changed, durationMs = 0, error = "" } = {}) {
    const descriptor = safeActionRecord({ snapshot, action, targetElement });
    if (!descriptor) return { learned: false, reason: "unsafe_or_private_action" };
    const key = `${descriptor.route}|${descriptor.action}|${descriptor.role}|${descriptor.label}`;
    let entry = records.find((item) => item.key === key);
    if (!entry) {
      entry = { key, ...descriptor, successes: 0, failures: 0, changedSuccesses: 0, totalDurationMs: 0, samples: 0, lastErrorClass: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      records.push(entry);
    }
    entry.samples += 1;
    entry.totalDurationMs += Math.max(0, Math.min(Number(durationMs) || 0, 60_000));
    const noProgress = ok && !changed && ["click", "go_back", "reload", "new_tab", "switch_tab"].includes(descriptor.action);
    if (ok && !noProgress) {
      entry.successes += 1;
      if (changed) entry.changedSuccesses += 1;
      entry.lastErrorClass = "";
    } else {
      entry.failures += 1;
      entry.lastErrorClass = noProgress ? "no_observable_progress" : /stale|detached/i.test(error) ? "stale_target" : /timeout|not visible/i.test(error) ? "unavailable_target" : "action_failed";
    }
    entry.updatedAt = new Date().toISOString();
    try { persist(); } catch { /* learning must never break task execution */ }
    return { learned: true, key, samples: entry.samples };
  }

  function hints(snapshot = {}, { limit = 8 } = {}) {
    prune();
    const route = routeSignature(snapshot.url);
    if (!route) return [];
    const candidates = [];
    for (const element of snapshot.elements || []) {
      const semantic = semanticElement(element);
      if (!semantic) continue;
      for (const entry of records) {
        if (entry.route !== route || entry.role !== semantic.role || entry.label !== semantic.label) continue;
        const attempts = entry.successes + entry.failures;
        const successRate = attempts ? entry.successes / attempts : 0;
        const changeRate = entry.successes ? entry.changedSuccesses / entry.successes : 0;
        const confidence = Math.min(0.99, Math.max(0.05, ((successRate * 0.7) + (changeRate * 0.3)) * Math.min(1, attempts / 3)));
        candidates.push({
          ref: element.ref,
          action: entry.action,
          role: entry.role,
          label: entry.label,
          attempts,
          successes: entry.successes,
          failures: entry.failures,
          averageDurationMs: entry.samples ? Math.round(entry.totalDurationMs / entry.samples) : 0,
          confidence: Number(confidence.toFixed(3)),
          recommendation: entry.failures > entry.successes ? "avoid_unless_page_evidence_changed" : "previously_effective_route",
          lastErrorClass: entry.lastErrorClass || null,
        });
      }
    }
    return candidates.sort((left, right) => right.confidence - left.confidence || right.attempts - left.attempts).slice(0, limit);
  }

  function status() {
    prune();
    return { version: 1, filePath, entries: records.length, successes: records.reduce((sum, item) => sum + item.successes, 0), failures: records.reduce((sum, item) => sum + item.failures, 0) };
  }

  return { filePath, hints, record, status };
}

module.exports = { DEFAULT_TTL_MS, SAFE_LEARN_ACTIONS, createNavigationMemory, routeSignature, safeActionRecord, semanticElement };
