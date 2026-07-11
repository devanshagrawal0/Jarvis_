const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createResearchV2,
  classifyResearchIntent,
  expandResearchQueries,
  rankSources,
  trustedTime,
} = require("../../server/research-v2");

test("research v2 expands relative-date local questions into multiple useful angles", () => {
  const time = trustedTime("America/New_York", new Date("2026-06-26T12:00:00Z"));
  const queries = expandResearchQueries("what is Boston tomorrow", {
    intent: "local_briefing",
    time,
    limit: 10,
  });
  assert.ok(queries.some((query) => query.includes("2026-06-27")));
  assert.ok(queries.some((query) => /Boston events/i.test(query)));
  assert.ok(queries.some((query) => /Boston weather/i.test(query)));
  assert.ok(queries.some((query) => /Boston sports schedule/i.test(query)));
});

test("research v2 classifies major public research categories", () => {
  assert.equal(classifyResearchIntent("what fifa games are tomorrow"), "sports");
  assert.equal(classifyResearchIntent("weather in Boston tomorrow"), "weather");
  assert.equal(classifyResearchIntent("latest AI news"), "news");
  assert.equal(classifyResearchIntent("compare these laptops"), "comparison");
});

test("research v2 ranks official and topic-relevant sources higher", () => {
  const ranked = rankSources([
    { title: "Forum post", url: "https://reddit.com/r/weather/comments/1" },
    { title: "NWS Boston", url: "https://weather.gov/box/" },
    { title: "Local blog", url: "https://example-blog.com/boston" },
  ], "weather");
  assert.equal(ranked[0].url, "https://weather.gov/box/");
  assert.ok(ranked[0].quality > ranked.at(-1).quality);
});

test("research v2 searches multiple angles, reads sources, and reports limits without faking", async () => {
  const research = createResearchV2({
    getSettings: () => ({ geminiKey: "" }),
    now: () => new Date("2026-06-26T12:00:00Z"),
    webResearch: async ({ query }) => ({
      answer: query.includes("official")
        ? "Official source says the schedule is pending."
        : "Search snippet says Boston has weather and events tomorrow.",
      sources: query.includes("official")
        ? [{ title: "Official Boston", url: "https://www.boston.gov/events" }]
        : [{ title: "Weather", url: "https://weather.gov/box/" }],
    }),
    urlRead: async ({ url }) => ({
      title: url.includes("weather") ? "National Weather Service" : "Boston Events",
      finalUrl: url,
      text: url.includes("weather")
        ? "Boston forecast excerpt for tomorrow."
        : "Boston events excerpt for tomorrow.",
      textLength: 100,
    }),
  });

  const result = await research.run({
    query: "what is Boston tomorrow",
    intent: "local_briefing",
    mode: "balanced",
    maxSearches: 4,
    readTopSources: 2,
  });

  assert.equal(result.intent, "local_briefing");
  assert.ok(result.expandedQueries.length >= 4);
  assert.ok(result.progress.some((step) => step.phase === "search"));
  assert.ok(result.readSources.length >= 1);
  assert.ok(result.sources.length >= 1);
  assert.ok(result.evidence.confidence > 0.5);
  assert.ok(result.answer.includes("Search snippet") || result.answer.includes("Official source"));
});
