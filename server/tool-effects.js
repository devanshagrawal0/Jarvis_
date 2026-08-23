"use strict";

// What a tool can actually CAUSE — and therefore what authority it needs.
//
// The boundary used to be the tool's NAME. `autonomy-policy.js` held a `lowRiskLocalExecute` Set
// that exempted some execute-risk tools from the confirmation card, and `capability-engine.js` held
// a `safeBrowserContinuation` Set that exempted some tools from the prompt-injection block. Both
// were hand-maintained, and both drifted away from what they claimed:
//
//   * `open_app` was gated; `desktop_control` was exempt. `desktop_control` opens sites, sends
//     hotkeys, clicks and types — it reaches the same outcome. Observed 2026-08-21: with an
//     `open_app` card sitting unapproved, the model reached the same end through `desktop_control`.
//     The gate was decorative for any outcome with a second route.
//
//   * `safeBrowserContinuation` — the set of tools still allowed after untrusted content — listed
//     `desktop_control`, `computer_use`, `screen_act`, `browser_act`, `mesh_send_command`,
//     `agent_deploy` and `skill_run`, directly under a comment reading "Anything that can act or
//     leave the machine stays blocked exactly as before."
//
// Authority has to attach to the EFFECT, not the name. Two tools that cause the same thing get the
// same gate, so substituting one for the other buys nothing. A new tool is governed the day it is
// added rather than the day someone remembers to edit two Sets.
//
// The vocabulary follows MCP's tool annotations (readOnlyHint / destructiveHint / openWorldHint),
// which exist for this job. MCP's caveat — that annotations are author declarations, not
// guarantees — is about UNTRUSTED third-party servers. Every tool here is first-party, which is the
// case the MCP guidance explicitly says may drive automatic decisions.

// ── the vocabulary ───────────────────────────────────────────────────────────────────────────
const EFFECTS = {
  INPUT: "input",             // synthesises keyboard/mouse: types, clicks, hotkeys
  LAUNCH: "launch",           // starts or stops a program or page
  WRITE: "write",             // changes durable local state
  EGRESS: "egress",           // sends data off this machine
  DESTRUCTIVE: "destructive", // irreversible, or destroys data
};
const ALL_EFFECTS = new Set(Object.values(EFFECTS));

// ── derivation, so nothing changes until a tool is deliberately declared ─────────────────────
// An undeclared tool falls back to what its `risk` already implied. This is a migration shim, not
// the destination: it keeps today's behaviour exactly while tools are annotated one at a time.
//
// The fallback is deliberately PESSIMISTIC in the same direction MCP's defaults are (readOnlyHint
// defaults false, destructiveHint defaults true): an unknown tool is treated as effectful. A
// forgotten declaration must never read as "safe".
function effectsFor(definition) {
  if (!definition || typeof definition !== "object") return new Set(ALL_EFFECTS);
  if (Array.isArray(definition.effects)) {
    const declared = definition.effects.filter((item) => ALL_EFFECTS.has(item));
    return new Set(declared);
  }
  switch (definition.risk) {
    case "observe":
      return new Set();                                   // reads only
    case "prepare":
      // NOT effect-free — the engine runs a prepare tool's handler and only stops if that handler
      // returns `confirmationRequired`, so work has already happened by the time it reaches its
      // commit boundary. But it is not keyboard-and-mouse either, which is what an earlier version
      // of this guessed. Measured over the real definitions, calling prepare "input" would have cut
      // off `browser_navigate`, `compose_artifact`, `memory_os_v4_scan_files` and twenty others the
      // moment a page was read — browsing would stop after page one.
      //
      // A prepare tool stages local state. That is `write`: real, reversible, and not a way for
      // content off the internet to reach the machine or the outside world. The ones that DO reach
      // further — `browser_act` types into pages, `mesh_send_command` talks to a phone, `skill_run`
      // and `agent_deploy` run code — say so by declaring it, rather than being guessed at here.
      return new Set([EFFECTS.WRITE]);
    case "commit":
      return new Set([EFFECTS.WRITE, EFFECTS.EGRESS, EFFECTS.DESTRUCTIVE]);
    case "execute":
    default:
      return new Set([EFFECTS.INPUT, EFFECTS.LAUNCH, EFFECTS.WRITE]);
  }
}

function hasAnyEffect(definition) {
  return effectsFor(definition).size > 0;
}

// Has a human actually declared what this tool causes?
//
// The risk-derived fallback above is good enough to REASON about a tool, and nowhere near good
// enough to re-gate one. Measured on the live definitions: switching the confirmation rule to the
// derived effects alone would have removed the card from ten tools, `atlas_cancel_item` among them
// — the one whose own comment in autonomy-policy.js says it keeps its gate because it deletes local
// data. `execute` simply does not tell you whether a tool destroys something.
//
// So the confirmation rule may only govern a tool whose effects were declared BY HAND. Everything
// else keeps exactly the behaviour it has today, and the migration is inert until each tool is
// looked at individually. A tool is not "safe" because nobody has got round to it yet.
function isDeclared(definition) {
  return Boolean(definition && Array.isArray(definition.effects));
}

// Does this tool do something that cannot be taken back, or that leaves the machine?
//
// This is the line worth asking the owner about. Opening an app or focusing a window is local and
// reversible — he can close it. An email, a DM, a mesh command or a trade is gone the moment it
// fires, and no amount of autonomy level should make that silent.
function isIrreversibleOrLeaves(definition) {
  const effects = effectsFor(definition);
  return effects.has(EFFECTS.EGRESS) || effects.has(EFFECTS.DESTRUCTIVE);
}

// Can content the owner did not write reach the machine, or the outside world, through this tool?
//
// This is the leg the prompt-injection guard has to cut, and only this leg. An injected instruction
// is harmless while it can only read and write locally; it becomes an attack when it can type on the
// keyboard, click the screen, or send something out. Local writes stay allowed on purpose — asking
// Jarvis to read a page and save a summary is ordinary work, and blocking it is the over-blocking
// that made "what processes are running right now" start getting refused.
// `launch` belongs here too, and leaving it out was a mistake worth recording.
//
// Measured over the real definitions, a rule of input+egress+destructive would have handed
// `open_url` and `open_app` back to a tainted turn. Opening an address is one of the oldest
// exfiltration channels there is — the data goes in the address — and launching a program because
// a web page asked is exactly the outcome the guard exists to prevent.
//
// `write` deliberately stays OUT: reading a page and saving a summary is ordinary work, and
// blocking it is the over-blocking that made ordinary local lookups start getting refused. That
// leaves one known gap — `memory_add` can still write page content into durable memory during a
// tainted turn, which is the persistence attack the literature warns about. It needs provenance
// carried into the memory record, not a blanket block, and it is not fixed here.
function reachesOutOrActsOnMachine(definition) {
  const effects = effectsFor(definition);
  return effects.has(EFFECTS.INPUT)
    || effects.has(EFFECTS.LAUNCH)
    || effects.has(EFFECTS.EGRESS)
    || effects.has(EFFECTS.DESTRUCTIVE);
}

module.exports = { EFFECTS, ALL_EFFECTS, effectsFor, hasAnyEffect, isDeclared, isIrreversibleOrLeaves, reachesOutOrActsOnMachine };
