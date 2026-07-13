#!/usr/bin/env node
// Cortex v4 regression suite — turns the failures diagnosed & fixed during the
// brain overhaul into permanent, runnable checks (plan Phase 5: "diagnosed
// failures become regression tests"). Hits the LIVE backend on :8799.
//
//   node scripts/cortex-v4-regression.cjs
//
// Each case sends a prompt and asserts on the streamed final response. These are
// behavioral smoke checks against a real Gemini key, so a couple may be model-
// sensitive; they pin the BEHAVIORS we fixed, not exact wording.

const http = require("http");
const PORT = process.env.JARVIS_PORT || 8799;

function ask(body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api/chat/stream", method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => {
        const lines = d.split("\n").filter((l) => l.trim());
        let done = null;
        for (const l of lines) { try { const e = JSON.parse(l); if (e.type === "done") done = e.result; } catch {} }
        resolve(done || {});
      });
    });
    req.on("error", () => resolve({}));
    req.write(payload); req.end();
  });
}

function get(path) {
  return new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    }).on("error", () => resolve({}));
  });
}

// name, run() → { pass, detail }
const CASES = [
  ["identity: knows Boston (not NY)", async () => {
    const r = await ask({ prompt: "where do I live?", mode: "command" });
    const t = r.response || "";
    return { pass: /boston/i.test(t) && !/new york/i.test(t), detail: t.slice(0, 80) };
  }],
  ["situational: knows the day/time", async () => {
    const r = await ask({ prompt: "what day is it?", mode: "command" });
    return { pass: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(r.response || ""), detail: (r.response || "").slice(0, 80) };
  }],
  ["compute lane: exact math", async () => {
    const r = await ask({ prompt: "what is the standard deviation of 2,4,4,4,5,5,7,9?", mode: "command" });
    return { pass: /\b2(\.0)?\b/.test(r.response || ""), detail: (r.response || "").slice(0, 80) };
  }],
  ["grounding: live fact, no phantom-tool refusal", async () => {
    const r = await ask({ prompt: "what is the latest news about Apple today", mode: "command" });
    const t = r.response || "";
    return { pass: t.length > 40 && !/research.{0,4}(tool|_v2).{0,20}(not available|unavailable)/i.test(t), detail: t.slice(0, 80) };
  }],
  ["model registry: no obsolete 2.x model in answer path", async () => {
    const r = await ask({ prompt: "give me a one sentence fact about the ocean", mode: "command" });
    return { pass: !/gemini-2\.\d/.test(r.model || ""), detail: `model=${r.model}` };
  }],
  ["maps lane: nearby place resolves to Boston", async () => {
    const r = await ask({ prompt: "nearest pharmacy to me", mode: "command" });
    return { pass: /boston|mass ave|massachusetts|\bMA\b/i.test(r.response || ""), detail: (r.response || "").slice(0, 80) };
  }],
  ["HUD: 'open kalshi widget in focus mode' → action, not website", async () => {
    const r = await ask({ prompt: "open the kalshi widget in focus mode", mode: "command" });
    const a = (r.uiActions || [])[0];
    return { pass: a && a.type === "open-widget" && a.id === "kalshi" && a.focus === true, detail: JSON.stringify(r.uiActions) };
  }],
  ["anti-refusal: camera declines gracefully, no raw tool names", async () => {
    const r = await ask({ prompt: "use my camera and tell me what it shows", mode: "command" });
    const t = r.response || "";
    return { pass: !/neural_vault_\w+|coop_symbiote_chat|I have not verified that/.test(t), detail: t.slice(0, 80) };
  }],
  ["private data: no fabricated 'I checked your Kalshi' without a tool", async () => {
    const r = await ask({ prompt: "what are my current kalshi positions?", mode: "command" });
    const t = r.response || "";
    // Acceptable: points to the widget OR honestly can't confirm. NOT acceptable: asserting positions with no tool run.
    const fabricated = /you (currently )?have (no|\d)/i.test(t) && !(r.toolResults || []).length && !/widget/i.test(t);
    return { pass: !fabricated, detail: t.slice(0, 80) };
  }],
  ["tool synthesis: mesh status is prose, not an envelope", async () => {
    const r = await ask({ prompt: "what is my device mesh status?", mode: "command" });
    const t = r.response || "";
    return { pass: t.length > 20 && !/^mesh status: devices \d/i.test(t) && !/completed:/.test(t), detail: t.slice(0, 80) };
  }],
  ["memory: recalls a stored fact as prose", async () => {
    const r = await ask({ prompt: "what do you remember about my dog?", mode: "command" });
    const t = r.response || "";
    return { pass: !/- User:|- JARVIS:/.test(t), detail: t.slice(0, 80) };
  }],
  ["topic hygiene: unrelated Q not hijacked by sticky sports topic", async () => {
    await ask({ prompt: "who plays in the world cup today", mode: "command" }); // prime FIFA
    const r = await ask({ prompt: "what is 15 plus 27?", mode: "command" });
    const t = r.response || "";
    return { pass: /42/.test(t) && !/fifa|world cup|soccer/i.test(t), detail: t.slice(0, 80) };
  }],
  ["endpoint: /api/profile returns the Vault", async () => {
    const p = await get("/api/profile");
    return { pass: p.available && /dev/i.test(p.identity?.preferred_name || ""), detail: p.identity?.preferred_name };
  }],
  ["endpoint: /api/weather keyless returns current temp", async () => {
    const w = await get("/api/weather");
    return { pass: w.available && typeof w.current?.temp === "number", detail: `${w.current?.temp}°` };
  }],
  ["endpoint: /api/system-vitals returns memory %", async () => {
    const v = await get("/api/system-vitals");
    return { pass: v.available && typeof v.memory?.pct === "number", detail: `${v.memory?.pct}%` };
  }],
  ["endpoint: /api/neural-vault/entries returns real memories", async () => {
    const m = await get("/api/neural-vault/entries?limit=3");
    return { pass: Array.isArray(m.entries) && m.entries.length > 0, detail: `${m.entries?.length} entries` };
  }],
];

(async () => {
  console.log(`\nCortex v4 regression suite → 127.0.0.1:${PORT}\n${"=".repeat(56)}`);
  let pass = 0, fail = 0;
  for (const [name, run] of CASES) {
    let result;
    try { result = await run(); } catch (e) { result = { pass: false, detail: `threw: ${e.message}` }; }
    const mark = result.pass ? "PASS" : "FAIL";
    if (result.pass) pass++; else fail++;
    console.log(`  [${mark}] ${name}${result.detail ? `  ·  ${String(result.detail).replace(/\s+/g, " ")}` : ""}`);
  }
  console.log(`${"=".repeat(56)}\n  ${pass}/${pass + fail} passed${fail ? ` · ${fail} FAILED` : " · all green"}\n`);
  process.exit(fail ? 1 : 0);
})();
