"use strict";

// Find a control by what it MEANS, never by Instagram's class names.
//
// Instagram rewrites its CSS classes about weekly — that churn is what killed every old bot that
// pinned selectors to classes. What survives is the accessible layer: a Like button stays a button
// named "Like", a person's row stays a link whose href is "/their-handle/". So a "target" here is
// described by meaning — role, accessible name, visible text, href — and matched against the element
// metadata the page snapshot already produces (the same shape browser-service returns).
//
// The load-bearing rule, learned the hard way: when a target matches ZERO or MANY elements, we do
// NOT guess. We fail loud with the count. Guessing which of two look-alike controls to click is
// exactly how a message ended up in the wrong chat. One match or nothing.

function norm(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().toLowerCase();
}

// Does one element satisfy one target's fields? Every field present on the target must match; fields
// absent from the target are ignored. This keeps targets as loose or as strict as they need to be.
function elementMatches(element, target) {
  if (!element || !target) return false;
  const name = norm(element.name);
  const text = norm(element.text);
  const role = norm(element.role);
  const tag = norm(element.tag);
  const href = String(element.href || "");

  if (target.role != null && role !== norm(target.role)) return false;
  if (target.tag != null && tag !== norm(target.tag)) return false;
  if (target.name != null && name !== norm(target.name)) return false;
  if (target.nameIncludes != null && !name.includes(norm(target.nameIncludes))) return false;
  if (target.text != null && text !== norm(target.text)) return false;
  if (target.textIncludes != null && !text.includes(norm(target.textIncludes))) return false;
  if (target.href != null && href !== String(target.href)) return false;
  if (target.hrefIncludes != null && !href.includes(String(target.hrefIncludes))) return false;
  if (target.hrefEndsWith != null && !href.endsWith(String(target.hrefEndsWith))) return false;
  if (target.disabled != null && Boolean(element.disabled) !== Boolean(target.disabled)) return false;
  return true;
}

function allMatches(elements, target) {
  return (Array.isArray(elements) ? elements : []).filter((element) => elementMatches(element, target));
}

class TargetError extends Error {
  constructor(message, code, count) {
    super(message);
    this.name = "TargetError";
    this.code = code;   // "not_found" | "ambiguous"
    this.count = count; // how many matched — the diagnostic that says WHY we refused
  }
}

// Exactly one, or refuse. Never "the first of several".
function findOne(elements, target) {
  const matches = allMatches(elements, target);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new TargetError(`No element matched ${JSON.stringify(target)}`, "not_found", 0);
  }
  throw new TargetError(
    `${matches.length} elements matched ${JSON.stringify(target)} — refusing to guess which`,
    "ambiguous",
    matches.length,
  );
}

// Ordered fallback: try aria/name first, then role+name, then text, then structural, and take the
// FIRST target that resolves to exactly one element. This is the resilient-selector strategy from
// the research — a small ordered list, first clean hit wins. An ambiguous hit does not stop the
// chain (we move on and try a more specific target); only a clean single match ends it. If none of
// them yields exactly one, we fail loud with what each target saw.
function findFirst(elements, targets) {
  const list = Array.isArray(targets) ? targets : [targets];
  const tried = [];
  for (const target of list) {
    const matches = allMatches(elements, target);
    if (matches.length === 1) return { element: matches[0], target, index: tried.length };
    tried.push({ target, count: matches.length });
  }
  // Surface the SPECIFIC reason so the caller (and the heal path) knows what went wrong: everything
  // matched nothing → not_found; a lone target matched several → ambiguous; a genuine mix → the
  // generic code. "not found" and "ambiguous" want different responses, so we don't flatten them.
  const summary = tried.map((t) => `${JSON.stringify(t.target)}→${t.count}`).join(", ");
  const allZero = tried.every((t) => t.count === 0);
  const code = allZero
    ? "not_found"
    : (tried.length === 1 && tried[0].count > 1 ? "ambiguous" : "no_clean_match");
  throw new TargetError(`No target resolved to exactly one element. Tried: ${summary}`, code, tried.length);
}

module.exports = { elementMatches, allMatches, findOne, findFirst, TargetError };
