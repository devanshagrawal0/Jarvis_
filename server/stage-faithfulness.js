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
// Dates are not measurements, and reading them as numbers poisons the set a rendered figure is
// checked against. "2026-08-20T13:30:00.000Z" yielded 2026, -8, -20, 13, 30, 0 — the negatives come
// from the separators — so a payload of thirty daily bars contributed dozens of phantom values that
// no tool ever reported. Timestamps and plain dates are removed before any number is extracted.
const DATEISH = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g;

function numbersIn(str) {
  const out = [];
  const text = String(str == null ? "" : str).replace(DATEISH, " ");
  const re = /[-+]?\$?\s?\d[\d,]*(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[0].replace(/[\s,$+]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// The values a surface presents AS MEASUREMENTS: a stat card's figure and a chart's series.
//
// Prose is not audited, and neither are derived figures, because auditing them punishes correct
// work. Every number in a sentence went through here originally, and the gate then rejected "29"
// out of "bottomed on Jul 29" — a date — and "2.07" out of a delta the model had correctly computed
// from two closes that were both in the payload. Three round-trips later the model had stripped its
// own accurate content to get past me: "dropping the calculated delta metrics", "removing the
// literal number 29". A gate that makes the answer worse is not protecting anyone.
//
// What stays gated is the claim that cannot be derived and cannot be a date: the value on a stat
// card and the points on a line. Those are laid out as instrument readings, and inventing one is
// the failure actually worth blocking.
function dataValues(blocks) {
  const vals = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "stat") {
      if (b.value) vals.push({ where: `stat "${b.label || ""}" value`, text: String(b.value) });
    } else if (b.type === "chart") {
      (Array.isArray(b.points) ? b.points : []).forEach((p, i) => {
        if (p && Number.isFinite(Number(p.v))) vals.push({ where: `chart "${b.label || ""}" point ${i + 1}`, text: String(p.v) });
      });
    }
  }
  return vals;
}

// A rendered number is "supported" if the same number appears in the fetched payload, allowing only
// for rounding.
//
// The tolerance is scaled by the RENDERED figure, not by the payload figure it is being compared
// against. Scaling it by the payload number made the gate weaker the larger that number was: a
// single share volume of 132,489,137 carried a tolerance of ±662,445, so any invented price inside
// a 1.3-million-wide band counted as "traced to real data". Measured over a real thirty-bar AAPL
// payload, 29.8% of every price between $250 and $400 passed — and a plausible fake is exactly the
// kind that lands near a real number, so the gate was weakest against the fabrication that matters.
//
// 0.05% of the rendered value (floored at a cent) is what rounding actually needs: 311.30 still
// matches the stored 311.29998779296875, while a fabricated 316.60 no longer matches anything.
function isSupported(n, payloadNums) {
  const tol = Math.max(Math.abs(n) * 0.0005, 0.01);
  for (const p of payloadNums) {
    if (n === p) return true;
    if (Math.abs(n - p) <= tol) return true;
  }
  return false;
}

// ── charts are checked as a SERIES, not as a bag of numbers ──────────────────────────────────
//
// Matching each point against "any number anywhere in the payload" is as weak as the payload is
// rich: with thirty days of real prices packed into a narrow band, a fabricated price lands within
// rounding distance of a genuine one about one time in six, and that is precisely the fabrication
// worth catching — the plausible one. A line drawn from real data is not a handful of numbers that
// resemble the payload, it IS the payload's series, in order.
//
// So the points are required to be an in-order run of some series actually present in the tool
// result. Subsetting is fine (last 30 of 90), so is reversal (oldest-first vs newest-first), and so
// is choosing which field to plot (closes, opens, highs).

// Every numeric series the payload actually contains: each numeric field of an array of objects
// becomes one series, and an array of bare numbers is a series in itself.
function seriesIn(value, out = []) {
  if (Array.isArray(value)) {
    const numeric = value.filter((item) => Number.isFinite(Number(item)));
    if (numeric.length >= 2 && numeric.length === value.length) out.push(numeric.map(Number));
    const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objects.length >= 2) {
      const keys = new Set();
      for (const item of objects) for (const k of Object.keys(item)) keys.add(k);
      for (const k of keys) {
        const column = objects.map((item) => Number(item[k])).filter(Number.isFinite);
        if (column.length >= 2) out.push(column);
      }
    }
    for (const item of value) if (item && typeof item === "object") seriesIn(item, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) seriesIn(v, out);
  }
  return out;
}

const near = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(a) * 0.0005, 0.01);

// Are the rendered points an in-order run of this series (gaps allowed, order preserved)?
function isSubsequence(points, series) {
  let i = 0;
  for (const s of series) {
    if (i < points.length && near(points[i], s)) i += 1;
    if (i === points.length) return true;
  }
  return i === points.length;
}

function chartTracesToSeries(points, allSeries) {
  for (const series of allSeries) {
    if (series.length < points.length) continue;
    if (isSubsequence(points, series)) return true;
    if (isSubsequence(points, [...series].reverse())) return true;
  }
  return false;
}

// Audit a rendered surface against the real data it should have come from.
// Returns { ok, violations: [{ value, where }], checked }.
function auditFaithfulness(blocks, payload) {
  const payloadText = typeof payload === "string" ? payload : JSON.stringify(payload || "");
  const payloadNums = numbersIn(payloadText);
  let parsedPayload = null;
  try { parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload; } catch { parsedPayload = null; }
  const allSeries = parsedPayload ? seriesIn(parsedPayload) : [];
  const violations = [];
  let checked = 0;

  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || b.type !== "chart") continue;
    const points = (Array.isArray(b.points) ? b.points : []).map((p) => Number(p && p.v)).filter(Number.isFinite);
    if (points.length < 2 || !allSeries.length) continue;
    checked += points.length;
    if (chartTracesToSeries(points, allSeries)) continue;   // it IS the fetched series — nothing to flag

    // Not a run of any real series. Two possibilities, told apart by SCALE.
    //
    // A derived line — percent change, a normalised index — lives at a different magnitude from the
    // data it came from: daily changes sit near 0 while the closes sit near 300, and inventing it is
    // legitimate work. A line that sits at the SAME magnitude as a real series is claiming to be
    // that data, and if it is not a run of it then its membership or its order was made up.
    //
    // Matching on "how many points look familiar" instead of on scale let a whole series shifted by
    // $1.70 through: not one value matched, so it read as derived, while sitting exactly where the
    // real prices sit and looking every bit like them.
    const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const renderedMid = Math.abs(median(points));
    const claimsToBeRawData = allSeries.some((series) => {
      if (series.length < points.length) return false;
      const seriesMid = Math.abs(median(series));
      if (!seriesMid || !renderedMid) return false;
      const ratio = renderedMid / seriesMid;
      return ratio > 0.8 && ratio < 1.25;   // same order of magnitude as a real series
    });
    if (!claimsToBeRawData) continue;   // genuinely derived — left to the loose check
    for (const n of points) {
      if (!isSupported(n, payloadNums)) violations.push({ value: n, where: `chart "${b.label || ""}"`, text: String(n) });
    }
    // Every point resembles the data yet the line is not the data: the order or the membership was
    // invented even though each figure looks plausible on its own.
    if (!violations.length) {
      violations.push({ value: points[0], where: `chart "${b.label || ""}" series`, text: "points do not follow any series in the fetched data" });
    }
  }

  for (const v of dataValues(blocks)) {
    if (/^chart /.test(v.where) ) continue;   // charts were judged as a series above
    for (const n of numbersIn(v.text)) {
      checked += 1;
      if (!isSupported(n, payloadNums)) violations.push({ value: n, where: v.where, text: v.text });
    }
  }
  return { ok: violations.length === 0, violations, checked };
}

module.exports = { auditFaithfulness, numbersIn, dataValues };
