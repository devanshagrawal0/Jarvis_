"use strict";

const TOPICS = Object.freeze([
  { id: "fitness", pattern: /\b(gym|workout|training|exercise|fitness|strength|muscle|cardio|body ?fat|fat loss|weight ?loss|bulk|cut|reps?|sets?)\b/i, expansion: "weight height age fitness goal injury pain equipment schedule workout duration recovery sleep diet protein" },
  { id: "health", pattern: /\b(health|medical|doctor|medicine|medication|allerg(?:y|ies|ic)|injur(?:y|ies)|pain|sleep|weight|height|blood|heart)\b/i, expansion: "health profile measurements allergies injuries medication sleep recovery" },
  { id: "food", pattern: /\b(food|meal|diet|eat|restaurant|cook|calorie|protein|vegetarian|vegan|allerg(?:y|ies|ic))\b/i, expansion: "diet food preferences allergies calories protein routine" },
  { id: "travel", pattern: /\b(travel|trip|flight|hotel|vacation|holiday|airport|visa|passport|itinerary)\b/i, expansion: "home location travel preferences trips schedule documents" },
  { id: "work", pattern: /\b(work|job|career|project|meeting|deadline|client|business|office|study|school|college)\b/i, expansion: "projects goals commitments schedule work preferences current tasks" },
  { id: "communication", pattern: /\b(answer|respond|write|format|tone|concise|detailed|explain|presentation|report|email)\b/i, expansion: "answer style tone formatting verbosity communication preferences" },
  { id: "finance", pattern: /\b(finance|money|budget|bank|invest|portfolio|trade|kalshi|market|stock|crypto)\b/i, expansion: "financial preferences risk portfolio markets strategies budget" },
  { id: "technology", pattern: /\b(code|coding|software|computer|laptop|desktop|browser|website|app|api|model|jarvis|automation)\b/i, expansion: "devices software projects tools code preferences automations" },
  { id: "relationships", pattern: /\b(friend|family|mother|father|parent|brother|sister|partner|wife|husband|relationship|contact)\b/i, expansion: "people relationships contacts important dates preferences" },
  { id: "home", pattern: /\b(home|house|room|address|city|location|timezone|where i live)\b/i, expansion: "home location city timezone devices routines" },
]);

const SENSITIVE = /\b(weight|height|age|birth|health|medical|medicine|allerg|injur|pain|email|phone|address|location|identity|legal|finance|bank|income|password|secret)\b/i;

function normalizeText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function topicsForText(value) {
  const text = normalizeText(value);
  return TOPICS.filter((topic) => topic.pattern.test(text)).map((topic) => topic.id);
}

function expandQuery(value) {
  const text = normalizeText(value);
  const topics = topicsForText(text);
  const expansions = TOPICS.filter((topic) => topics.includes(topic.id)).map((topic) => topic.expansion);
  return { text: [text, ...expansions].filter(Boolean).join(" "), topics };
}

function sensitivityFor(value, fallback = "private") {
  return SENSITIVE.test(normalizeText(value)) ? "restricted" : String(fallback || "private");
}

function slug(value, fallback = "fact") {
  const normalized = normalizeText(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 96);
  return normalized && /^[a-z]/.test(normalized) ? normalized : fallback;
}

function predicateTopics(predicate, value) {
  return [...new Set([...topicsForText(predicate), ...topicsForText(typeof value === "string" ? value : JSON.stringify(value))])];
}

module.exports = { TOPICS, expandQuery, normalizeText, predicateTopics, sensitivityFor, slug, topicsForText };
