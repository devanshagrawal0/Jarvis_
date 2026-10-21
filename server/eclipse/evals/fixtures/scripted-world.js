// Shared scripted world: a deterministic model + fake web used by the Wave-2 e2e gate AND by
// the UI fixture generator. One copy so the two can never drift apart.
// ── the fake world ──────────────────────────────────────────────────────────────────────────
const PAGES = {
  "https://gov.example/official-report": "The agency reports that national output reached 51,000 tonnes in 2025. Reserves are estimated at 1.9 million tonnes. Import reliance was 79 percent.",
  "https://news.example/mirror": "The agency reports that national output reached 51,000 tonnes in 2025. Reserves are estimated at 1.9 million tonnes. Import reliance was 79 percent.", // syndicated copy
  "https://news.example/companies": "Northwind Minerals and Cascade Resources are the two largest listed producers by output.",
  "https://data.example/api/v1/prices.json": "{}",
  "https://junk.example/ads": "Buy cheap widgets. Limited offer.",
};
// Contract (tools/index.js): search(queryString) -> Array<{url,title}>. NOT an object.
const fakeSearch = async (query) =>
  Object.keys(PAGES).filter((u) => !/api/.test(u)).map((u) => ({ url: u, title: u.split("/").pop() }));
let networkFetches = 0;
const fakeFetch = async (url) => {
  networkFetches++;
  return PAGES[url] !== undefined
    ? { text: PAGES[url], status: 200, live: true, finalUrl: url }
    : { text: "", status: 404, live: false, finalUrl: url };
};

// ── the scripted model: one function, dispatching on the prompt's own contract ──────────────
// It answers ONLY what the real prompts ask for, so a prompt/schema change breaks this loudly.
function makeLiveCall(opts = {}) {
  const seen = { contract: 0, staffing: 0, variants: 0, digest: 0, coverage: 0, judge: 0, selfcheck: 0, titles: 0, critic: 0, counter: 0, other: 0,
    outline: 0, section: 0, sectionBad: 0, polish: 0, lintFix: 0, director: 0 };
  const liveCall = async (call) => {
    const inp = String(call.input || "");
    const usage = { tokensIn: 100, tokensOut: 50 };
    const J = (json) => ({ text: JSON.stringify(json), json, usage });

    if (inp.includes("Write the CONTRACT for this mission")) {
      seen.contract++;
      return J({ requirements: [
        { reqId: "R1", text: "National output and reserves for 2025", freshness: "recent" },
        { reqId: "R2", text: "The largest producing companies", freshness: "stable" },
        { reqId: "R3", text: "Something no source will ever cover", freshness: "stable" },
      ], guesses: ["assuming the national market"] });
    }
    if (inp.includes("CONTRACT (every requirement must be owned by exactly one hire)")) {
      seen.staffing++;
      // First attempt deliberately omits R3 → critic#1 must reject it and feed the error back.
      if (seen.staffing === 1 && !opts.skipBadPlan) {
        return J({ complexityClass: "comparison", assumptions: ["national scope"],
          hires: [
            { agentId: "research-scout", tier: "normal", difficultyRank: 1, why: "numbers",
              brief: { objective: "Find national output and reserves", angle: "numbers", outputHint: "claims", sourceHints: [], boundary: ["scout 2 owns companies"], reqIds: ["R1"], freshnessNote: "" } },
            { agentId: "research-scout", tier: "normal", difficultyRank: 2, why: "companies",
              brief: { objective: "Find the largest producing companies", angle: "companies", outputHint: "claims", sourceHints: [], boundary: ["scout 1 owns output"], reqIds: ["R2"], freshnessNote: "" } },
          ],
          notHired: [{ agentId: "writer", why: "pipeline stage" }, { agentId: "critic", why: "pipeline stage" }, { agentId: "screen-context", why: "no screen" }] });
      }
      return J({ complexityClass: "comparison", assumptions: ["national scope"],
        hires: [
          { agentId: "research-scout", tier: "normal", difficultyRank: 1, why: "numbers",
            brief: { objective: "Find national output and reserves", angle: "numbers", outputHint: "claims", sourceHints: [], boundary: ["scout 2 owns companies"], reqIds: ["R1"], freshnessNote: "" } },
          { agentId: "research-scout", tier: "normal", difficultyRank: 2, why: "companies",
            brief: { objective: "Find the largest producing companies", angle: "companies", outputHint: "claims", sourceHints: [], boundary: ["scout 1 owns output"], reqIds: ["R2", "R3"], freshnessNote: "" } },
        ],
        notHired: [{ agentId: "writer", why: "pipeline stage" }, { agentId: "critic", why: "pipeline stage" }, { agentId: "screen-context", why: "no screen" }] });
    }
    if (inp.includes('Return JSON {"variants"')) { seen.variants++; return J({ variants: ["query one", "query two"] }); }
    if (inp.includes('Return JSON {"scores"')) {
      seen.titles++;
      const lines = inp.split("\n").filter((l) => /^\d+\. /.test(l));
      return J({ scores: lines.map((l, i) => ({ i, score: /ads/.test(l) ? 0.05 : 0.9 })) });
    }
    if (inp.includes("Return JSON: digest")) {
      seen.digest++;
      const src = inp.split("SOURCE (")[1].split("):")[0];
      const body = PAGES[src] || "";
      if (/51,000 tonnes/.test(body)) {
        return J({ digest: "output", pubDate: "2026-03-01", sourceClass: "official",
          claims: [{ text: "National output reached 51,000 tonnes in 2025.", quote: "The agency reports that national output reached 51,000 tonnes in 2025." }],
          gapQuestions: [], chaseUrls: [] });
      }
      if (/Northwind/.test(body)) {
        return J({ digest: "companies", pubDate: "2026-02-01", sourceClass: "news",
          claims: [{ text: "Northwind Minerals and Cascade Resources are the largest listed producers.", quote: "Northwind Minerals and Cascade Resources are the two largest listed producers by output." }],
          gapQuestions: [], chaseUrls: [] });
      }
      return J({ digest: "", pubDate: null, sourceClass: "other", claims: [], gapQuestions: [], chaseUrls: [] });
    }
    if (inp.includes("PACKET ")) {
      seen.critic++;
      const ids = [...inp.matchAll(/^PACKET (\S+)/gm)].map((x) => x[1]);
      return J({ critiques: ids.map((pid) => ({ packetId: pid, verdict: "accept", reason: "" })),
        sources: [...new Set([...inp.matchAll(/(https?:\/\/\S+?) ::/g)].map((x) => x[1]))].map((u) => ({ uri: u, credibility: /gov\./.test(u) ? 0.95 : 0.6 })) });
    }
    if (inp.includes('"counterQuery"')) { seen.counter++; return J({ counterQuery: "is that output figure disputed" }); }
    if (inp.includes('Return JSON {"covered"')) { seen.selfcheck++; return J({ covered: ["R1"], weak: [], missing: [] }); }
    if (inp.includes("ATOMIC CLAIMS:")) {
      seen.judge++;
      const doc = inp.split("SOURCE (numbered sentences):")[1].split("ATOMIC CLAIMS (repeated):")[0];
      const sents = doc.split("\n").map((l) => l.match(/^\[S(\d+)\]\s+(.*)$/)).filter(Boolean);
      const atoms = inp.split("ATOMIC CLAIMS:")[1].split("SOURCE (numbered sentences):")[0]
        .split("\n").map((l) => l.match(/^(\d+)\.\s+(.*)$/)).filter(Boolean);
      const words = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9]{4,}/g) || []);
      return J({ verdicts: atoms.map((a) => {
        const aw = words(a[2]);
        const hit = sents.find((sl) => { const sw = words(sl[2]); let n = 0; for (const w of aw) if (sw.has(w)) n++; return n >= Math.min(3, aw.size); });
        return hit
          ? { atom_id: Number(a[1]), verdict: "SUPPORTED", evidence_sentence_ids: [Number(hit[1])], confidence: 0.9 }
          : { atom_id: Number(a[1]), verdict: "NOT_ENOUGH_INFO", evidence_sentence_ids: [], confidence: 0.2 };
      }) });
    }
    if (inp.includes("PARTS OF THE QUESTION:")) {
      seen.coverage++;
      // R1/R2 answered by the claims; R3 never — this is what must trigger the follow-up wave.
      // Claim numbers are matched by content so the Writer's requirement→claim map is real.
      const rows = inp.split("PARTS OF THE QUESTION:")[1].split("VERIFIED CLAIMS:")[0]
        .split("\n").map((l) => l.match(/^(\S+)\.\s+(.*)$/)).filter(Boolean);
      const claimsListed = inp.split("VERIFIED CLAIMS:")[1].split("\n").map((l) => l.match(/^(\d+)\.\s+(.*)$/)).filter(Boolean);
      const idsWhere = (re) => claimsListed.filter((c) => re.test(c[2])).map((c) => Number(c[1]));
      return J({ coverage: rows.map((r) => {
        if (/no source/i.test(r[2])) return { requirement_id: r[1], status: "UNANSWERED", claim_ids: [] };
        const ids = /compan/i.test(r[2]) ? idsWhere(/Northwind/) : idsWhere(/output|reserves/i);
        return ids.length ? { requirement_id: r[1], status: "ANSWERED", claim_ids: ids } : { requirement_id: r[1], status: "UNANSWERED", claim_ids: [] };
      }) });
    }

    // ── the Writer (slice 2.2): outline → sections → polish → lint fix ──────────────────────
    if (inp.includes("Choose the artifact TYPE:")) {
      seen.outline++;
      const reqs = [...inp.matchAll(/^(R\d+) \[(\w+)\] .*-> claims: (.*)$/gm)];
      const withClaims = reqs.filter((r) => r[3] !== "none").map((r) => r[1]);
      // First attempt (when asked to) leaves a requirement unowned → the code coverage check rejects it.
      const sections = withClaims.map((rid, i) => ({ sectionId: `S${i + 1}`, title: rid === "R1" ? "Output reached 51,000 tonnes" : "Two producers dominate", reqIds: [rid], claimIds: [], targetWords: 60 }));
      if (opts.badOutline && seen.outline === 1) sections.pop();
      return J({ type: "memo", why: "two short asks with numbers and names — a brief, not a report", title: "", sections });
    }
    if (inp.includes("CLAIMS FOR THIS SECTION")) {
      seen.section++;
      const block = inp.split("CLAIMS FOR THIS SECTION (use ONLY these; cite by claimId):")[1].split("\nWrite the section")[0];
      const ids = [...block.matchAll(/^([A-Za-z0-9_-]+): (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
      let sentences = ids.map((c) => ({ text: c.text, kind: "fact", claimIds: [c.id] }));
      // Break test: silently drop the producers claim (no "unused" entry) → the omission guard must catch it.
      if (opts.omitClaim && ids.some((c) => /Northwind/.test(c.text))) sentences = [{ text: "The producer picture is covered elsewhere.", kind: "transition", claimIds: [] }];
      if (/Output reached/.test(inp) && !inp.includes("[repair]")) {
        seen.sectionBad++;
        // A fact sentence with NO claimIds — the schema must reject it and the repair pass fix it.
        return J({ paragraphs: [[{ text: "This figure comes from the agency report.", kind: "fact", claimIds: [] }]], keyfacts: [], unused: [] });
      }
      const long = { text: "In order to understand the position it is important to note that the reported output figure, the reserve estimate and the import reliance number all come from the same agency report published in the spring of the following year.", kind: "analysis", claimIds: ids.slice(0, 1).map((c) => c.id) };
      const para = /Output reached/.test(inp) ? [...sentences, { text: "Two producers account for most of it.", kind: "transition", claimIds: [] }, long] : sentences;
      return J({ paragraphs: [para], keyfacts: /Output reached/.test(inp) ? [{ text: "Output: 51,000 tonnes (2025)", claimIds: [ids[0].id] }] : [], unused: [] });
    }
    if (inp.includes("THE DRAFT (sid: sentence [claimIds])")) {
      seen.polish++;
      if (opts.polishThrows) { const e = new Error("[eclipse] budget cap reached at polish"); e.code = "ECLIPSE_BUDGET"; throw e; }   // break test: mid-pipeline failure
      const lines = [...inp.matchAll(/^(S\S+): (.*) \[([^\]]*)\]$/gm)];
      const facts = lines.filter((l) => l[3] !== "transition" && l[3] !== "analysis");
      const cuts = lines.filter((l) => l[3] === "transition").map((l) => ({ sid: l[1], reason: "says nothing the next sentence does not" }));
      return J({ lead: facts.slice(0, 1).map((l) => ({ text: "Output rose while two producers kept their lead.", kind: "analysis", claimIds: l[3].split(",") })), cuts, unusedReasons: [] });
    }
    if (inp.includes("Rewrite ONLY these sentences")) {
      seen.lintFix++;
      const sids = [...inp.matchAll(/^(S\S+) \[/gm)].map((m) => m[1]);
      return J({ rewrites: sids.map((sid) => ({ sid, text: "All three numbers come from the same agency report." })) });
    }
    if (inp.includes("atoms")) { seen.other++; return J({ atoms: [{ id: 1, text: "a" }] }); }
    if (inp.includes("Write the final answer using ONLY the findings above")) { seen.director++; return { text: "Legacy director answer citing the findings.", usage }; }
    seen.other++;
    return { text: "Report body citing the verified findings.", usage };
  };
  return { liveCall, seen };
}

function mission(id, prompt) {
  return { schemaVersion: "eclipse.mission.v1", missionId: id, userId: "dev", prompt, effort: "pulse",
    constraints: { maxCostUsd: 0.5 },   // production cap, not the ledger default
    createdAt: new Date(0).toISOString() };
}


module.exports = { PAGES, fakeSearch, fakeFetch, makeLiveCall, mission };
