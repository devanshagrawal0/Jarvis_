"use strict";

// B-05 regression: the visible-YouTube preflight lane must not hijack another surface.
//
// Before the model runs, `inferYoutubeSearchQuery` decides whether to deterministically execute
// `desktop_control { action: "youtube_search_visible" }` on the visible desktop. Two defects made
// it fire on requests that had nothing to do with YouTube:
//
//   1. The cross-surface guard only applied when YouTube was ABSENT
//      (`if (!currentMentionsYoutube && currentMentionsAnotherSurface) return "";`), so a prompt
//      naming both let YouTube win — and the room context prefix and recent history are folded
//      into this text, so an Instagram request could inherit a YouTube mention it never made.
//   2. The extraction regex ends in `|$`, so when the strip list misses a trailing clause the
//      capture runs to the end of the sentence.
//
// Together they produced this, verbatim from the owner's log:
//   "I could not search YouTube for 'Raghav Mittal, resolve the recipient without guessing,
//    type exactly hi, and stop only at the actual Send button for approval.'"
// — and typed that whole string into a search box on the visible desktop first.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadLane() {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  const wanted = ["function cleanYoutubeSearchQuery(", "function isPlausibleYoutubeQuery(", "function inferYoutubeSearchQuery("];
  let code = "";
  for (const marker of wanted) {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `could not find ${marker} in server.js`);
    const end = source.indexOf("\n}\n", start);
    assert.ok(end > start, `could not bracket ${marker}`);
    code += `${source.slice(start, end + 2)}\n`;
  }
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.api = { inferYoutubeSearchQuery, isPlausibleYoutubeQuery };`, context);
  return context.api;
}

const lane = loadLane();

test("B-05 — a request naming another surface never triggers the YouTube lane", () => {
  const foreign = [
    "In the background, use my connected personal Chrome to open Instagram Direct, search for Raghav Mittal, resolve the recipient without guessing, type exactly hi, and stop only at the actual Send button for approval.",
    "search for AJ on instagram and send a dm saying hi",
    "open gmail and search for the invoice from amazon",
    "search reddit for the thread about kalshi",
    "Send a message to tg on Instagram saying hi.",
  ];
  for (const prompt of foreign) {
    assert.equal(lane.inferYoutubeSearchQuery(prompt, []), "", `hijacked a non-YouTube request: ${prompt.slice(0, 70)}…`);
  }
});

test("B-05 — naming BOTH surfaces is ambiguous and must not act deterministically", () => {
  // The original guard let YouTube win here. Acting on a guess is the wrong answer to ambiguity.
  const ambiguous = [
    "search for the sidemen video on youtube then post it to instagram",
    "open youtube and also check my gmail, search for the podcast",
    // Simulates the room-context prefix contributing an unrelated YouTube mention.
    "[context: previously opened youtube] search for Raghav Mittal on instagram and send hi",
  ];
  for (const prompt of ambiguous) {
    assert.equal(lane.inferYoutubeSearchQuery(prompt, []), "", `acted on an ambiguous two-surface prompt: ${prompt.slice(0, 60)}…`);
  }
});

test("B-05 — a genuine YouTube search still works", () => {
  // The lane must keep functioning, or this is a mute button rather than a fix.
  assert.equal(lane.inferYoutubeSearchQuery("search for sidemen tinder on youtube", []), "sidemen tinder");
  assert.equal(lane.inferYoutubeSearchQuery("on youtube search for lofi beats", []), "lofi beats");
  const followUp = lane.inferYoutubeSearchQuery("search for mkbhd in it", [{ text: "open youtube" }, { text: "I opened the YouTube homepage." }]);
  assert.equal(followUp, "mkbhd");
});

test("B-05 — an instruction-shaped capture is refused rather than typed into the search bar", () => {
  const instructions = [
    "Raghav Mittal, resolve the recipient without guessing, type exactly hi, and stop only at the actual Send button for approval.",
    "the latest sidemen video and then send it to AJ",
    "AJ and dm him saying hi",
    "a really long phrase that just keeps going and going well past anything a person would ever type into a video search box",
  ];
  for (const captured of instructions) {
    assert.equal(lane.isPlausibleYoutubeQuery(captured), false, `would have been typed into the search bar: ${captured.slice(0, 60)}…`);
  }
});

test("B-05 — ordinary search phrases stay plausible", () => {
  for (const query of ["sidemen tinder", "lofi beats to study to", "mkbhd iphone review", "how to make sourdough"]) {
    assert.equal(lane.isPlausibleYoutubeQuery(query), true, `a normal query was rejected: ${query}`);
  }
});
