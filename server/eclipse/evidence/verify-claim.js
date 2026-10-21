// ECLIPSE claim verification — decompose → numbered sentences → ID emission → deterministic resolve.
//
// This module exists because the previous approach was a stack of string heuristics (blind prefix
// slice, quote substring matching, a guessed word-overlap threshold, a term-density sliding window)
// and every one of them rejected TRUE claims in live runs. The replacement follows the established
// pipeline rather than inventing one:
//
//   1. DECOMPOSE the claim into atomic, decontextualised sub-claims. A claim is usually a
//      conjunction and its facts live in different parts of a document; judging the conjunction
//      against one contiguous span is structurally impossible. Each atom gets its own evidence set.
//      (FActScore arXiv:2305.14251, SAFE arXiv:2403.18802, DnDScore arXiv:2412.13175)
//   2. SENTENCE-SPLIT the WHOLE source and number the sentences. No truncation: at 3–12k chars the
//      document is ~1–3k tokens, and Google's FACTS Grounding judges 32k-token documents whole.
//      Numbering also converts "find it in the middle" into "enumerate a list", which mitigates the
//      lost-in-the-middle effect (Liu et al., TACL 2024).
//   3. JUDGE each atom against the numbered document; the model returns SENTENCE IDs, never quotes.
//   4. RESOLVE ids → text in code, by array index. Cited text is therefore verbatim by construction
//      and no string matching happens anywhere. This is the guarantee Anthropic's Citations API
//      provides, reimplemented on the one model key this system has.
//   5. AGGREGATE by conjunction: a claim asserting two facts where one is false is a false claim.
const { z } = require("zod");

const AtomsSchema = z.object({
  atoms: z.array(z.object({ id: z.number(), text: z.string().min(3) })).min(1).max(8),
});

const VerdictsSchema = z.object({
  verdicts: z.array(z.object({
    atom_id: z.number(),
    verdict: z.enum(["SUPPORTED", "REFUTED", "NOT_ENOUGH_INFO"]),
    evidence_sentence_ids: z.array(z.number()),
    confidence: z.number().min(0).max(1),
  })),
});

const CoverageSchema = z.object({
  coverage: z.array(z.object({
    requirement_id: z.union([z.number(), z.string()]), // numeric fallback ids OR contract "R1"-style
    status: z.enum(["ANSWERED", "PARTIAL", "UNANSWERED"]),
    claim_ids: z.array(z.number()),
  })),
});

const NEWLINE = String.fromCharCode(10);
const NORM = (x) => String(x || "").replace(/\s+/g, " ").trim();

// Real sentence segmentation via Intl.Segmenter — splitting on "." would break on decimals
// ("2.4 m") and abbreviations, which is exactly the data this system handles.
const MAX_UNIT = 300;   // chars; ~2.5x the observed median prose sentence
const MIN_UNIT = 30;    // shorter than this gets merged back, so a stray word is not citable

// Intl.Segmenter implements UAX#29, which defines sentences by terminal punctuation. A
// specification table flattened to text has none, so by spec it is ONE sentence — measured, a
// 1014-char unit. That is correct behaviour and a useless citation unit, so oversized units get
// split on weaker boundaries and finally on a hard cap.
function capSplit(s, max) {
  const soft = /(?<=[;:•·—–|])\s+|\s{2,}|(?<=[a-z0-9)\]])\s+(?=[A-Z][a-z])/g;
  const out = [];
  let buf = "";
  for (const tok of s.split(soft).filter(Boolean)) {
    if (buf && (buf + " " + tok).trim().length > max) { out.push(buf.trim()); buf = tok; }
    else buf = (buf + " " + tok).trim();
  }
  if (buf) out.push(buf.trim());
  // last resort: hard chunking with FULL coverage. The old `.{1,max}(\s|$)` regex silently
  // dropped the LEADING text of a whitespace-free unit (only tail positions could match),
  // so the dropped text could never be cited (E-2).
  const hardChunks = (c) => {
    const chunks = [];
    let i = 0;
    while (i < c.length) {
      let end = Math.min(i + max, c.length);
      if (end < c.length) {
        const ws = c.lastIndexOf(" ", end);
        if (ws > i + Math.floor(max / 2)) end = ws; // prefer a word boundary in the back half
      }
      chunks.push(c.slice(i, end).trim());
      i = end;
    }
    return chunks.filter(Boolean);
  };
  return out.flatMap((c) => (c.length <= max ? [c] : hardChunks(c)));
}

function splitSentences(text) {
  const t = NORM(text);
  if (!t) return [];
  let parts = [];
  try {
    const seg = new Intl.Segmenter("en", { granularity: "sentence" });
    for (const part of seg.segment(t)) {
      const v = String(part.segment || "").trim();
      if (v.length >= 2) parts.push(v);
    }
  } catch { /* Intl.Segmenter unavailable */ }
  if (!parts.length) parts = t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length >= 2);

  parts = parts.flatMap((p) => (p.length <= MAX_UNIT ? [p] : capSplit(p, MAX_UNIT)));

  const out = [];
  for (const p of parts) {
    if (out.length && (p.length < MIN_UNIT || out[out.length - 1].length < MIN_UNIT)) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

const numbered = (sents) => sents.map((s, i) => `[S${i + 1}] ${s}`).join("\n");

function createClaimVerifier({ run }) {
  // `run` is the model-call boundary: run({ node, effort, schema, system, input }) → { json }

  async function decompose(claim, effort) {
    const single = [{ id: 1, text: NORM(claim) }];
    try {
      const r = await run({
        node: "verify", effort, schema: AtomsSchema,
        system: "You split a factual claim into atomic sub-claims for independent verification.",
        input: `CLAIM:\n${claim}\n\n`
          + `Split this into the smallest set of atomic claims, each asserting exactly ONE fact.\n`
          + `Rules:\n`
          + `- Every atom must be DECONTEXTUALISED: repeat the full subject in each one. Never use "it", "they", or a bare pronoun.\n`
          + `- Do NOT split a single fact across atoms (a value and its unit stay together).\n`
          + `- If the claim already asserts exactly one fact, return it unchanged as a single atom.\n`
          + `- At most 6 atoms.\n`
          + `Return JSON {"atoms":[{"id":1,"text":"..."}]}.`,
      });
      const atoms = (r.json && r.json.atoms) || [];
      return atoms.length ? atoms.map((a, i) => ({ id: i + 1, text: NORM(a.text) })) : single;
    } catch (e) {
      // B-3: degrade visibly, not silently - a single-atom fallback caused by an ERROR is a
      // different fact than "the claim really was one atom", and downstream checks may care.
      single[0].degraded = String(e.message).slice(0, 160);
      return single;
    }
  }

  // F: a QUESTION is not a CLAIM. The claim splitter above assumes its input asserts facts, so it
  // shreds a 2-part question into spurious "requirements" and the coverage footer then lies. This
  // extracts the information REQUIREMENTS a complete answer must satisfy (nugget-style), model-driven.
  async function decomposeQuestion(question, effort) {
    const single = [{ id: 1, text: NORM(question) }];
    try {
      const r = await run({
        node: "verify", effort, schema: AtomsSchema,
        system: "You list the information requirements a complete answer to a question must satisfy.",
        input: `QUESTION:
${question}

`
          + `List the distinct things the user is asking for - one requirement per thing asked. `
          + `Rules:
`
          + `- One requirement per interrogative/aspect (e.g. "and" joining two asks = two requirements).
`
          + `- Phrase each as the information needed, decontextualised (name the subject, no pronouns).
`
          + `- Do NOT invent requirements the question did not ask for. A single-ask question yields ONE requirement.
`
          + `- At most 6.
`
          + `Return JSON {"atoms":[{"id":1,"text":"the information asked for"}]}.`,
      });
      const atoms = (r.json && r.json.atoms) || [];
      return atoms.length ? atoms.map((a, i) => ({ id: i + 1, text: NORM(a.text) })) : single;
    } catch { return single; }
  }

  // One call judges every atom against the whole numbered document.
  async function judge(atoms, sents, effort) {
    const doc = numbered(sents);
    const list = atoms.map((a) => `${a.id}. ${a.text}`).join("\n");
    const r = await run({
      node: "verify", effort, schema: VerdictsSchema,
      system: "You decide whether numbered source sentences support each atomic claim. You cite sentence numbers only.",
      // The claim appears BEFORE and AFTER the document: cheap insurance against position bias.
      input: `ATOMIC CLAIMS:\n${list}\n\n`
        + `SOURCE (numbered sentences):\n${doc}\n\n`
        + `ATOMIC CLAIMS (repeated):\n${list}\n\n`
        + `For EACH atomic claim decide:\n`
        + `- "SUPPORTED": the source sentences state or directly entail it.\n`
        + `- "REFUTED": the source sentences contradict it.\n`
        + `- "NOT_ENOUGH_INFO": the source does not address it.\n`
        + `Cite the sentence NUMBERS you relied on in evidence_sentence_ids. Never quote text; only give numbers.\n`
        + `A SUPPORTED or REFUTED verdict MUST cite at least one sentence number.\n`
        + `Return JSON {"verdicts":[{"atom_id":1,"verdict":"SUPPORTED","evidence_sentence_ids":[2],"confidence":0.9}]}.`,
    });
    return (r.json && r.json.verdicts) || [];
  }

  /* Verify one claim against one source's full text.
     Returns { supported, entailment, verdict, atoms:[...], quotes:[...], reason } */
  async function verifyAgainstSource({ claim, sourceText, effort, atoms: pre }) {
    const sents = splitSentences(sourceText);
    if (!sents.length) {
      return { supported: false, entailment: 0, verdict: "NOT_ENOUGH_INFO", atoms: [], quotes: [], reason: "source has no readable text" };
    }
    // Cross-source union: the caller may decompose ONCE and pass the same atoms for every
    // source, so per-atom verdicts line up across sources and can be unioned.
    const atoms = (pre && pre.length) ? pre : await decompose(claim, effort);
    let verdicts = [];
    try { verdicts = await judge(atoms, sents, effort); }
    catch (e) {
      return { supported: false, entailment: 0, verdict: "NOT_ENOUGH_INFO", atoms, quotes: [], reason: "verifier did not return a usable judgement" };
    }

    // ── Deterministic validation. This is the part that cannot be talked around by the model. ──
    const byId = new Map(verdicts.map((v) => [Number(v.atom_id), v]));
    const results = atoms.map((a) => {
      const v = byId.get(a.id);
      if (!v) return { atom: a, verdict: "NOT_ENOUGH_INFO", ids: [], confidence: 0, reason: "no verdict returned for this atom" };
      // Ids must be real positions in the document we actually sent.
      const ids = (v.evidence_sentence_ids || [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= sents.length);
      // A verdict that cannot point at evidence is not a verdict.
      if ((v.verdict === "SUPPORTED" || v.verdict === "REFUTED") && !ids.length) {
        return { atom: a, verdict: "NOT_ENOUGH_INFO", ids: [], confidence: 0, reason: "verdict cited no sentence" };
      }
      return { atom: a, verdict: v.verdict, ids, confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)) };
    });

    // Resolve ids → text ourselves, by index. Quotes are verbatim by construction.
    const quotes = [];
    for (const r of results) for (const id of r.ids) {
      const text = sents[id - 1];
      if (text && !quotes.some((q) => q.id === id)) quotes.push({ id, text });
    }

    // Conjunction: one false part makes the whole claim false.
    const refuted = results.filter((r) => r.verdict === "REFUTED");
    const supported = results.filter((r) => r.verdict === "SUPPORTED");
    const missing = results.filter((r) => r.verdict === "NOT_ENOUGH_INFO");

    if (refuted.length) {
      return {
        supported: false, entailment: 0, verdict: "REFUTED", atoms: results, quotes,
        reason: `source contradicts: "${refuted[0].atom.text}"`,
      };
    }
    if (supported.length === results.length) {
      const entailment = Math.min(...supported.map((r) => r.confidence || 0.5));
      return { supported: true, entailment, verdict: "SUPPORTED", atoms: results, quotes, reason: "every part of the claim is supported by the source" };
    }
    return {
      supported: false,
      // Partial support is reported honestly rather than rounded to zero.
      entailment: results.length ? supported.length / results.length : 0,
      verdict: "NOT_ENOUGH_INFO", atoms: results, quotes,
      reason: `source does not address: "${(missing[0] || results[0]).atom.text}"`,
    };
  }

  /* Which parts of the question did the verified claims actually answer?
     The planner produces subtasks (retrieval jobs); nothing held the list of the USER'S asks,
     so coverage was judged implicitly by the synthesiser — the one component structurally
     unable to notice what is missing. This makes the asks an explicit object and checks them. */
  async function checkCoverage({ question, validatedClaims = [], effort, requirements: contractReqs = null }) {
    // S1.B2: when the Conductor authored a contract, its requirements ARE the checklist -
    // the plan and the honesty footer are the same object. Post-hoc derivation is the fallback.
    const reqs = (contractReqs && contractReqs.length)
      ? contractReqs.map((r, i) => ({ id: r.id || i + 1, text: NORM(r.text) }))
      : await decomposeQuestion(question, effort);
    if (!reqs.length) return { requirements: [], gaps: [] };
    if (!validatedClaims.length) {
      return { requirements: reqs.map((r) => ({ ...r, status: "UNANSWERED", claimIds: [] })), gaps: reqs.map((r) => r.text) };
    }
    const reqList = reqs.map((r) => r.id + ". " + r.text).join(NEWLINE);
    const claimList = validatedClaims.map((c, i) => (i + 1) + ". " + String(c.claim || "").slice(0, 300)).join(NEWLINE);
    let rows = [];
    try {
      const r = await run({
        node: "verify", effort, schema: CoverageSchema,
        system: "You check which verified claims answer each part of a question. You cite claim numbers only.",
        input: "PARTS OF THE QUESTION:" + NEWLINE + reqList + NEWLINE + NEWLINE
          + "VERIFIED CLAIMS:" + NEWLINE + claimList + NEWLINE + NEWLINE
          + "For EACH part, say whether the verified claims ANSWERED it, PARTIAL, or UNANSWERED, "
          + "and list the claim numbers that answer it. A part is only ANSWERED if a listed claim states it." + NEWLINE
          + 'Return JSON {"coverage":[{"requirement_id":1,"status":"ANSWERED","claim_ids":[1]}]}.',
      });
      rows = (r.json && r.json.coverage) || [];
    } catch { rows = []; }

    // Ids compare as STRINGS: contract reqIds are "R1"-style, fallback ids are numeric - the
    // old Number() coercion made every contract requirement come back UNANSWERED.
    const byId = new Map(rows.map((x) => [String(x.requirement_id), x]));
    const requirements = reqs.map((rq) => {
      const row = byId.get(String(rq.id));
      const ids = ((row && row.claim_ids) || []).map(Number).filter((n) => n >= 1 && n <= validatedClaims.length);
      // A part cannot be ANSWERED without naming a claim: a check that can assert coverage
      // with no evidence is a check that cannot fail.
      const status = !row ? "UNANSWERED" : (row.status !== "UNANSWERED" && !ids.length) ? "UNANSWERED" : row.status;
      return { ...rq, status, claimIds: ids };
    });
    return { requirements, gaps: requirements.filter((r) => r.status !== "ANSWERED").map((r) => r.text) };
  }

  return { verifyAgainstSource, splitSentences, decompose, checkCoverage };
}

module.exports = { createClaimVerifier, splitSentences };
