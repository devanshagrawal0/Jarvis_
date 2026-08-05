"use strict";

// Decides whether JARVIS is allowed to tell the owner "Done".
//
// This lived inside server.js, a file with no exports and no tests, which is a large part of why
// the following shipped:
//
//     owner : "send raghav hi on instagram"
//     JARVIS: "Done, sir. The verified result is:
//              - browser_status completed: activePage: url: .../direct/t/1784706..."
//
// Nothing was typed and nothing was sent. `browser_status` answers the question "which page is the
// browser looking at" and changes nothing at all. It answered successfully, the summary counted any
// successful tool as proof of completion, and the owner was told their message had been sent and
// verified. The claim could not fail: every request that ran any tool at all ended in "Done".
//
// The rule here is that a completion claim needs a tool that could actually have caused the
// outcome. Everything else is reported, but it is reported as looking, not as doing.

// A tool can return ok while its own payload says it did not finish — blocked on an ambiguous
// target, paused for approval, stopped at a login wall, out of steps. Those are failures wearing a
// successful envelope, and they were being counted as completions too.
const INCOMPLETE_FLAGS = ["blocked", "requiresConfirmation", "requiresLogin", "cancelled"];

function isObserveOnly(item, observeOnlyNames) {
  return observeOnlyNames instanceof Set ? observeOnlyNames.has(item?.tool) : false;
}

function changedSomething(item, observeOnlyNames) {
  if (!item?.ok) return false;
  if (isObserveOnly(item, observeOnlyNames)) return false;
  const result = item.result && typeof item.result === "object" ? item.result : {};
  if (result.completed === false) return false;
  if (INCOMPLETE_FLAGS.some((flag) => result[flag] === true)) return false;
  return true;
}

function classifyToolResults(toolResults = [], observeOnlyNames = new Set()) {
  const list = Array.isArray(toolResults) ? toolResults : [];
  const confirmations = list.filter((item) => item.status === "confirmation_required");
  const completed = list.filter((item) => item.ok);
  const failed = list.filter((item) => !item.ok && item.status !== "confirmation_required");
  const effective = completed.filter((item) => changedSomething(item, observeOnlyNames));
  return { confirmations, completed, failed, effective };
}

// The exact sentence the owner reads. Only the first branch is a claim of completion.
function summaryPrefix({ effective = [], confirmations = [], completed = [] } = {}) {
  if (effective.length) return "Done, sir. The verified result is:";
  if (confirmations.length) return "Ready, sir.";
  // Something ran and it worked, but everything that worked only looked at the world. Naming that
  // gap is the whole point: the owner can see for themselves that nothing was changed.
  if (completed.length) return "I did not complete that, sir. Only these read-only checks ran, and none of them change anything:";
  return "I could not complete the requested action.";
}

module.exports = { INCOMPLETE_FLAGS, changedSomething, classifyToolResults, summaryPrefix };
