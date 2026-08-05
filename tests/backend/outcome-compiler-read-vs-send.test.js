"use strict";

// Asking JARVIS to READ a message compiled into a request to SEND one.
//
// Found by running the real agent against the chat harness with the objective "Open the
// conversation with Yash and report the exact text of the most recent message shown in it". The
// compiler produced commit.required with type "send", a recipient list of ["Yash", "shown"], and a
// message payload of ["in it"]. The agent then opened the conversation, typed "in it" into the
// composer, and stopped at the approval gate asking to send that to a real name.
//
// Two independent causes, both the same mistake:
//
//  1. `commitFor` tested for the WORD. "message", "email", "reply", "post" and "like" are verbs and
//     nouns; the noun in "the most recent message" was read as an instruction to send one.
//  2. `requestedMessages` ran unconditionally, so a read request still yielded a payload — and the
//     fast path composes any single messageValue into the first composer it finds.
//
// The approval gate held, which is the only reason this was caught rather than delivered. A gate is
// the last line of defence, not the plan.

const test = require("node:test");
const assert = require("node:assert/strict");

const { compileOutcome, probablePeople } = require("../../server/automation/outcome-compiler");

const compile = (objective) => compileOutcome(objective, { id: "test" });

test("reading a message is not sending one", () => {
  const outcome = compile("Open the conversation with Yash and report the exact text of the most recent message shown in it");

  assert.equal(outcome.commit.required, false, "nothing in this request leaves the machine");
  assert.deepEqual(outcome.commit.types, []);
  assert.deepEqual(outcome.entities.messageValues, [],
    "a read request has no payload; extracting one is what put \"in it\" in the composer");
  assert.deepEqual(outcome.entities.people, ["Yash"],
    "\"shown\" is a participle, not a person — it matched the routing pattern in \"message shown\"");
  assert.equal(outcome.completionContract.requireRecipientVerification, false);
});

test("other read phrasings stay read-only", () => {
  for (const objective of [
    "Read my latest email and summarise it",
    "Show me the last three messages in my inbox",
    "Check whether Yash replied to my message",
    "Tell me what his reply said",
    "Count how many unread messages I have",
    "Open the post from Yash and read the comments",
  ]) {
    const outcome = compile(objective);
    assert.equal(outcome.commit.required, false, `"${objective}" must not be classified as a commit`);
    assert.deepEqual(outcome.entities.messageValues, [], `"${objective}" must not produce a payload`);
  }
});

test("a read request that quotes text does not turn that text into a payload", () => {
  // Masking the noun stops the COMMIT classification, but `requestedMessages` has its own patterns
  // that key off "saying" and "that says" and do not care why the sentence exists. Without the
  // intent gate these still yield a payload on a pure lookup — and a single messageValue is enough
  // for the fast path to type it into the first composer it finds. Nothing is sent, but text
  // appears in a real person's chat box, one keypress from delivery.
  for (const objective of [
    "Find the message from Yash saying hello and tell me when it arrived",
    "Check if there is a message that says hi from Tg",
    "Search my inbox for the email with the message about rent",
  ]) {
    const outcome = compile(objective);
    assert.equal(outcome.commit.required, false, `"${objective}" is a lookup`);
    assert.deepEqual(outcome.entities.messageValues, [],
      `"${objective}" quotes text it is searching FOR, not text to write`);
  }
});

test("genuine sends are unaffected", () => {
  // The whole point of the guard is that it separates the noun from the verb. If it also blunted
  // real send requests it would simply be a different bug.
  const cases = [
    ["Send Tg a message saying hi on Instagram", "tg", "hi"],
    ["message Tg saying hi", "tg", "hi"],
    ["Reply to Yash saying sounds good", "yash", "sounds good"],
    ["DM Raghav saying running late", "raghav", "running late"],
  ];
  for (const [objective, person, payload] of cases) {
    const outcome = compile(objective);
    assert.equal(outcome.commit.required, true, `"${objective}" is a send`);
    assert.ok(outcome.commit.types.includes("send"));
    assert.ok(outcome.entities.people.map((p) => p.toLowerCase()).includes(person), `recipient for "${objective}"`);
    assert.deepEqual(outcome.entities.messageValues, [payload], `payload for "${objective}"`);
    assert.equal(outcome.completionContract.requireRecipientVerification, true);
  }
});

test("a draft-only request keeps its payload but loses the commit", () => {
  // This is why the payload gate keys off intent rather than off the final `types`. "do not send"
  // strips "send" from types, so gating on types would silently discard the text the owner
  // dictated and the draft would be prepared empty.
  const outcome = compile("Draft a message to Tg saying hi but do not send it");
  assert.equal(outcome.commit.required, false, "the owner explicitly forbade the terminal step");
  assert.ok(outcome.commit.intendedTypes.includes("send"), "but a send was what they were describing");
  assert.equal(outcome.commit.prepareOnly, true);
  assert.deepEqual(outcome.entities.messageValues, ["hi"], "the dictated text must survive into the draft");
});

test("verbs that share a word with a noun still register", () => {
  assert.ok(compile("Like the most recent post from Yash").commit.types.includes("react"),
    "\"like\" as a verb is still a commit even though \"the post\" is a noun phrase");
  assert.ok(compile("Post a comment on the latest photo").commit.types.includes("publish"));
  assert.ok(compile("Delete the comment I left yesterday").commit.types.includes("delete"));
  assert.ok(compile("Email dev@example.com the summary").commit.types.includes("send"));
});

test("a possessive apostrophe is not an opening quote", () => {
  // The second real failure. JARVIS built the task
  //   "...search for Raghav, select Raghav's chat, type 'hi' into the message input field..."
  // and the apostrophe in "Raghav's" opened a quote that closed at the one before "hi", so the
  // extracted message was "s chat, type". The agent went to type THAT into a real person's chat,
  // while the word actually dictated sat in quotes three words away, never reached.
  const outcome = compile("In the background on Instagram Direct, search for Raghav, select Raghav's chat, type 'hi' into the message input field, and send it");
  assert.deepEqual(outcome.entities.messageValues, ["hi"],
    "the dictated word is the payload; a possessive is not a quote");
  assert.ok(outcome.entities.people.includes("Raghav"));
});

test("contractions and possessives survive everywhere", () => {
  for (const [objective, expected] of [
    ["Open Yash's chat and send 'running late'", ["running late"]],
    ["Reply to Raghav saying \"I don't know yet\"", ["I don't know yet"]],
    ["Send Tg 'it's fine'", ["it's fine"]],
  ]) {
    assert.deepEqual(compile(objective).entities.messageValues, expected, `payload for: ${objective}`);
  }
  // And a possessive alone must not invent a payload out of the rest of the sentence.
  assert.deepEqual(compile("Open Raghav's profile and tell me his bio").entities.messageValues, []);
});

test("a noun phrase does not introduce a recipient", () => {
  // The routing patterns treat the word after "message"/"dm"/"to" as a name. Behind a determiner
  // that word belongs to the noun phrase.
  assert.deepEqual(probablePeople("report the most recent message shown in it"), []);
  assert.deepEqual(probablePeople("open the latest email received today"), []);
  assert.deepEqual(probablePeople("message Tg saying hi").map((p) => p.toLowerCase()), ["tg"]);
});
