// Writer style linter — deterministic checks over OUR OWN draft (blueprint §7).
//
// LAW 0 note: this file contains one fixed phrase list (FILLER). It is an OUTPUT linter on text
// the Writer produced, not natural-language routing of the owner's input. Dev reviewed and
// approved this exact carve-out on 2026-09-02 (blueprint §7).
//
// Everything here is arithmetic or exact-match, so a violation is a fact about the draft and a
// clean result is one the Writer earned — the lint can FAIL and be seen failing (draft.lint).

const FILLER = ["in order to", "due to the fact that", "it is important to note", "utilize", "leverage "];
const READABILITY_BAND = [55, 75];
const MAX_SENTENCE_WORDS = 30;
const MAX_HEADING_LEVEL = 3;

// Word budgets by artifact type (blueprint §3). `deep` lifts the report cap.
const WORD_BUDGET = { answer: 120, memo: 400, report: 2500, comparison: 1200, timeline: 800 };
const DEEP_WORD_BUDGET = { ...WORD_BUDGET, report: 5000 };
const SECTION_WORDS = { min: 150, max: 350 };   // report sections only

function words(text) { return String(text || "").trim().split(/\s+/).filter(Boolean); }

// Syllable heuristic: vowel groups, minus a trailing silent e, never below 1.
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let groups = (w.match(/[aeiouy]+/g) || []).length;
  if (w.length > 2 && w.endsWith("e") && !w.endsWith("le")) groups -= 1;
  return Math.max(1, groups);
}

// Flesch Reading Ease over a list of sentences.
function flesch(sentences) {
  const ws = sentences.flatMap((s) => words(s));
  if (!ws.length || !sentences.length) return null;
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  return Number((206.835 - 1.015 * (ws.length / sentences.length) - 84.6 * (syl / ws.length)).toFixed(1));
}

function overlap(a, b) {
  const A = new Set(words(a).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((w) => w.length > 3));
  const B = new Set(words(b).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((w) => w.length > 3));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

// draft: { type, deep, sections: [{ sectionId, title, headingLevel, paragraphs: [[{sid,text}]] }] }
// Returns { violations: [{rule, sectionId, sid?, detail}], readability, wordCount }
function lintDraft(draft) {
  const violations = [];
  const push = (rule, sectionId, sid, detail) => violations.push({ rule, sectionId, sid: sid || null, detail });
  const allSentences = [];
  let wordCount = 0;

  for (const sec of draft.sections || []) {
    const secSentences = [];
    if ((sec.headingLevel || 0) > MAX_HEADING_LEVEL) push("HEADING-DEPTH", sec.sectionId, null, `heading level ${sec.headingLevel} > ${MAX_HEADING_LEVEL}`);
    for (const para of sec.paragraphs || []) {
      let sameOpenerRun = 1, lastOpener = null;
      for (const s of para) {
        const ws = words(s.text);
        wordCount += ws.length;
        secSentences.push(s.text); allSentences.push(s.text);
        if (ws.length > MAX_SENTENCE_WORDS) push("RULE-12", sec.sectionId, s.sid, `${ws.length} words (max ${MAX_SENTENCE_WORDS})`);
        const lower = ` ${String(s.text).toLowerCase()} `;
        for (const f of FILLER) if (lower.includes(f)) push("RULE-04", sec.sectionId, s.sid, `filler "${f.trim()}"`);
        const opener = (ws[0] || "").toLowerCase().replace(/[^a-z]/g, "");
        if (opener && opener === lastOpener) { sameOpenerRun++; if (sameOpenerRun === 3) push("RULE-C", sec.sectionId, s.sid, `three consecutive sentences open with "${opener}"`); }
        else sameOpenerRun = 1;
        lastOpener = opener;
      }
      if (para.length >= 3 && overlap(para[0].text, para[para.length - 1].text) > 0.6) {
        push("RULE-E", sec.sectionId, para[para.length - 1].sid, "last sentence restates the first");
      }
    }
    if (secSentences.length >= 2) {
      const fre = flesch(secSentences);
      if (fre !== null && (fre < READABILITY_BAND[0] || fre > READABILITY_BAND[1])) push("READABILITY", sec.sectionId, null, `Flesch ${fre} outside ${READABILITY_BAND.join("–")}`);
    }
    if (draft.type === "report" && !sec.generated) {
      const n = secSentences.reduce((a, s) => a + words(s).length, 0);
      if (n && (n < SECTION_WORDS.min || n > SECTION_WORDS.max)) push("SECTION-LENGTH", sec.sectionId, null, `${n} words (band ${SECTION_WORDS.min}–${SECTION_WORDS.max})`);
    }
  }
  const budget = (draft.deep ? DEEP_WORD_BUDGET : WORD_BUDGET)[draft.type] || WORD_BUDGET.report;
  if (wordCount > budget) push("BUDGET", null, null, `${wordCount} words > ${budget} for type ${draft.type}`);
  return { violations, readability: flesch(allSentences), wordCount, budget };
}

module.exports = { lintDraft, flesch, syllables, WORD_BUDGET, DEEP_WORD_BUDGET, FILLER, MAX_SENTENCE_WORDS };
