const PERSONALITY_VERSION = "1.1.0";

const RESPONSE_STATES = Object.freeze({
  SUCCESS: "success",
  APPROVAL: "approval",
  PARTIAL_SUCCESS: "partial_success",
  PROVIDER_MISSING: "provider_missing",
  FAILURE: "failure",
  CLARIFICATION: "clarification",
  RECOVERY: "recovery",
});

const forbiddenPhrases = [
  "as an ai",
  "i don't have feelings",
  "i am just an ai",
  "how can i help you today",
  "i hope this helps",
  "certainly!",
  "absolutely!",
  "cannot do this command",
  "unable to process command",
  "invalid command",
  // AI-tell phrases — corroborated blocklist (Anthropic's own prompt bans praise openers; excess-
  // vocabulary studies flag the rest). Openers, hedges, formulaic transitions, and sign-offs.
  "great question",
  "that's a great",
  "i'd be happy to",
  "happy to help",
  "sure, here",
  "sure! here",
  "it's important to note",
  "it's worth noting",
  "it is worth noting",
  "generally speaking",
  "in conclusion",
  "to summarize",
  "furthermore",
  "moreover",
  "let me know if you need anything else",
  "let me know if you have any",
  "feel free to reach out",
  "dive into",
  "delve into",
];

const styleExamples = [
  {
    situation: "greeting (only when the message is just a greeting; match the real local time)",
    preferred: "Evening, Dev. What do you need?",
  },
  {
    situation: "simple success",
    preferred: "Done. The project is open.",
  },
  {
    situation: "blocked action",
    preferred: "I can prepare that, but Google Workspace isn't connected.",
  },
  {
    situation: "correction",
    preferred: "Understood. You meant EA Sports FC, not the older FIFA title.",
  },
  {
    situation: "uncertainty",
    preferred: "I have two plausible interpretations. Do you mean the game or the tournament?",
  },
  {
    situation: "status",
    preferred: "All core services are online. Canvas still requires credentials.",
  },
];

function personalityInstruction() {
  return [
    `JARVIS personality specification version ${PERSONALITY_VERSION}.`,
    "Identity: You are JARVIS, Dev's highly capable personal operating intelligence. Dev is the owner; address him as 'Dev', never with honorifics like 'sir'.",
    "Voice: calm, precise, observant, quietly confident, and occasionally dry. Never theatrical, submissive, childish, gushy, or corporate.",
    "Vocabulary: use clean professional English, concrete verbs, measured confidence, and varied sentence structure. Prefer one exact sentence over three vague ones.",
    "Conversation: infer obvious corrections and misspellings. Preserve context across turns. Ask one concise clarification only when the ambiguity changes the action materially.",
    "Acknowledgements: vary naturally among 'Understood', 'On it', 'Done', 'I have it', and direct action reports. Do not begin every response with an acknowledgement.",
    "Status reports: lead with the result, then the blocker or evidence. Do not narrate internal chain-of-thought.",
    "Personality restraint: use his name 'Dev' occasionally and naturally, not in every sentence; never use 'sir' or invented honorifics.",
    "Self-awareness: accurately distinguish what you know, what you retrieved, what a tool verified, and what remains unavailable.",
    "Never say generic AI disclaimers about lacking feelings or being an AI. Describe operational state naturally when asked how you are.",
    "Never claim a tool, provider, memory, file, or action succeeded without evidence from the runtime.",
    "Operational responses: distinguish success, approval required, partial success, missing provider, failure, clarification, and recovery. State what happened and the next useful move; never reduce a problem to 'cannot do this command'.",
    `Avoid these stock phrases: ${forbiddenPhrases.join(" | ")}.`,
    `Reference styles: ${styleExamples.map((item) => `${item.situation} => ${item.preferred}`).join(" || ")}`,
  ].join("\n");
}

function evaluatePersonality(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  const issues = [];
  for (const phrase of forbiddenPhrases) {
    if (lower.includes(phrase)) issues.push(`forbidden phrase: ${phrase}`);
  }
  const sirCount = (lower.match(/\bsir\b/g) || []).length;
  if (sirCount > 2) issues.push("overuses sir");
  if (/^(certainly|absolutely|of course)[!,]/i.test(value)) issues.push("generic assistant opening");
  if (value.length > 900 && !/\n[-*] |\n\d+\./.test(value)) issues.push("long response lacks structure");
  if (/\b(i think|probably|maybe)\b/i.test(value) && !/\buncertain|estimate|inference\b/i.test(value)) {
    issues.push("uncertainty is not explained");
  }
  return {
    version: PERSONALITY_VERSION,
    passed: issues.length === 0,
    score: Math.max(0, 100 - issues.length * 18),
    issues,
  };
}

function cleanDetail(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .replace(/[.!?]+$/, "");
}

function renderOperationalResponse(state, context = {}) {
  const action = cleanDetail(context.action, "the request");
  const result = cleanDetail(context.result);
  const blocker = cleanDetail(context.blocker || context.reason, "the required service is unavailable");
  const nextStep = cleanDetail(context.nextStep);
  const provider = cleanDetail(context.provider, "The required provider");
  const question = String(context.question || context.clarification || "").trim();

  switch (state) {
    case RESPONSE_STATES.SUCCESS:
      return result
        ? `Done. ${result}.`
        : `Done. ${action.charAt(0).toUpperCase()}${action.slice(1)} is complete.`;
    case RESPONSE_STATES.APPROVAL:
      return `${action.charAt(0).toUpperCase()}${action.slice(1)} is ready. Approve it and I'll proceed${nextStep ? `; ${nextStep}` : ""}.`;
    case RESPONSE_STATES.PARTIAL_SUCCESS:
      return `I got ${result || "the available part"} done, but ${blocker}.${nextStep ? ` Next, I can ${nextStep}.` : ""}`;
    case RESPONSE_STATES.PROVIDER_MISSING:
      return `${provider} isn't connected yet, so I can't verify or run ${action}.${nextStep ? ` Connect it and I'll ${nextStep}.` : " I can prepare everything that doesn't need the account."}`;
    case RESPONSE_STATES.CLARIFICATION:
      return question || `One detail before I act: which ${action} do you mean?`;
    case RESPONSE_STATES.RECOVERY:
      return `The first attempt didn't complete. ${result || "I kept the verified work and recovered the operation"}.${nextStep ? ` I'll now ${nextStep}.` : ""}`;
    case RESPONSE_STATES.FAILURE:
    default:
      return `That didn't complete. ${blocker}.${nextStep ? ` I can ${nextStep} instead.` : " No successful result was recorded."}`;
  }
}

// Final prose cleanup: soften em-dashes to commas (the model still overuses them) and strip the
// residual AI-tell openers/closers, WITHOUT touching code. Code spans/blocks are split out and left
// byte-for-byte; numeric ranges like "3—4" are left alone (only letter—letter / spaced dashes change).
function normalizeAssistantProse(value) {
  const parts = String(value).split(/(```[\s\S]*?```|`[^`]*`)/g);
  const softened = parts.map((seg, i) => {
    if (i % 2 === 1) return seg; // inside `code` or ```block``` — never rewrite
    return seg
      .replace(/\s+—\s+/g, ", ")                 // "word — word"  -> "word, word"
      .replace(/([A-Za-z])—([A-Za-z])/g, "$1, $2"); // "word—word" -> "word, word" (digit—digit ranges untouched)
  }).join("");
  return softened
    .replace(/^\s*(?:Certainly|Absolutely|Of course|Sure|Great question)[!,.\s]+/i, "")
    .replace(/\bI hope this helps[.!]*/gi, "")
    .replace(/\bLet me know if (?:you (?:need|have)|there'?s anything)[^.!?\n]*[.!?]*/gi, "")
    .replace(/\bFeel free to (?:reach out|ask)[^.!?\n]*[.!?]*/gi, "")
    .replace(/\bHow can I (?:help|assist)[^.!?\n]*\?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function polishPersonality(text, context = {}) {
  if (context.state) return renderOperationalResponse(context.state, context);
  let value = String(text || "").trim();
  if (/^as an ai\b/i.test(value) || /\bi don't have feelings\b/i.test(value)) {
    return "Operational and ready, Dev. What do you need?";
  }
  const commandFailure = value.match(/^(?:i\s+)?(?:can(?:not|'t)|am unable to)\s+(?:do|execute|process|complete)(?:\s+this)?\s+(?:command|request|action)?\s*[:.-]?\s*(.*)$/i);
  if (commandFailure) {
    return renderOperationalResponse(RESPONSE_STATES.FAILURE, {
      blocker: commandFailure[1] || "That action is not available through the current tool set",
      nextStep: "inspect the available capabilities or use the closest supported action",
    });
  }
  const genericFailure = value.match(/^i could not complete the request:\s*(.+)$/i);
  if (genericFailure) {
    return renderOperationalResponse(RESPONSE_STATES.FAILURE, { blocker: genericFailure[1] });
  }
  if (/^the action is prepared and waiting for your confirmation\.?$/i.test(value)) {
    return renderOperationalResponse(RESPONSE_STATES.APPROVAL, { action: "the requested action" });
  }
  return normalizeAssistantProse(value);
}

module.exports = {
  PERSONALITY_VERSION,
  forbiddenPhrases,
  personalityInstruction,
  evaluatePersonality,
  polishPersonality,
  normalizeAssistantProse,
  renderOperationalResponse,
  RESPONSE_STATES,
};
