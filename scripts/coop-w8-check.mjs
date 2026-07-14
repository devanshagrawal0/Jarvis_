// Synapse W8 — required-features hardening + Session Intelligence acceptance. Unit-checks recap /
// metrics / export, then drives a live server: invite-code rotation (old code invalidated),
// moderation (kick a guest → lease revoked), ability toggles, export (MD+JSON w/ decisions), and
// data wipe (soft-delete: content cleared, tombstone kept, no longer active). Exit non-zero on fail.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SI = require(path.join(ROOT, "server", "coop-intelligence.js"));

let pass = 0;
const ok = (n, d = "") => { pass++; console.log(`PASS ${n}${d ? ` — ${d}` : ""}`); };

// ---- 1) Session Intelligence units ----
{
  const session = {
    id: "s1", title: "T", mode: "Pair Build Mode", peerName: "Aryan", createdAt: new Date(Date.now() - 600000).toISOString(),
    chat: [{ senderName: "Dev", text: "hi" }, { senderName: "Aryan", text: "yo" }],
    patches: [{ filePath: "a.js", summary: "x", status: "applied" }, { filePath: "b.js", summary: "y", status: "proposed", review: { verdict: "warn" } }],
    tasks: [{ title: "do it", status: "Todo" }],
    timeline: [{ eventType: "patch_applied", timestamp: new Date().toISOString(), actor: "Dev", payload: { filePath: "a.js" } }, { eventType: "join_approved", timestamp: new Date().toISOString(), actor: "Dev", payload: { peerName: "Aryan" } }],
  };
  const m = SI.sessionMetrics(session);
  assert.equal(m.messages, 2); assert.equal(m.patches, 2); assert.equal(m.patchesApplied, 1);
  const recap = SI.buildRecap(session);
  assert.equal(recap.decisions.length, 2, "decision log built from timeline");
  assert.ok(recap.openThreads.some((t) => /Patch pending/.test(t)), "open patch surfaced");
  assert.ok(recap.summary.includes("1/2 patches applied"), "recap summary is accurate");
  const md = SI.exportSession(session, "md");
  assert.ok(md.content.includes("# T — session recap") && md.content.includes("Patch applied") && md.content.includes("**Dev:** hi"), "markdown export has recap + decisions + transcript");
  const json = JSON.parse(SI.exportSession(session, "json").content);
  assert.equal(json.recap.metrics.patchesApplied, 1, "json export carries structured recap");
  ok("Session Intelligence: recap + metrics + export (MD/JSON)");
}

// ---- 2) live HTTP flow ----
const port = Number(process.env.SYN_W8_PORT || 8988);
const base = `http://127.0.0.1:${port}`;
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-w8-"));
let server;
try {
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), JARVIS_HOST: "127.0.0.1", JARVIS_RUNTIME_DIR: runtimeDir, GEMINI_API_KEY: "", GOOGLE_ACCESS_TOKEN: "", GOOGLE_REFRESH_TOKEN: "", JARVIS_MOCK_SCREEN_CAPTURE: "1", JARVIS_DESKTOP_CONTROL_DRY_RUN: "1" },
    stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  const cookie = (await fetch(`${base}/api/capabilities`)).headers.get("set-cookie")?.split(";")[0] || "";
  const H = { "content-type": "application/json", cookie };
  const post = async (p, b) => (await fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b || {}) }));
  const postJ = async (p, b) => (await post(p, b)).json();
  const getJ = async (p) => (await fetch(`${base}${p}`, { headers: H })).json();
  const remoteJoin = (code) => fetch(`${base}/api/coop-symbiote/session/join-remote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, displayName: "Aryan" }) });

  const session = (await postJ("/api/coop-symbiote/session/create", { title: "W8", mode: "Pair Build Mode" })).session;
  const sid = session.id, codeA = session.code;

  // Invite-code rotation: old code invalidated, new code works.
  assert.equal((await remoteJoin(codeA)).status, 200, "old code works before rotation");
  const rotated = (await postJ(`/api/coop-symbiote/session/${sid}/regenerate-code`, {})).session;
  assert.notEqual(rotated.code, codeA, "code rotated");
  assert.equal((await remoteJoin(codeA)).status, 404, "OLD code no longer works after rotation");
  assert.equal((await remoteJoin(rotated.code)).status, 200, "NEW code works");
  ok("invite management: code rotation invalidates the old code");

  // Approve the (new) guest, then moderation kick.
  await postJ(`/api/coop-symbiote/session/${sid}/approve-join`, {});
  const afterKick = (await postJ(`/api/coop-symbiote/session/${sid}/kick`, { reason: "test" })).session;
  assert.equal(afterKick.guest, null, "kick removed the guest");
  assert.equal(afterKick.peerName, "", "peer cleared after kick");
  ok("moderation: host can kick a guest (lease revoked, guest cleared)");

  // Ability toggles.
  const ab = (await postJ(`/api/coop-symbiote/session/${sid}/abilities`, { abilities: { readSourceFiles: true, terminalAccess: false } })).session;
  assert.equal(ab.abilities.readSourceFiles, true, "ability toggle applied");
  ok("roles/permissions: ability envelope toggle");

  // Add content, then metrics + export + recap.
  await postJ("/api/coop-symbiote/chat", { sessionId: sid, senderType: "human", senderName: "Dev", text: "session note" });
  await postJ("/api/coop-symbiote/tasks", { sessionId: sid, title: "ship W8" });
  const metrics = await getJ(`/api/coop-symbiote/session/${sid}/metrics`);
  assert.ok(metrics.messages >= 1 && metrics.tasks >= 1, "metrics reflect activity");
  const recap = await getJ(`/api/coop-symbiote/session/${sid}/recap`);
  assert.ok(recap.decisions.length >= 1 && recap.summary, "recap has decisions + summary");
  const md = await getJ(`/api/coop-symbiote/session/${sid}/export?format=md`);
  assert.ok(md.content.includes("session recap") && md.content.includes("**Dev:** session note"), "MD export has transcript");
  const jn = await getJ(`/api/coop-symbiote/session/${sid}/export?format=json`);
  assert.ok(JSON.parse(jn.content).recap, "JSON export parses with recap");
  ok("Session Intelligence surfaces: metrics + recap + export live");

  // Data wipe: soft-delete (content cleared, tombstone kept, no longer active).
  const wiped = (await postJ(`/api/coop-symbiote/session/${sid}/wipe`, {})).session;
  assert.equal(wiped.status, "wiped", "status → wiped");
  assert.equal((wiped.chat || []).length, 0, "chat content cleared");
  assert.ok(/wiped/i.test(wiped.summary), "tombstone summary retained");
  const status = await getJ("/api/coop-symbiote/status");
  assert.notEqual(status.activeSession?.id, sid, "wiped session is no longer the active session");
  ok("data retention: wipe soft-deletes (content cleared, tombstone kept, de-activated)");

  console.log(`\nSynapse W8 hardening + Session Intelligence check passed: ${pass}/${pass}`);
} finally {
  if (server && !server.killed) { const exited = new Promise((r) => server.once("exit", r)); server.kill(); await exited; }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
