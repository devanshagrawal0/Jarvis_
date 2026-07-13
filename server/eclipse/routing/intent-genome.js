// ECLIPSE routing — Intent Genome feature extraction. DETERMINISTIC (regex/keywords), no
// model call. A Flash-Lite refine hook is provided but only used for genuinely ambiguous
// prompts by eligibility.js (kept off in tests to spend zero Gemini). Safe on load.

const RX = {
  research:   /\b(research|investigate|look into|dig into|gather|literature|survey|competitive|landscape|find (all|out|the best|sources))\b/,
  compare:    /\b(compare|comparison|versus|vs\.?|difference between|tradeoffs?|pros and cons|which (is|are|one|should))\b/,
  analyze:    /\b(analy(?:[sz]e|sis|tics|st)|evaluate|assess|review|deep[- ]?dive|break ?down|audit|critique)\b/,
  build:      /\b(build|create|draft|write (a|an|the|me)|make me|generate (a|an)|design (a|an)|produce (a|an)|put together)\b/,
  extract:    /\b(summari[sz]e|tl;?dr|extract|key points?|pull out|condense)\b/,
  compute:    /\b(calculate|compute|how (much|many)|percentage|average|convert)\b/,
  fresh:      /\b(latest|current(ly)?|now|today|tonight|this (week|month|year)|20\d\d|recent(ly)?|live|right now|as of|news|price|stock|quote)\b/,
  consequence:/\b(email|e-mail|send|publish|post|tweet|dm|message|buy|sell|trade|transfer|pay|deposit|withdraw|delete|remove|deploy|schedule|book|order|sign|submit|cancel|call)\b/,
  ambiguous:  /\b(the thing|that thing|whatever|something|somehow|this stuff|that stuff)\b/,
  breadth:    /\b(landscape|comprehensive(ly)?|thorough(ly)?|exhaustive|everything|all (the )?(major|main|the)|market|ecosystem|full (picture|report|analysis)|draft a (brief|report|deck|memo|proposal))\b/,
  explicitDeep:/\b(deep[- ]?dive|research (this|it)?\s*(thoroughly|deeply|in ?depth)|full (research )?mission|do a full|comprehensive research|really dig)\b/,
  entityish:  /\b([A-Z][A-Za-z0-9.+-]{2,}(?:\s+[A-Z][A-Za-z0-9.+-]{2,})?)\b/g,
};

function lc(s) { return String(s || "").toLowerCase().trim(); }

// Returns {taskFamily, depth, consequence(0-1), freshness(0-1), ambiguity(0-1),
//          answerableFromMemory(0-1), breadth(0-1), explicitDeep(bool)}.
function extractGenome(prompt, { answerableFromMemory = 0 } = {}) {
  const t = lc(prompt);
  const words = t.split(/\s+/).filter(Boolean);
  const explicitDeep = RX.explicitDeep.test(t);

  // task family (priority order)
  let taskFamily = "chat";
  if (RX.research.test(t)) taskFamily = "research";
  else if (RX.compare.test(t)) taskFamily = "compare";
  else if (RX.analyze.test(t)) taskFamily = "analyze";
  else if (RX.build.test(t)) taskFamily = "build";
  else if (RX.extract.test(t)) taskFamily = "extract";
  else if (RX.compute.test(t)) taskFamily = "compute";
  else if (/^(what|who|when|where|which|is|are|does|do|can)\b/.test(t) && words.length <= 14 && !/ and | vs /.test(t)) taskFamily = "fact";

  // depth — estimate # of sub-questions / compared items
  const vs = (t.match(/\bvs\.?\b|\bversus\b/g) || []).length;
  const ands = (t.match(/\band\b/g) || []).length;
  const commas = (t.match(/,/g) || []).length;
  const qs = (t.match(/\?/g) || []).length;
  let depth = 1 + vs + Math.min(2, ands) + Math.min(2, Math.floor(commas / 1.5)) + Math.max(0, qs - 1);
  if (RX.breadth.test(t)) depth += 1;                 // breadth implies more sub-questions
  if (taskFamily === "chat" || taskFamily === "fact") depth = Math.min(depth, 1);

  const consequence = RX.consequence.test(t) ? (/\b(important|urgent|asap|critical)\b/.test(t) ? 1 : 0.7) : 0;
  const freshness = RX.fresh.test(t) ? 1 : 0;
  // ambiguity: explicit vague reference, or very short + no concrete noun
  const vagueRef = RX.ambiguous.test(t) || /\bwhat should i do\b/.test(t);
  const ambiguity = vagueRef ? 0.9 : (words.length <= 3 && taskFamily === "chat" ? 0.4 : 0.1);

  return { taskFamily, depth, consequence, freshness, ambiguity, answerableFromMemory, breadth: RX.breadth.test(t) ? 1 : 0, explicitDeep };
}

module.exports = { extractGenome, RX };
