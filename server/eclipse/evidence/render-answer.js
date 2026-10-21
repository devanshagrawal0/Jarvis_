// Answer rendering that cannot lie about verification.
//
// Two facts about this file matter:
//   1. The ABSTAIN case is rendered in CODE and never goes through the model. A model handed
//      "nothing was verified, please explain that" will still helpfully supply the answer from
//      its own weights — "Hubble, 1990, 2.4 m" is in the weights and never needed our evidence.
//      Observed live: the Director wrote "Based on the validated evidence…" over a 0-verified
//      ledger. It does not get the opportunity now.
//   2. COVERAGE is a computed fact, never generated text. A model asked to report on its own
//      coverage always reports success — that is where "There are no coverage gaps; all requested
//      data points have been successfully located and verified" came from.

// Rendered when no claim survived verification.
function renderAbstain({ attempted = [], sourcesTried = [] }) {
  const parts = ["**No verified answer.**", ""];
  parts.push("The fleet could not verify any claim against its sources, so no answer is asserted below.");
  parts.push("");
  if (attempted.length) {
    parts.push("**Claims attempted, none verified:**");
    for (const p of attempted) parts.push("- " + String(p.claim || "").slice(0, 300));
    parts.push("");
  }
  if (sourcesTried.length) {
    parts.push("**Sources checked:**");
    for (const u of sourcesTried) parts.push("- " + u);
  } else {
    parts.push("**No source was successfully read.** The workers gathered no usable evidence.");
  }
  return parts.join("\n");
}

// Appended to every synthesised answer. Generated from the real counts, so it is true by
// construction and the model is forbidden from writing anything of the kind itself.
function coverageFooter({ verified = 0, attempted = 0, gaps = [] }) {
  const claim = verified === 1 ? "claim" : "claims";
  const NL = String.fromCharCode(10);
  let line = verified + " of " + attempted + " " + claim + " verified against their sources.";
  // Gaps come from the coverage check, never from the model. A model asked to report on its own
  // coverage always reports success - that is where "no coverage gaps" came from.
  if (gaps.length) line += " Not verified: " + gaps.join("; ") + ".";
  return NL + NL + "---" + NL + "_" + line + "_";
}

// The set of distinct sources a batch of packets actually cited.
function sourcesOf(packets = []) {
  const out = [];
  for (const p of packets) {
    for (const e of p.evidence || []) {
      if (e && e.sourceUri && !out.includes(e.sourceUri)) out.push(e.sourceUri);
    }
  }
  return out;
}

// Slice 2.2: the Writer's typed blocks → markdown. Citations are derived from the sentence→claim
// map (each claim's verified sources), never written by the model. `claims` carries
// {claimId, sources[]}; the numbering is by first use so the Sources list reads in order.
function renderBlocks({ sections = [], claims = [] }) {
  const NL = "\n";
  const srcOf = new Map(claims.map((c) => [c.claimId, c.sources || []]));
  const numbered = []; const index = new Map();
  const cite = (claimIds = []) => {
    const ns = [];
    for (const c of claimIds) for (const u of srcOf.get(c) || []) {
      if (!index.has(u)) { index.set(u, numbered.length + 1); numbered.push(u); }
      if (!ns.includes(index.get(u))) ns.push(index.get(u));
    }
    return ns.length ? " " + ns.map((n) => `[${n}]`).join("") : "";
  };
  const out = [];
  // A bullet list must be closed by a blank line or the next paragraph renders inside the bullet.
  const closeList = () => { if (out.length && /^- /.test(out[out.length - 1])) out.push(""); };
  for (const sec of sections) {
    for (const b of sec.blocks || []) {
      if (b.kind !== "keyfact") closeList();
      if (b.kind === "heading") out.push("#".repeat(Math.min(3, b.level || 2)) + " " + b.text, "");
      else if (b.kind === "keyfact") out.push(`- **${b.text}**${cite(b.claimIds)}`);
      else if (b.kind === "para") out.push((b.sentences || []).map((s) => s.text + cite(s.claimIds)).join(" "), "");
      else if (b.kind === "table") {
        const hdr = [...b.headers, ...(b.sourceCol ? ["Source"] : [])];
        out.push("| " + hdr.join(" | ") + " |", "|" + hdr.map(() => "---").join("|") + "|");
        const mark = cite(b.claimIds).trim();
        for (const row of b.rows) out.push("| " + [...row, ...(b.sourceCol ? [mark || "—"] : [])].join(" | ") + " |");
        out.push("");
      }
      else if (b.kind === "conflict") out.push(`> **Sources disagree.** ${b.a.text}${cite([b.a.claimId])} — versus — ${b.b.text}${b.b.uri ? ` (${b.b.uri})` : ""}`, "");
      else if (b.kind === "callout") out.push(`> _${b.tone === "gap" ? "Not established" : "Note"}:_ ${b.text}`, "");
      else if (b.kind === "unused") {
        out.push("_Verified but not used:_");
        for (const c of b.claims || []) out.push(`- ${c.text}${cite([c.claimId])} — ${c.reason}`);
        out.push("");
      }
    }
  }
  if (numbered.length) { out.push("**Sources**", ""); numbered.forEach((u, i) => out.push(`${i + 1}. ${u}`)); }
  return out.join(NL).replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { renderAbstain, coverageFooter, sourcesOf, renderBlocks };
