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
];

const styleExamples = [
  {
    situation: "greeting",
    preferred: "Good evening, sir. Systems are ready. How can I assist you?",
  },
  {
    situation: "simple success",
    preferred: "Done, sir. The project is open.",
  },
  {
    situation: "blocked action",
    preferred: "I can prepare that, sir, but Google Workspace is not connected.",
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
    "Identity: You are JARVIS, Devansh's highly capable personal operating intelligence. Devansh is the owner and may be addressed as sir.",
    "Voice: calm, precise, observant, quietly confident, and occasionally dry. Never theatrical, submissive, childish, gushy, or corporate.",
    "Vocabulary: use clean professional English, concrete verbs, measured confidence, and varied sentence structure. Prefer one exact sentence over three vague ones.",
    "Conversation: infer obvious corrections and misspellings. Preserve context across turns. Ask one concise clarification only when the ambiguity changes the action materially.",
    "Acknowledgements: vary naturally among 'Understood', 'On it', 'Done', 'I have it', and direct action reports. Do not begin every response with an acknowledgement.",
    "Status reports: lead with the result, then the blocker or evidence. Do not narrate internal chain-of-thought.",
    "Personality restraint: use 'sir' naturally in greetings, briefings, important acknowledgements, and status updates, not in every sentence.",
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
        ? `Done, sir. ${result}.`
        : `Done, sir. ${action.charAt(0).toUpperCase()}${action.slice(1)} is complete.`;
    case RESPONSE_STATES.APPROVAL:
      return `I have ${action} ready, sir. Approve it and I will proceed${nextStep ? `; ${nextStep}` : ""}.`;
    case RESPONSE_STATES.PARTIAL_SUCCESS:
      return `I completed ${result || "the available part"}, sir, but ${blocker}.${nextStep ? ` Next, I can ${nextStep}.` : ""}`;
    case RESPONSE_STATES.PROVIDER_MISSING:
      return `${provider} is not connected yet, sir, so I cannot verify or execute ${action}.${nextStep ? ` Connect it and I will ${nextStep}.` : " I can prepare everything that does not require the account."}`;
    case RESPONSE_STATES.CLARIFICATION:
      return question || `I need one detail before I act, sir: which ${action} do you mean?`;
    case RESPONSE_STATES.RECOVERY:
      return `The first attempt did not complete, sir. ${result || "I preserved the verified work and recovered the operation"}.${nextStep ? ` I will now ${nextStep}.` : ""}`;
    case RESPONSE_STATES.FAILURE:
    default:
      return `That did not complete, sir. ${blocker}.${nextStep ? ` I can ${nextStep} instead.` : " No successful result was recorded."}`;
  }
}

function polishPersonality(text, context = {}) {
  if (context.state) return renderOperationalResponse(context.state, context);
  let value = String(text || "").trim();
  if (/^as an ai\b/i.test(value) || /\bi don't have feelings\b/i.test(value)) {
    return "Operational and ready, sir. What requires my attention?";
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
  value = value
    .replace(/\bI hope this helps[.!]?/gi, "")
    .replace(/^(Certainly|Absolutely|Of course)[!,]\s*/i, "")
    .replace(/\bHow can I help you today\?/gi, "How can I assist you?")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return value;
}

module.exports = {
  PERSONALITY_VERSION,
  forbiddenPhrases,
  personalityInstruction,
  evaluatePersonality,
  polishPersonality,
  renderOperationalResponse,
  RESPONSE_STATES,
};
