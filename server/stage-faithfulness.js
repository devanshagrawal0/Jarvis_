// The Stage faithfulness gate (W3.3).
//
// Deterministic, in-code guard: for a LIVE render (data fetched from a real source), every
// NUMBER shown in the blocks must trace back to the fetched payload. A number that isn't in
// the payload was invented — the gate flags it, and the caller blocks/repairs the render.
// This is the "check that cannot fail silently": it runs in code, not vibes, and it goes red
// on a real injected fabrication (see the test).
//
// It does NOT run for FICTION (invention is allowed there) and is advisory for STABLE
// (model-knowledge, badged). Prose is not gated — only numeric leaves, where fabrication is
// both most dangerous and mechanically checkable.

// Pull normalized numbers out of a string: "$1,845.50" -> 1845.5, "+14.2%" -> 14.2, "-3" -> -3.
function numbersIn(str) {
  const out = [];
  const text = String(str == null ? "" : str);
  const re = /[-+]?\$?\s?\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[0].replace(/[\s,$+]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// Collect the numeric, data-bearing values from the rendered blocks, with their location.
function dataValues(blocks) {
  const vals = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "stat") {
      if (b.value) vals.push({ where: `stat "${b.label || ""}" value`, text: String(b.value) });
      if (b.delta) vals.push({ where: `stat "${b.label || ""}" delta`, text: String(b.delta) });
    } else if (b.type === "list") {
      (Array.isArray(b.items) ? b.items : []).forEach((it, i) => vals.push({ where: `list item ${i + 1}`, text: String(it) }));
    } else if (b.type === "text" || b.type === "heading") {
      if (b.text) vals.push({ where: b.type, text: String(b.text) });
    }
  }
  return vals;
}

// A rendered number is "supported" if the same number appears anywhere in the fetched payload.
// Tolerant to rounding: an exact match, or a match within 0.5% of a payload number.
function isSupported(n, payloadNums) {
  for (const p of payloadNums) {
    if (n === p) return true;
    const tol = Math.max(Math.abs(p) * 0.005, 0.01);
    if (Math.abs(n - p) <= tol) return true;
  }
  return false;
}

// Audit a rendered surface against the real data it should have come from.
// Returns { ok, violations: [{ value, where }], checked }.
function auditFaithfulness(blocks, payload) {
  const payloadText = typeof payload === "string" ? payload : JSON.stringify(payload || "");
  const payloadNums = numbersIn(payloadText);
  const violations = [];
  let checked = 0;
  for (const v of dataValues(blocks)) {
    for (const n of numbersIn(v.text)) {
      checked += 1;
      if (!isSupported(n, payloadNums)) violations.push({ value: n, where: v.where, text: v.text });
    }
  }
  return { ok: violations.length === 0, violations, checked };
}

module.exports = { auditFaithfulness, numbersIn, dataValues };
