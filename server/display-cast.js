"use strict";

// DISPLAY CAST — the shared in-memory state for the phone "Display" surface.
// Main Jarvis (the brain, via the display_cast tool) or an owner HTTP call sets the current cast;
// the phone Display tab polls /api/display/current and renders it. One cast at a time (v1: a single
// phone display). Node caches this module, so server.js and capability-engine.js see the same state.

let current = null; // { kind, url?, html?, view?, data?, quality?, title?, at, id }
let seq = 0;

function clip(v, n) { return v == null ? undefined : String(v).slice(0, n); }

function setCast(payload) {
  if (!payload || payload.kind === "clear") { current = null; return { ok: true, cast: null }; }
  const kind = String(payload.kind || "");
  if (!["web", "stream", "view"].includes(kind)) return { ok: false, error: `unknown cast kind "${kind}" — use web, stream, view, or clear` };
  const cast = { kind, at: Date.now(), id: ++seq };
  if (kind === "web") {
    if (payload.url) cast.url = clip(payload.url, 4000);
    if (payload.html) cast.html = clip(payload.html, 600000);
    if (!cast.url && !cast.html) return { ok: false, error: "web cast needs a url or html" };
    cast.title = clip(payload.title, 120);
  } else if (kind === "stream") {
    cast.quality = clip(payload.quality, 20) || "auto";
    cast.title = clip(payload.title, 120) || "Live from your PC";
  } else if (kind === "view") {
    cast.view = clip(payload.view, 60);
    cast.data = payload.data ?? null;
    if (!cast.view) return { ok: false, error: "view cast needs a view name" };
    cast.title = clip(payload.title, 120);
  }
  current = cast;
  return { ok: true, cast };
}

function getCast() { return current; }
function clearCast() { current = null; return { ok: true, cast: null }; }

module.exports = { setCast, getCast, clearCast };
