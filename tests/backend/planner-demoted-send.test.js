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

const { compileOutcome, PREPARE_ONLY_PHRASE } = require("../../server/automation/outcome-compiler");
const { classifyToolResults, summaryPrefix } = require("../../server/tool-result-honesty");

const ENGINE = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");

// The exact string from the real run.
const DEMOTED_TASK = "In the background on Instagram Direct, search for Raghav, open his chat, type 'hi' into the message input, and leave it unsent at the exact Send button.";

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
  assert.match(ENGINE, /PREPARE_ONLY_PHRASE \} = require\("\.\/automation\/outcome-compiler"\)/,
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

test("the handler wires the guard, and the model is told not to add the phrase", () => {
  // Both halves are needed. The instruction stops most occurrences; the handler catches the rest.
  // Without the wiring assertion the regex above is just a regex in a test file.
  assert.match(ENGINE, /const plannerDemotedTheSend = !ownerRequestedDraft && PREPARE_ONLY_PHRASE\.test\(task\)/,
    "the computer_use handler must compute the demotion");
  assert.match(ENGINE, /completed: plannerDemotedTheSend \? false : undefined/,
    "and must mark such a run as not completed so it cannot be summarised as done");
  assert.match(ENGINE, /NEVER append your own safety wording/,
    "the task parameter description must tell the planner not to write the restriction");
  assert.match(ENGINE, /the runtime already pauses every send/,
    "and must explain why: the approval gate already exists below it");
});
