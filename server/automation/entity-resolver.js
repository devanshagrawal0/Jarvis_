"use strict";

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
  const ranked = rankCandidates(query, elements, options);
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
  return people.map((person) => ({ kind: "person", query: person, ...resolveEntity(person, snapshot?.elements || []) }));
}

module.exports = { candidateLabels, editDistance, hintsForOutcome, identityKey, jaccard, normalize, rankCandidates, resolveEntity, scoreCandidate, uniqueIdentityCandidates };
