// End-to-end verification of the messaging pipeline against the real site.
//
// Runs the real agent on a real task and STOPS at the commit boundary, which is where the runtime
// pauses every outward action for the owner. Nothing is sent by this script: reaching the boundary
// is the pass condition, not a step on the way to something else.
//
//   node scripts/verify-send-pipeline.mjs "<recipient>" ["<message>"]
//
// What it proves, each independently checkable against the printed step log:
//   1. the objective compiles to the right recipient and the right payload
//   2. the agent reaches the correct conversation
//   3. it identifies the unlabelled composer and types the message into it
//   4. it stops at Send and asks, rather than clicking or giving up
//
// Requires the backend to be stopped, since both share the one browser profile.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_DIR = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));

const { createSecretStore } = await import("../server/secret-store.js");
const { createBrowserAutomationService } = await import("../server/browser-service.js");
const { createUniversalBrowserAgent, findMessageComposer } = await import("../server/universal-browser-agent.js");
const { compileOutcome, resolveExecutableTask } = await import("../server/automation/outcome-compiler.js");

// Recipient and payload come from the command line so no real contact's name lives in the
// repository. The planner paraphrase mirrors what the planner actually produced on a real failure —
// including the possessive apostrophe and the self-imposed "stop at the final Send button", because
// verifying against clean phrasing would prove nothing about what really happens.
//
//   node scripts/verify-send-pipeline.mjs "<recipient>" "<message>"
const RECIPIENT = process.argv[2] || process.env.VERIFY_RECIPIENT || "";
const MESSAGE = process.argv[3] || process.env.VERIFY_MESSAGE || "hi";
if (!RECIPIENT) {
  console.error('usage: node scripts/verify-send-pipeline.mjs "<recipient>" ["<message>"]');
  process.exit(1);
}
const OWNER_REQUEST = `send ${MESSAGE} to ${RECIPIENT} on insta`;
const PLANNER_TASK = `Open Instagram Direct, search for ${RECIPIENT}, select ${RECIPIENT}'s chat, type '${MESSAGE}' into the message input field, and stop at the final Send button the message.`;

const geminiKey = createSecretStore(RUNTIME_DIR).load().geminiKey;
if (!geminiKey) { console.error("No geminiKey in the vault."); process.exit(1); }

const pass = [];
const fail = [];
const check = (name, ok, detail = "") => (ok ? pass : fail).push(`${name}${detail ? ` — ${detail}` : ""}`);

// ── 1. intent ────────────────────────────────────────────────────────────────
const resolved = resolveExecutableTask({ ownerRequest: OWNER_REQUEST, task: PLANNER_TASK, prepareOnlyText: "" });
const outcome = compileOutcome(resolved.executableTask, { id: "verify" });
console.log("1. INTENT");
console.log(`   recipient : ${JSON.stringify(outcome.entities.people)}`);
console.log(`   payload   : ${JSON.stringify(outcome.entities.messageValues)}`);
console.log(`   commit    : ${outcome.commit.required}`);
const firstName = RECIPIENT.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
check("recipient resolved", outcome.entities.people.some((p) => new RegExp(firstName, "i").test(p)), JSON.stringify(outcome.entities.people));
check("payload is the dictated word", JSON.stringify(outcome.entities.messageValues) === JSON.stringify([MESSAGE]), JSON.stringify(outcome.entities.messageValues));
check("send intent survived the planner", outcome.commit.required === true);

const browser = createBrowserAutomationService({ runtimeDir: RUNTIME_DIR, workspaceRoot: ROOT, headless: true, channel: undefined });
const agent = createUniversalBrowserAgent({ browserService: browser, runtimeDir: RUNTIME_DIR, getSettings: () => ({ geminiKey }) });

const steps = [];
const onStep = async (s) => {
  if (s.phase === "planned" || s.phase === "observed") return;
  steps.push(s);
  const target = String(s.targetName || s.ref || s.url || "").replace(/\s+/g, " ").slice(0, 58);
  console.log(`   [${String(s.step).padStart(2)}] ${String(s.phase).padEnd(17)} ${String(s.action || "").padEnd(9)} ${target}${s.error ? `  !! ${String(s.error).slice(0, 70)}` : ""}`);
};

console.log("\n2. LIVE RUN (stops at the approval boundary; sends nothing)");
let result;
try {
  result = await agent.execute(resolved.executableTask, { taskId: `verify-${Date.now()}`, startUrl: "https://www.instagram.com/direct/inbox/", maxSteps: 18, onStep });
} catch (error) {
  result = { success: false, error: `threw: ${error.message}` };
}

// ── 3. what the run actually did ─────────────────────────────────────────────
// The approval-boundary return calls it `steps`; every other terminal return calls it `history`.
const history = result.history || result.steps || [];
const reachedThread = /\/direct\/t\//.test(String(result.finalUrl || ""));
const typed = history.find((h) => h.action === "fill" && String(h.value || "").trim() === MESSAGE && h.ok !== false);
// A refusal is the guard doing its job, not a defect: on a page that has not finished rendering the
// composer, the planner may aim at something else and must be stopped. What matters is that the
// payload never LANDED anywhere but the composer.
const misplaced = history.filter((h) => h.action === "fill" && h.ok !== false
  && String(h.value || "").trim() === MESSAGE && h.composerFill !== true);
const refusedComposer = history.filter((h) => /semantic message composer is required/i.test(String(h.error || "")));

console.log("\n3. RESULT");
console.log(`   finalUrl             : ${result.finalUrl || ""}`);
console.log(`   requiresConfirmation : ${result.requiresConfirmation === true}`);
console.log(`   requiresLogin        : ${result.requiresLogin === true}`);
console.log(`   blocked              : ${result.blocked === true}`);
if (result.error) console.log(`   error                : ${String(result.error).slice(0, 200)}`);

check("reached the conversation", reachedThread, result.finalUrl || "no url");
check("typed the message into the composer", Boolean(typed), typed ? `into ${typed.targetName || typed.ref}` : "never typed");
check("the message never landed anywhere but the composer", misplaced.length === 0,
  misplaced.length ? `into ${misplaced.map((h) => h.targetName || h.ref).join(", ")}` : `${refusedComposer.length} wrong target(s) correctly refused`);
check("stopped at the send for approval", result.requiresConfirmation === true,
  result.requiresConfirmation ? "" : `instead: ${result.blocked ? "blocked" : result.success ? "completed" : "other"}`);

if (result.pendingAction?.pendingAction) {
  const commit = result.pendingAction.pendingAction;
  console.log(`\n   PENDING COMMIT: ${commit.action} ref=${commit.ref} basis=${commit.basis}`);
  console.log(`   control       : ${String(commit.label).slice(0, 140)}`);
  fs.writeFileSync(path.join(RUNTIME_DIR, "verify-pending.json"), JSON.stringify(result.pendingAction, null, 2));
}

// Snapshot the live composer detection for the record. Must reuse the run's OWN taskId — an
// earlier version used a fresh one, which opens a blank page and reported "NOT FOUND" for a
// composer that was on screen the whole time.
try {
  const snap = await browser.snapshot({ taskId: result.taskId, limit: 240 });
  const found = findMessageComposer(snap.elements || []);
  console.log(`\n   composer detection on the live page: ${found ? `${found.element.ref} (${found.basis})` : "NOT FOUND"}`);
} catch { /* the task page may already be released */ }

await browser.close().catch(() => null);

console.log(`\n${"=".repeat(62)}`);
for (const item of pass) console.log(`  PASS  ${item}`);
for (const item of fail) console.log(`  FAIL  ${item}`);
console.log(`${"=".repeat(62)}\n${fail.length ? `${fail.length} CHECK(S) FAILED` : "ALL CHECKS PASSED — pipeline reaches the approval boundary"}`);
process.exit(fail.length ? 1 : 0);
