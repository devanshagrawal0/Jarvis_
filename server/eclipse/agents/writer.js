// Writer agent — slice 2.2 B1. Replaces the synthesize node's single "write the answer" call
// with the blueprint §4 pipeline: type+outline → per-section attribute-first generation →
// code-inserted conflicts → code-generated Not-established → polish (lead written LAST, cuts)
// → deterministic lint + ONE fix pass → omission guard. Output is a typed BLOCK stream (§5)
// plus a sentence→claim map (§6); markdown is rendered from the blocks afterwards.
//
// The Writer holds no toolbox. It cannot fetch, compute, or spawn — not by lease denial but
// because this function is never handed a tool to call. Its only input is the verified claim
// set the caller assembled; its only output is text that names the claims each sentence uses.
const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { lintDraft, WORD_BUDGET, DEEP_WORD_BUDGET } = require("./writer-lint");

const TYPES = ["answer", "memo", "report", "comparison", "timeline"];
const CRAFT_DIR = path.join(__dirname, "writer-craft");

let craftCache = null;
function loadCraft() {
  if (craftCache) return craftCache;
  const rd = (p) => { try { return fs.readFileSync(path.join(CRAFT_DIR, p), "utf8"); } catch { return ""; } };
  craftCache = {
    rules: rd("references/agent-style-21.md"),
    pyramid: rd("references/pyramid-scqa.md"),
    plain: rd("references/plain-language.md"),
    voice: rd("references/voice.md"),
    exemplars: Object.fromEntries(TYPES.map((t) => [t, rd(`exemplars/${t}.md`)])),
  };
  return craftCache;
}

// ── schemas (the born-attributed invariant lives here) ───────────────────────────────────────
const SentenceSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["fact", "transition", "analysis"]),
  claimIds: z.array(z.string()).default([]),
}).superRefine((s, ctx) => {
  if (s.kind !== "transition" && s.claimIds.length === 0) ctx.addIssue({ code: "custom", message: `a "${s.kind}" sentence must carry at least one claimId` });
  if (s.kind === "transition" && s.claimIds.length > 0) ctx.addIssue({ code: "custom", message: "a transition sentence carries no claimIds" });
});
const OutlineSchema = z.object({
  type: z.enum(TYPES),
  why: z.string(),
  title: z.string().optional().default(""),
  sections: z.array(z.object({
    sectionId: z.string().min(1),
    title: z.string().min(1),
    reqIds: z.array(z.string()).default([]),
    claimIds: z.array(z.string()).default([]),
    targetWords: z.coerce.number().int().positive(),
  })).min(1).max(8),
});
const SectionSchema = z.object({
  paragraphs: z.array(z.array(SentenceSchema).min(1)).min(1).max(6),
  keyfacts: z.array(z.object({ text: z.string().min(1), claimIds: z.array(z.string()).min(1) })).default([]),
  table: z.object({ headers: z.array(z.string()).min(2), rows: z.array(z.array(z.string())).min(1), claimIds: z.array(z.string()).min(1) }).optional(),
  unused: z.array(z.object({ claimId: z.string(), reason: z.string() })).default([]),
});
const PolishSchema = z.object({
  lead: z.array(SentenceSchema).default([]),
  cuts: z.array(z.object({ sid: z.string(), reason: z.string() })).default([]),
  unusedReasons: z.array(z.object({ claimId: z.string(), reason: z.string() })).default([]),
});
const LintFixSchema = z.object({ rewrites: z.array(z.object({ sid: z.string(), text: z.string().min(1) })) });

const uniq = (a) => [...new Set(a.filter(Boolean))];
const wc = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;

// ── the pipeline ─────────────────────────────────────────────────────────────────────────────
// run: (opts) => adapter result — the attributed model-call boundary (runAs bound to "writer").
// emit: (type, payload) => void — the mission event stream.
async function runWriter({ run, systemPrompt, mission, contract = null, coverage = null, validated = [], conflicts = [], effort, priorTurns = "", emit, budgets = {} }) {
  if (!validated.length) throw new Error("writer invoked with 0 validated claims (the gate must abstain before this)");
  const craft = loadCraft();
  const deep = effort === "deep";
  const calls = { outline: 0, section: 0, polish: 0, lintFix: 0 };
  const maxSections = Math.min(8, budgets.perSection || 8);

  // Claims as the Writer sees them: id, text, and the quotes/sources that verified them.
  const claims = validated.map((p, i) => ({
    claimId: String(p.claimId || p.packetId), idx: i + 1, text: String(p.claim || ""), confidence: p.confidence,
    sources: uniq((p.evidence || []).map((e) => e.sourceUri)),
    quotes: uniq((p.evidence || []).map((e) => e.quote)).slice(0, 2),
  }));
  const byId = new Map(claims.map((c) => [c.claimId, c]));

  // Requirements → claimIds. Coverage rows carry 1-based indices into `validated` (verify-claim).
  const reqRows = (coverage && coverage.requirements) || (contract && contract.requirements) || [];
  const reqs = reqRows.map((r) => ({
    id: String(r.id !== undefined ? r.id : r.reqId), text: r.text, status: r.status || "UNKNOWN",
    claimIds: ((r.claimIds) || []).map((n) => (claims[Number(n) - 1] || {}).claimId).filter(Boolean),
  }));
  const answeredReqIds = reqs.filter((r) => r.claimIds.length).map((r) => r.id);

  const system = [
    systemPrompt || "You are the Writer.",
    "", "OWNER VOICE (overrides every default below):", craft.voice,
    "", "STYLE RULES:", craft.rules,
    "", "STRUCTURE:", craft.pyramid,
    "", "PLAIN LANGUAGE:", craft.plain,
  ].join("\n");
  const call = (schema, input) => run({ node: "synthesize", agentRole: "writer", effort, schema, system, input });

  // ── 2. type + outline (coverage-checked in code; can be rejected) ──────────────────────────
  const reqList = reqs.length
    ? reqs.map((r) => `${r.id} [${r.status}] ${r.text} -> claims: ${r.claimIds.join(", ") || "none"}`).join("\n")
    : "(no contract for this mission — group the claims by the reader's likely questions)";
  const claimList = claims.map((c) => `${c.claimId}: ${c.text.slice(0, 240)}`).join("\n");
  const outlineInput = (errors) => `${priorTurns}MISSION: ${mission.prompt || ""}\n\nREQUIREMENTS (the reader's asks, in order):\n${reqList}\n\n`
    + `VERIFIED CLAIMS (the only facts that may appear in the piece):\n${claimList}\n\n`
    + `Choose the artifact TYPE: "answer" (≤3 claims answering a single fact; exactly ONE section, no headings, ≤120 words), `
    + `"memo" (snapshot/brief, ≤400 words), "report" (multi-requirement research, sections of 150–350 words), `
    + `"comparison" (X vs Y on dimensions; a table is the centrepiece), "timeline" (how something unfolded, dated steps). `
    + `Say WHY in one sentence.\n`
    + `Then the OUTLINE: sections in the reader's question order. Each section owns requirement ids; every requirement that has claims must be owned by exactly one section. `
    + `For claims not tied to any requirement, list their claimIds on the section that will use them. Headings are claims, not labels. `
    + `Give each section a targetWords.${errors ? `\n\nYOUR PREVIOUS OUTLINE WAS REJECTED:\n- ${errors.join("\n- ")}\nFix exactly those problems.` : ""}\n`
    + `Return JSON {"type":"...","why":"...","title":"document title or empty","sections":[{"sectionId":"S1","title":"...","reqIds":["R1"],"claimIds":[],"targetWords":120}]}`;

  const outlineErrors = (o) => {
    const errs = [];
    const owners = new Map();
    for (const s of o.sections) for (const r of s.reqIds) owners.set(r, (owners.get(r) || []).concat(s.sectionId));
    for (const r of answeredReqIds) if (!owners.has(r)) errs.push(`requirement ${r} has claims but no section owns it`);
    for (const [r, secs] of owners) if (secs.length > 1) errs.push(`requirement ${r} is owned by ${secs.length} sections (${secs.join(", ")}); exactly one`);
    if (o.type === "answer" && o.sections.length !== 1) errs.push(`type "answer" must have exactly one section, got ${o.sections.length}`);
    if (o.sections.length > maxSections) errs.push(`at most ${maxSections} sections`);
    return errs;
  };

  let outline = null, errs = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    calls.outline++;
    const r = await call(OutlineSchema, outlineInput(attempt ? errs : null));
    outline = r.json;
    errs = outlineErrors(outline);
    if (!errs.length) break;
    emit("draft.outline.rejected", { attempt: attempt + 1, errors: errs });
  }
  if (errs.length) {
    // Bounded: two model attempts, then code repairs the structure so nothing is dropped.
    const owned = new Set(outline.sections.flatMap((s) => s.reqIds));
    const seen = new Set();
    for (const s of outline.sections) s.reqIds = s.reqIds.filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
    const missing = answeredReqIds.filter((r) => !owned.has(r));
    if (missing.length) outline.sections.push({ sectionId: "S-other", title: "Other findings", reqIds: missing, claimIds: [], targetWords: 150 });
    if (outline.type === "answer" && outline.sections.length > 1) {
      outline.sections = [{ sectionId: "S1", title: outline.sections[0].title, reqIds: uniq(outline.sections.flatMap((s) => s.reqIds)), claimIds: uniq(outline.sections.flatMap((s) => s.claimIds)), targetWords: 100 }];
    }
    outline.sections = outline.sections.slice(0, maxSections);
    emit("draft.outline.repaired", { errors: errs, sections: outline.sections.map((s) => s.sectionId) });
  }

  // Claim assignment: a section gets the claims of the requirements it owns plus any it named.
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const assigned = new Set();
  for (const s of outline.sections) {
    const ids = uniq([...s.reqIds.flatMap((r) => (reqById.get(r) || { claimIds: [] }).claimIds), ...s.claimIds.filter((c) => byId.has(c))]);
    s.claimIds = ids.filter((c) => !assigned.has(c));
    for (const c of s.claimIds) assigned.add(c);
  }
  const unassigned = claims.filter((c) => !assigned.has(c.claimId)).map((c) => c.claimId);
  if (unassigned.length) {
    // Every verified claim gets a home before writing starts — the omission guard at the end
    // then only has to catch what the model chose to skip, never what the outline lost.
    const home = outline.type === "answer" ? outline.sections[0]
      : (outline.sections.find((s) => s.sectionId === "S-other") || (outline.sections.length < maxSections
        ? outline.sections[outline.sections.push({ sectionId: "S-other", title: "Other findings", reqIds: [], claimIds: [], targetWords: 150 }) - 1]
        : outline.sections[outline.sections.length - 1]));
    home.claimIds = uniq([...home.claimIds, ...unassigned]);
    emit("draft.outline.unassigned", { claimIds: unassigned, section: home.sectionId });
  }
  emit("draft.outline", { type: outline.type, why: outline.why, title: outline.title, sections: outline.sections.map((s) => ({ sectionId: s.sectionId, title: s.title, reqIds: s.reqIds, claimIds: s.claimIds, targetWords: s.targetWords })) });

  // ── 3. per-section attribute-first generation ───────────────────────────────────────────
  const type = outline.type;
  const headingLevel = 2;   // sections are H2; a report's H1 is the document title written with the lead
  const sections = [];             // [{sectionId, title, headingLevel, generated, blocks:[], paragraphs:[[{sid,text,kind,claimIds}]]}]
  const unusedReasons = new Map(); // claimId -> reason (from the model)

  async function writeSection(s) {
    const secClaims = s.claimIds.map((c) => byId.get(c)).filter(Boolean);
    const secConflicts = conflicts.filter((c) => s.claimIds.includes(String(c.claimId)));
    const claimBlock = secClaims.map((c) => `${c.claimId}: ${c.text}` + (c.quotes.length ? `\n    quote: "${c.quotes[0].slice(0, 220)}"` : "") + (c.sources.length ? `\n    source: ${c.sources[0]}` : "")).join("\n");
    const conflictBlock = secConflicts.length
      ? `\nCONTESTED (present both sides in prose; pick no winner):\n${secConflicts.map((c) => `- ${c.claimId}: counter-evidence reported at ${c.counter && c.counter.uri ? c.counter.uri : "another source"}`).join("\n")}\n`
      : "";
    const input = (errors) => `${priorTurns}MISSION: ${mission.prompt || ""}\nARTIFACT TYPE: ${type}\nSECTION: "${s.title}" (target ${s.targetWords} words)\n\n`
      + `EXEMPLAR OF THIS TYPE (shape only — its facts are NOT yours):\n${craft.exemplars[type]}\n\n`
      + `CLAIMS FOR THIS SECTION (use ONLY these; cite by claimId):\n${claimBlock}\n${conflictBlock}\n`
      + `Write the section as paragraphs of sentences. Each sentence has a kind: "fact" (states something a claim says; MUST list its claimIds), `
      + `"analysis" (compares or aggregates claims; MUST list every claimId it draws on), or "transition" (asserts nothing checkable; no claimIds). `
      + `Every number, name, date and unit must come from a listed claim. Optional "keyfacts": up to 5 bullets, each with claimIds`
      + (type === "comparison" ? `, and a "table" {headers, rows, claimIds} with a subject per column and a dimension per row (write "not established" in any cell no claim covers)` : "")
      + `. List any claim you chose not to use under "unused" with a one-line reason. `
      + `Never write about coverage, verification, or confidence.${errors ? `\n\nYOUR PREVIOUS DRAFT WAS REJECTED:\n- ${errors.join("\n- ")}\nFix exactly those problems.` : ""}\n`
      + `Return JSON {"paragraphs":[[{"text":"...","kind":"fact","claimIds":["..."]}]],"keyfacts":[],"unused":[]}`;

    const known = new Set(secClaims.map((c) => c.claimId));
    const unknownIn = (out) => {
      const bad = new Set();
      for (const para of out.paragraphs) for (const st of para) for (const c of st.claimIds) if (!known.has(c)) bad.add(c);
      for (const k of out.keyfacts) for (const c of k.claimIds) if (!known.has(c)) bad.add(c);
      if (out.table) for (const c of out.table.claimIds) if (!known.has(c)) bad.add(c);
      return [...bad];
    };
    let out = null, bad = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      calls.section++;
      const r = await call(SectionSchema, input(attempt ? [`claimIds not in this section's list: ${bad.join(", ")}`] : null));
      out = r.json;
      bad = unknownIn(out);
      if (!bad.length) break;
      emit("draft.section.rejected", { sectionId: s.sectionId, attempt: attempt + 1, unknownClaimIds: bad });
    }
    // After two attempts, anything still citing an unknown id is REMOVED — a sentence that
    // names a claim this section was never given is a sentence we cannot attribute.
    if (bad.length) {
      const badSet = new Set(bad);
      out.paragraphs = out.paragraphs.map((p) => p.filter((st) => !st.claimIds.some((c) => badSet.has(c)))).filter((p) => p.length);
      out.keyfacts = out.keyfacts.filter((k) => !k.claimIds.some((c) => badSet.has(c)));
      if (out.table && out.table.claimIds.some((c) => badSet.has(c))) out.table = undefined;
      emit("draft.sentence.rejected", { sectionId: s.sectionId, unknownClaimIds: bad });
    }
    const sec = { sectionId: s.sectionId, title: s.title, headingLevel, generated: false, blocks: [], paragraphs: [] };
    if (type !== "answer") sec.blocks.push({ kind: "heading", level: headingLevel, text: s.title });
    for (const k of out.keyfacts) sec.blocks.push({ kind: "keyfact", text: k.text, claimIds: uniq(k.claimIds) });
    out.paragraphs.forEach((para, pi) => {
      const sentences = para.map((st, si) => ({ sid: `${s.sectionId}.${pi + 1}.${si + 1}`, text: st.text, kind: st.kind, claimIds: uniq(st.claimIds) }));
      sec.paragraphs.push(sentences);
      sec.blocks.push({ kind: "para", sentences });
    });
    if (out.table) sec.blocks.push({ kind: "table", headers: out.table.headers, rows: out.table.rows, claimIds: uniq(out.table.claimIds), sourceCol: true });
    // 4. conflicts — inserted by CODE for every contested claim this section owns.
    for (const c of secConflicts) {
      const cl = byId.get(String(c.claimId));
      sec.blocks.push({ kind: "conflict", a: { text: cl.text, claimId: cl.claimId }, b: { text: (c.counter && c.counter.text) || "counter-evidence reported", uri: (c.counter && c.counter.uri) || null } });
    }
    for (const u of out.unused) if (known.has(u.claimId)) unusedReasons.set(u.claimId, u.reason);
    return sec;
  }

  // Sections are independent (each sees only its own claims), so they write in parallel, three
  // at a time, and stream in completion order — the outline already gave the reader the skeleton.
  const queue = [...outline.sections];
  while (queue.length) {
    const batch = queue.splice(0, 3);
    const done = await Promise.all(batch.map(writeSection));
    for (const sec of done) {
      sections.push(sec);
      for (const b of sec.blocks) emit("draft.block", { sectionId: sec.sectionId, block: b });
    }
  }
  sections.sort((a, b) => outline.sections.findIndex((s) => s.sectionId === a.sectionId) - outline.sections.findIndex((s) => s.sectionId === b.sectionId));

  // ── 5. Not-established — code-generated from the coverage rows the model never sees ────────
  const gaps = reqs.filter((r) => r.status !== "ANSWERED" && r.status !== "UNKNOWN");
  if (gaps.length) {
    const sec = { sectionId: "S-gaps", title: "Not established", headingLevel, generated: true, blocks: [], paragraphs: [] };
    sec.blocks.push({ kind: "heading", level: headingLevel, text: "Not established" });
    for (const g of gaps) sec.blocks.push({ kind: "callout", tone: "gap", text: `${g.text} — ${g.status === "PARTIAL" ? "only partly covered by the verified claims" : "no verified claim covers this"}.` });
    sections.push(sec);
    for (const b of sec.blocks) emit("draft.block", { sectionId: sec.sectionId, block: b });
  }

  const allSentences = () => sections.flatMap((s) => s.paragraphs.flat());
  const usedIds = () => {
    const u = new Set();
    for (const s of sections) for (const b of s.blocks) {
      if (b.kind === "para") for (const st of b.sentences) for (const c of st.claimIds) u.add(c);
      if ((b.kind === "keyfact" || b.kind === "table") && b.claimIds) for (const c of b.claimIds) u.add(c);
    }
    return u;
  };
  const revisions = [];
  const revise = (sid, before, after, reason) => { const ev = { sid, before, after, reason, by: "writer-polish" }; revisions.push(ev); emit("draft.revision", ev); };
  const budget = (deep ? DEEP_WORD_BUDGET : WORD_BUDGET)[type];

  // ── 6. polish — lead written LAST from what survived; cuts only; unused reasons ────────────
  if (type !== "answer") {
    const draftText = sections.filter((s) => !s.generated).map((s) => `## ${s.title} (${s.sectionId})\n` + s.paragraphs.map((p) => p.map((st) => `${st.sid}: ${st.text} [${st.claimIds.join(",") || st.kind}]`).join("\n")).join("\n\n")).join("\n\n");
    const used = usedIds();
    const unusedNow = claims.filter((c) => !used.has(c.claimId) && !unusedReasons.has(c.claimId)).map((c) => `${c.claimId}: ${c.text.slice(0, 160)}`);
    const total = allSentences().reduce((a, st) => a + wc(st.text), 0);
    const over = total > budget ? total - budget : 0;
    calls.polish++;
    const r = await call(PolishSchema, `${priorTurns}MISSION: ${mission.prompt || ""}\nARTIFACT TYPE: ${type} (word budget ${budget}; draft is ${total} words${over ? `, ${over} OVER — you must cut at least that many` : ""})\n\n`
      + `THE DRAFT (sid: sentence [claimIds]):\n${draftText}\n\n`
      + `VERIFIED CLAIMS NOT USED ANYWHERE (give a one-line reason each, or they cannot ship):\n${unusedNow.join("\n") || "(none)"}\n\n`
      + `Do three things. (1) "cuts": sids of sentences that repeat another section, say nothing, or must go to fit the budget — with a reason each. You may only CUT, never rewrite. `
      + `(2) "lead": ${type === "report" || type === "memo" ? "the opening summary (SCQA, 3–5 sentences, answer first) compressed from what survived; every fact/analysis sentence carries the claimIds it rests on" : "leave empty"}. `
      + `(3) "unusedReasons": one entry per unused claim listed above.\n`
      + `Return JSON {"lead":[{"text":"...","kind":"fact","claimIds":["..."]}],"cuts":[{"sid":"S1.1.2","reason":"..."}],"unusedReasons":[{"claimId":"...","reason":"..."}]}`);
    const p = r.json;
    for (const cut of p.cuts) {
      for (const sec of sections) for (const para of sec.paragraphs) {
        const i = para.findIndex((st) => st.sid === cut.sid);
        if (i >= 0) { revise(cut.sid, para[i].text, "", `polish: ${cut.reason}`); para.splice(i, 1); }
      }
    }
    for (const sec of sections) { sec.paragraphs = sec.paragraphs.filter((p) => p.length); sec.blocks = sec.blocks.filter((b) => b.kind !== "para" || b.sentences.some((st) => sec.paragraphs.flat().includes(st))); }
    for (const u of p.unusedReasons) if (byId.has(u.claimId)) unusedReasons.set(u.claimId, u.reason);
    const leadOk = p.lead.filter((st) => st.claimIds.every((c) => byId.has(c)));
    if (leadOk.length < p.lead.length) emit("draft.sentence.rejected", { sectionId: "S-lead", unknownClaimIds: uniq(p.lead.flatMap((st) => st.claimIds.filter((c) => !byId.has(c)))) });
    if (leadOk.length) {
      const sentences = leadOk.map((st, i) => ({ sid: `S-lead.1.${i + 1}`, text: st.text, kind: st.kind, claimIds: uniq(st.claimIds) }));
      const sec = { sectionId: "S-lead", title: outline.title || "", headingLevel: 1, generated: false, blocks: [], paragraphs: [sentences] };
      if (outline.title) sec.blocks.push({ kind: "heading", level: 1, text: outline.title });
      sec.blocks.push({ kind: "para", sentences });
      sections.unshift(sec);
      for (const b of sec.blocks) emit("draft.block", { sectionId: "S-lead", block: b });
    }
  }

  // ── 7. lint → one fix pass → lint again ───────────────────────────────────────────────────
  const lintInput = () => ({ type, deep, sections: sections.map((s) => ({ sectionId: s.sectionId, headingLevel: s.headingLevel, generated: s.generated, paragraphs: s.paragraphs })) });
  let lint = lintDraft(lintInput());
  emit("draft.lint", { pass: 1, violations: lint.violations, readability: lint.readability, wordCount: lint.wordCount, budget: lint.budget });
  const fixable = lint.violations.filter((v) => v.sid);
  if (fixable.length) {
    const bySid = new Map(allSentences().map((st) => [st.sid, st]));
    // One line per sentence, all its rules together — a sid flagged twice is still one rewrite.
    const rulesFor = new Map();
    for (const v of fixable) rulesFor.set(v.sid, (rulesFor.get(v.sid) || []).concat(`${v.rule}: ${v.detail}`));
    const list = [...rulesFor].map(([sid, rules]) => `${sid} [${rules.join("; ")}]: ${(bySid.get(sid) || {}).text}`).join("\n");
    calls.lintFix++;
    try {
      const r = await call(LintFixSchema, `Rewrite ONLY these sentences to clear the flagged rule. Keep every fact, number and name exactly; change wording only. Same meaning, plainer, shorter.\n\n${list}\n\nReturn JSON {"rewrites":[{"sid":"...","text":"..."}]}`);
      const rewritten = new Set();
      for (const rw of r.json.rewrites) {
        const st = bySid.get(rw.sid);
        if (!st || !rulesFor.has(rw.sid) || rewritten.has(rw.sid)) continue;   // only flagged sids, once each
        if (rw.text === st.text) continue;                                       // no-op is not a revision
        rewritten.add(rw.sid);
        revise(rw.sid, st.text, rw.text, `lint: ${uniq(rulesFor.get(rw.sid).map((x) => x.split(":")[0])).join("+")}`);
        st.text = rw.text;                                                       // claimIds untouched
      }
    } catch (e) { emit("draft.lint.error", { error: String(e.message).slice(0, 200) }); }
    lint = lintDraft(lintInput());
    emit("draft.lint", { pass: 2, violations: lint.violations, readability: lint.readability, wordCount: lint.wordCount, budget: lint.budget });
  }

  // ── 8. omission guard — every verified claim is used or listed with a reason ──────────────
  const used = usedIds();
  const unused = claims.filter((c) => !used.has(c.claimId)).map((c) => ({ claimId: c.claimId, text: c.text, reason: unusedReasons.get(c.claimId) || null }));
  const omissionOk = unused.every((u) => u.reason);
  if (unused.length) {
    const sec = { sectionId: "S-unused", title: "Verified but not used", headingLevel, generated: true, blocks: [], paragraphs: [] };
    sec.blocks.push({ kind: "unused", claims: unused.map((u) => ({ claimId: u.claimId, text: u.text, reason: u.reason || "(the writer gave no reason)" })) });
    sections.push(sec);
    for (const b of sec.blocks) emit("draft.block", { sectionId: "S-unused", block: b });
  }
  emit("draft.guard", { check: "omission", ok: omissionOk, unused: unused.map((u) => ({ claimId: u.claimId, reason: u.reason })) });

  const sentenceMap = allSentences().map((st) => ({ sid: st.sid, claimIds: st.claimIds }));
  const done = { type, version: 1, wordCount: lint.wordCount, readability: lint.readability, sections: sections.length, sentences: sentenceMap.length, guards: { omission: omissionOk, outline: errs.length === 0 }, calls };
  emit("draft.done", done);
  return { type, outline, sections, sentenceMap, lint, revisions, unused, claims, done };
}

// Sections already written survive a mid-pipeline failure (budget cap, model outage): the
// error carries them so the caller can render a PARTIAL draft instead of paying for a fallback
// call that would trip the same cap. `partial.sections` is empty when nothing was written.
async function runWriterSafe(args) {
  const partial = { sections: [], claims: [] };
  const emit = args.emit;
  const seen = new Map();
  args = { ...args, emit: (t, p) => {
    if (t === "draft.block") {
      if (!seen.has(p.sectionId)) { seen.set(p.sectionId, { sectionId: p.sectionId, blocks: [] }); partial.sections.push(seen.get(p.sectionId)); }
      seen.get(p.sectionId).blocks.push(p.block);
    }
    emit(t, p);
  } };
  partial.claims = args.validated.map((p) => ({ claimId: String(p.claimId || p.packetId), sources: [...new Set((p.evidence || []).map((e) => e.sourceUri).filter(Boolean))] }));
  try { return await runWriter(args); }
  catch (e) { e.partial = partial; throw e; }
}

module.exports = { runWriter, runWriterSafe, OutlineSchema, SectionSchema, PolishSchema, LintFixSchema, SentenceSchema, TYPES, loadCraft };

