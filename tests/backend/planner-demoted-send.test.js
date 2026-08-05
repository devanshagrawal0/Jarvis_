"use strict";

// The planner cancelled the owner's send by describing it cautiously.
//
// Asked "send raghav hi on instagram", JARVIS called computer_use with the task text:
//
//   "In the background on Instagram Direct, search for Raghav, open his chat, type 'hi' into the
//    message input, and leave it unsent at the exact Send button."
//
// The owner never said "leave it unsent". The planner added it. The outcome compiler reads the task
// text, sees that phrase, and clears the commit — so `commit.required` came out false and the run
// could never reach the approval boundary. The owner asked to send, the send was silently demoted
// to a draft, and nobody was ever asked to approve anything.
//
// Draft-only already has a designated channel: the `prepareOnlyText` parameter. Restraint written
// into `task` with that parameter unset is the planner overriding the owner, and it is now recorded
// so the reply says what happened rather than reporting success.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { compileOutcome, PREPARE_ONLY_PHRASE, resolveExecutableTask } = require("../../server/automation/outcome-compiler");
const { classifyToolResults, summaryPrefix } = require("../../server/tool-result-honesty");

const ENGINE = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");

// The exact string from the real run.
const DEMOTED_TASK = "In the background on Instagram Direct, search for Raghav, open his chat, type 'hi' into the message input, and leave it unsent at the exact Send button.";
// The second attempt, after the planner was instructed not to do this. It simply reworded.
const DEMOTED_TASK_2 = "In the background on Instagram Direct, search for Raghav, select Raghav's chat, type 'hi' into the message input field, and prepare the message without clicking Send.";

test("the phrase really does cancel the commit", () => {
  // Precondition for the whole bug: this is why it mattered that the planner wrote it.
  const demoted = compileOutcome(DEMOTED_TASK, { id: "t" });
  assert.equal(demoted.commit.required, false, "the send is cancelled outright, not deferred to approval");
  assert.equal(demoted.commit.prepareOnly, true);

  const honest = compileOutcome("In the background on Instagram Direct, search for Raghav, open his chat, and send him a message saying 'hi'.", { id: "t" });
  assert.equal(honest.commit.required, true, "without the added phrase the same task is a real send");
  assert.deepEqual(honest.entities.messageValues, ["hi"]);
});

test("the guard uses the compiler's own rule, not a second copy of it", () => {
  // The handler and the compiler must agree exactly. A private copy of this pattern in the handler
  // would drift, and the drift would be silent: the compiler would keep cancelling sends that the
  // handler had stopped recognising as demotions. Both now import PREPARE_ONLY_PHRASE.
  assert.ok(PREPARE_ONLY_PHRASE.test(DEMOTED_TASK));
  for (const phrase of ["and do not click Send", "stop before sending", "without submitting the form", "don't send it", "leave it unsent"]) {
    assert.ok(PREPARE_ONLY_PHRASE.test(`open the chat, type hi, ${phrase}`), `should catch: ${phrase}`);
  }
  for (const ordinary of ["open the chat and send him hi", "reply to Raghav saying hi", "send the report to Yash"]) {
    assert.equal(PREPARE_ONLY_PHRASE.test(ordinary), false, `must not fire on: ${ordinary}`);
  }
  assert.match(ENGINE, /PREPARE_ONLY_PHRASE,[^}]*\} = require\("\.\/automation\/outcome-compiler"\)/,
    "the handler must import the shared rule rather than define its own");
});

test("a demoted send is not reported as done", () => {
  // The result shape the handler now returns, run through the same summary the owner reads.
  const prefix = summaryPrefix(classifyToolResults([{
    tool: "computer_use",
    ok: true,
    result: {
      completed: false,
      plannerDemotedTheSend: true,
      error: "The task text told the browser to stop before sending, so nothing was sent.",
    },
  }], new Set(["browser_status"])));
  assert.doesNotMatch(prefix, /^Done, sir/, "a send that became a draft is not a completed send");
});

test("an owner-requested draft is still a genuine success", () => {
  // prepareOnlyText is how the owner asks for a draft. That run did exactly what was asked.
  const prefix = summaryPrefix(classifyToolResults([{
    tool: "computer_use",
    ok: true,
    result: { result: "Prepared the exact message and stopped without sending it" },
  }], new Set(["browser_status"])));
  assert.match(prefix, /^Done, sir/);
});

// ── restoring the owner's intent ──────────────────────────────────────────────
// Telling the planner not to write the restriction did not hold. It came back with fresh wording:
// "leave it unsent at the exact Send button", then "prepare the message without clicking Send".
// Noticing the demotion was not enough either — the run still stopped short and the owner still got
// nothing sent. So the owner's own sentence is now consulted and their intent restored.
//
// Restoration never sends anything by itself. It lets the run reach the approval boundary, which is
// where the owner is asked. Mirrors the handler's logic exactly; the wiring assertion below keeps
// the two aligned.
// Calls the REAL function the handler calls. An earlier version of this helper re-implemented the
// decision beside the assertions, and a mutation that disabled the live branch left every test
// green — precisely the defect this repair exists to remove.
function resolveTask(ownerRequest, task, prepareOnlyText = "") {
  const resolved = resolveExecutableTask({ ownerRequest, task, prepareOnlyText });
  return { executable: resolved.executableTask, outcome: compileOutcome(resolved.executableTask, { id: "f" }), ...resolved };
}

test("both real failures become genuine sends again", () => {
  const cases = [
    ["send raghav hi on instagram", "In the background on Instagram Direct, search for Raghav, open his chat, type 'hi' into the message input, and leave it unsent at the exact Send button."],
    ["send hi to raghav on insta", DEMOTED_TASK_2],
  ];
  for (const [ownerRequest, task] of cases) {
    const { outcome } = resolveTask(ownerRequest, task);
    assert.equal(outcome.commit.required, true, `the owner asked to send: ${ownerRequest}`);
    assert.ok(outcome.entities.people.includes("Raghav"));
    assert.deepEqual(outcome.entities.messageValues, ["hi"], "and the payload is the word they dictated");
  }
});

test("a draft the owner asked for is never promoted into a send", () => {
  // The dangerous direction. A run that stops short is a nuisance; sending something the owner
  // wanted held back cannot be undone.
  for (const [ownerRequest, task, prepareOnlyText] of [
    ["draft a message to raghav saying hi but do not send it", "Open Raghav's chat, type 'hi', and do not send.", ""],
    ["send hi to raghav", "Open Raghav's chat and type 'hi' without sending", "hi"],
    ["", "Open Raghav's chat, type 'hi', do not send.", ""],
  ]) {
    const { executable, outcome } = resolveTask(ownerRequest, task, prepareOnlyText);
    assert.equal(executable, task, `the task must be left exactly as written: ${ownerRequest || "(no owner request)"}`);
    assert.equal(outcome.commit.required, false);
  }
});

test("an ordinary send is passed through untouched", () => {
  const task = "Open Instagram DMs and send Raghav a message saying 'hi'.";
  const { executable, outcome } = resolveTask("send hi to raghav on insta", task);
  assert.equal(executable, task, "nothing to restore, so nothing is rewritten");
  assert.equal(outcome.commit.required, true);
});

test("the handler wires the guard, and the model is told not to add the phrase", () => {
  // Both halves are needed. The instruction stops most occurrences; the handler catches the rest.
  // Without the wiring assertion the regex above is just a regex in a test file.
  assert.match(ENGINE, /const \{ executableTask, plannerDemotedTheSend, restraintSurvivedStripping, restored \} = resolveExecutableTask\(/,
    "the computer_use handler must resolve the task through the shared function");
  assert.match(ENGINE, /completed: restraintSurvivedStripping \? false : undefined/,
    "and must mark a run whose restraint survived stripping as not completed");
  assert.match(ENGINE, /resolveExecutableTask\(\{\s*ownerRequest: cleanString\(context\.ownerRequest, 2000\)/,
    "the handler must resolve the task through the tested function, using the owner's own sentence");
  assert.match(ENGINE, /await computerUse\.execute\(executableTask, automationOptions\)/,
    "and the restored task must be the one actually executed, not merely computed");
  assert.match(ENGINE, /await universalHeadlessBrowser\.execute\(executableTask, automationOptions\)/);
  const SERVER = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  assert.match(SERVER, /ownerRequest: rawUserMessage\(prompt\)/,
    "server.js must pass the owner's own words down to the tools");
  assert.match(ENGINE, /NEVER append your own safety wording/,
    "the task parameter description must tell the planner not to write the restriction");
  assert.match(ENGINE, /the runtime already pauses every send/,
    "and must explain why: the approval gate already exists below it");
});
