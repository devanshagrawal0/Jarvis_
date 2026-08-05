"use strict";

const { trace } = require("./trace");

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9@._ -]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function jaccard(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function editDistance(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

function candidateLabels(candidate = {}) {
  const role = normalize(candidate.role || candidate.tag);
  // A value in an editable control is normally text Jarvis just typed, not
  // evidence that the control represents the requested person or entity.
  // Including it makes a search box tie with the real search result.
  const editable = ["textbox", "searchbox", "input", "textarea", "combobox"].includes(role);
  const values = [candidate.name, candidate.text, candidate.title, candidate.ariaLabel];
  if (!editable) values.push(candidate.value);
  const href = String(candidate.href || "").trim();
  if (href) {
    try {
      const url = new URL(href, "https://identity.invalid");
      const ignored = new Set(["accounts", "direct", "inbox", "explore", "messages", "profile", "people", "search"]);
      const segment = url.pathname.split("/").map((item) => decodeURIComponent(item).trim()).find((item) => item && !ignored.has(item.toLowerCase()));
      if (segment) values.push(segment, `@${segment}`, segment.replace(/[._-]+/g, " "));
    } catch {}
  }
  return [...new Set(values.filter(Boolean).map(normalize).filter(Boolean))];
}

function scoreCandidate(query, candidate) {
  const q = normalize(query);
  const labels = candidateLabels(candidate);
  if (!q || !labels.length) return 0;
  return Math.max(...labels.map((text) => {
    if (text === q) return 1;
    if (text.startsWith(q) || text.includes(` ${q}`)) return 0.94;
    if (text.includes(q)) return 0.9;
    const lexical = jaccard(q, text);
    const edit = 1 - Math.min(editDistance(q, text) / Math.max(q.length, text.length, 1), 1);
    return Math.max(lexical * 0.86, edit * 0.72);
  }));
}

function identityKey(candidate = {}) {
  const href = String(candidate.href || "").trim();
  if (href) {
    try {
      const url = new URL(href, "https://identity.invalid");
      return `href:${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {}
  }
  return `ref:${String(candidate.ref || candidate.id || "")}`;
}

function uniqueIdentityCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = identityKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankCandidates(query, elements = [], { threshold = 0.38, limit = 8 } = {}) {
  return elements
    .map((element) => ({ ...element, matchScore: Number(scoreCandidate(query, element).toFixed(4)) }))
    .filter((item) => item.matchScore >= threshold)
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, limit);
}

function resolveEntity(query, elements, options = {}) {
  const outcome = resolveEntityInner(query, elements, options);
  trace("resolver", outcome.status, {
    query: String(query || "").length,            // length only — never the recipient's name
    status: outcome.status,
    reason: outcome.reason || null,
    candidateCount: (outcome.candidates || []).length,
    topScores: (outcome.candidates || []).slice(0, 4).map((c) => Number(c.matchScore || 0).toFixed(3)),
    topRoles: (outcome.candidates || []).slice(0, 4).map((c) => String(c.role || c.tag || "?")),
  });
  return outcome;
}

// A label naming several people. Messaging surfaces render group threads as a joined list —
// "Anjali Monga, Tg and Ignacio" — so a query for one person scores highly against a thread that
// contains that person plus others.
//
// This was a live hole, not a theoretical one. `resolveEntity("tg", [group threads only])`
// returned status "resolved" against "Anjali Monga, Tg and Ignacio" at 0.94: with a single ranked
// candidate there is no runner-up to create a margin, so the `!second` branch admits it and a
// send would have reached three people. The one real run that got this far refused only because
// several candidates happened to tie at identical scores — protection by accident of the result
// set, not by design.
const MULTI_PARTY = /,|\band\b|&|\+\s*\d+\s*(?:others?|more)\b/i;

function namesMultipleParties(label) {
  const text = String(label || "").trim();
  if (!text || !MULTI_PARTY.test(text)) return false;
  // The separator must actually join name-like tokens, so "Sanders, Jr." or a single name that
  // contains the letters "and" ("Alexander") is not misread as a group.
  const parts = text.split(/\s*,\s*|\s+\band\b\s+|\s*&\s*/i).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1;
}

function candidateNamesMultipleParties(candidate) {
  return candidateLabels(candidate).some((label) => namesMultipleParties(label));
}

function resolveEntityInner(query, elements, options = {}) {
  const ranked = rankCandidates(query, elements, options);

  // When the owner named one recipient and the action commits something outward, a multi-party
  // thread is never an acceptable resolution. Refusing costs a retry; sending costs a message to
  // people who were never named. Callers opt in with `options.singleRecipient`, which commit-risk
  // automation sets; read-only lookups are unaffected.
  if (options.singleRecipient && !namesMultipleParties(query)) {
    const groups = ranked.filter(candidateNamesMultipleParties);
    if (groups.length) {
      const individuals = ranked.filter((item) => !candidateNamesMultipleParties(item));
      if (!individuals.length) {
        // Deliberately "ambiguous", not "not_found". In the agent's fast path `not_found` means
        // "the identity search has not finished loading" and triggers a wait-and-retry loop
        // (universal-browser-agent.js:218). Group-only results are the opposite situation: the
        // results HAVE loaded and none of them is acceptable, so waiting three more times finds
        // nothing and only delays the refusal. "ambiguous" routes to the blocked branch, which
        // surfaces this reason and the candidate list to the owner immediately.
        return {
          status: "ambiguous",
          query,
          candidates: ranked,
          rejectedGroups: groups.length,
          reason: `Only group conversations match "${query}". A message addressed to one person is not sent to a group.`,
        };
      }
      return resolveFromCandidates(query, individuals, options);
    }
  }
  return resolveFromCandidates(query, ranked, options);
}

function resolveFromCandidates(query, ranked, options = {}) {
  const exact = ranked.filter((item) => candidateLabels(item).some((label) => label === normalize(query)));
  const uniqueActionableContainer = () => {
    const actionable = uniqueIdentityCandidates(ranked.filter((item) => ["button", "link", "option", "menuitem", "radio"].includes(normalize(item.role || item.tag))
      && candidateLabels(item).some((label) => label.includes(normalize(query)))));
    return actionable.length === 1 ? actionable[0] : null;
  };
  if (exact.length === 1) {
    if (["button", "link", "option", "menuitem", "radio"].includes(normalize(exact[0].role || exact[0].tag))) {
      return { status: "resolved", query, match: exact[0], candidates: ranked };
    }
    const actionable = uniqueIdentityCandidates(ranked.filter((item) => ["button", "link", "option", "menuitem", "radio"].includes(normalize(item.role || item.tag))
      && candidateLabels(item).some((label) => label.includes(normalize(query)))));
    if (actionable.length === 1) return { status: "resolved", query, match: actionable[0], identityEvidence: exact[0], candidates: ranked };
    if (actionable.length > 1) return { status: "ambiguous", query, candidates: ranked, reason: "The exact identity text appears inside multiple actionable controls." };
    return { status: "resolved", query, match: exact[0], candidates: ranked };
  }
  if (exact.length > 1) {
    // Accessibility trees commonly repeat the same visible identity in a
    // heading, text leaf and avatar label inside one result row. If all of
    // that evidence points to one actionable container, it is one candidate,
    // not multiple people.
    const actionable = uniqueActionableContainer();
    if (actionable) return { status: "resolved", query, match: actionable, identityEvidence: exact, candidates: ranked };
    return { status: "ambiguous", query, candidates: ranked, reason: "Multiple controls have the same exact identity label." };
  }
  const first = ranked[0];
  const second = ranked[1];
  if (!first) return { status: "not_found", query, candidates: [] };
  const margin = first.matchScore - (second?.matchScore || 0);
  if (first.matchScore >= 0.9 && (margin >= 0.08 || !second)) return { status: "resolved", query, match: first, candidates: ranked };
  return { status: "ambiguous", query, candidates: ranked, reason: `Top match margin ${margin.toFixed(3)} is insufficient for a consequential action.` };
}

function hintsForOutcome(outcome, snapshot) {
  const people = outcome?.entities?.people || [];
  // `people` are individuals the task named, so each resolution is single-recipient by
  // definition — that is what enables the group-thread guard. This is the only production caller
  // of `resolveEntity`, so omitting the flag here would leave the guard as dead code.
  // A query that itself names a group is detected inside and bypasses the guard.
  return people.map((person) => ({
    kind: "person",
    query: person,
    ...resolveEntity(person, snapshot?.elements || [], { singleRecipient: true }),
  }));
}

module.exports = { candidateLabels, editDistance, hintsForOutcome, identityKey, jaccard, normalize, rankCandidates, resolveEntity, scoreCandidate, uniqueIdentityCandidates };
