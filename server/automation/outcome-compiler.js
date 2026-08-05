"use strict";

const crypto = require("crypto");

const SITE_ALIASES = Object.freeze({
  instagram: "https://www.instagram.com/",
  insta: "https://www.instagram.com/",
  github: "https://github.com/",
  gmail: "https://mail.google.com/",
  email: "https://mail.google.com/",
  whatsapp: "https://web.whatsapp.com/",
  linkedin: "https://www.linkedin.com/",
  canvas: "https://northeastern.instructure.com/",
  youtube: "https://www.youtube.com/",
});

const COMMIT_TYPES = [
  ["send", /\b(send|message|dm|reply|email)\b/i],
  ["publish", /\b(post|publish|comment|upload)\b/i],
  ["react", /\b(?:like|unlike|subscribe|follow\b(?!\s+(?:(?:the|its|their|this)\s+)?(?:evidence|trail|source|link|steps|path|instructions|workflow)))\b/i],
  ["submit", /\b(submit|apply|turn in)\b/i],
  ["create", /\b(create|make)\s+(?:a\s+)?(?:repository|repo|account|issue|pull request)\b/i],
  ["delete", /\b(delete|remove|unfollow|unsubscribe)\b/i],
  ["financial", /\b(buy|purchase|pay|checkout|transfer|trade|sell|book|reserve)\b/i],
];

function compact(value, max = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

// "message", "email", "reply", "post" and "like" are verbs and nouns, and the commit classifier
// only ever tested for the word. So "report the exact text of the most recent MESSAGE shown in it"
// — a request to read — compiled to commit.required with type "send".
//
// That was not theoretical. Run against the chat harness, that objective made the agent open a
// conversation, type "in it" into the composer, and stop at the approval gate asking to send it to
// a real name. The gate held, which is why this was caught rather than delivered, but a gate is the
// last line of defence and an owner who habitually approves would have sent nonsense to a contact.
//
// A determiner in front of one of these words makes it a noun phrase: "the message", "his reply",
// "each unread email". Masking those before classification leaves genuine verb uses ("message Tg",
// "reply to Yash", "send ...") matching exactly as before.
const DETERMINER = "(?:the|a|an|this|that|these|those|my|your|his|her|their|its|our|(?:most\\s+)?recent|latest|last|first|previous|next|new|old|unread|each|any|every|all|another|same|original)";
const COMMIT_NOUN = "(?:messages?|dms?|emails?|repl(?:y|ies)|posts?|comments?|likes?|follows?|reviews?)";
const NOUN_PHRASE = new RegExp(`\\b${DETERMINER}\\s+(?:\\w+\\s+){0,2}?${COMMIT_NOUN}\\b`, "gi");

// The placeholder must be unmatchable by the routing patterns, which capture `[A-Za-z][\w.-]*`.
// An earlier version substituted the word "item" and promptly had "item" resolved as a recipient
// in "type 'hi' into the message input field" — the mask created the very false positive it exists
// to remove. A non-word token cannot be captured by anything downstream.
const MASK = " ~ ";

function maskCommitNouns(text) {
  return String(text || "").replace(NOUN_PHRASE, MASK);
}

function clauses(text) {
  return String(text || "")
    .split(/\b(?:then|after that|afterwards|next|and then|finally)\b|[;\n]+/i)
    .map((item) => compact(item))
    .filter(Boolean);
}

function urls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((match) => match[0].replace(/[.,;!?]+$/, ""));
}

function siteFor(text, foundUrls) {
  if (foundUrls.length) {
    try { return { name: new URL(foundUrls[0]).hostname.replace(/^www\./, ""), url: foundUrls[0] }; } catch {}
  }
  const lower = String(text || "").toLowerCase();
  const alias = Object.keys(SITE_ALIASES).find((name) => new RegExp(`\\b${name}\\b`, "i").test(lower));
  return alias ? { name: alias === "insta" ? "instagram" : alias, url: SITE_ALIASES[alias] } : { name: "unknown", url: "" };
}

function quotedValues(text) {
  return [...String(text || "").matchAll(/["“”']([^"“”']{1,300})["“”']/g)].map((match) => compact(match[1], 300));
}

function requestedMessages(text) {
  const quoted = quotedValues(text);
  if (quoted.length) return quoted;
  const value = String(text || "");
  const people = probablePeople(value);
  const siteTail = /\s+on\s+(?:instagram|insta|whats ?app|gmail|email|linkedin|facebook|messenger|telegram|discord)(?:\s+(?:direct|messages?|chat|inbox))?\s*$/i;
  const cleanCandidate = (candidate, { stripRecipient = false } = {}) => {
    let output = compact(candidate, 300).replace(/^["'“”]+|["'“”]+$/g, "").trim();
    output = output.replace(siteTail, "").replace(/[,;:\s]+$/, "").trim();
    if (stripRecipient) {
      for (const person of people) {
        const escaped = person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output = output.replace(new RegExp(`\\s+to\\s+${escaped}\\s*$`, "i"), "").trim();
      }
    }
    return /^(?:a\s+message|message|a\s+dm|dm|(?:a\s+)?(?:feedback|review|follow-up)\s+(?:request|message))$/i.test(output) ? "" : output;
  };

  // Explicit payload markers have the highest precedence. This prevents
  // "send a message to TG saying hi" from treating "a message" as the text.
  const marked = value.match(/\b(?:saying|that says|with(?: the)? message)\s+(.{1,300}?)(?=\s+(?:then|and then|but|without|do not|don'?t)\b|[.;]|$)/i)?.[1];
  if (marked) {
    const message = cleanCandidate(marked, { stripRecipient: true });
    if (message) return [message];
  }

  const colon = value.match(/\b(?:message|dm|send)\b[^:]{0,160}:\s*(.{1,300})$/i)?.[1];
  if (colon) {
    const message = cleanCandidate(colon);
    if (message) return [message];
  }

  for (const person of people) {
    const escaped = person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const afterRecipient = value.match(new RegExp(`\\b(?:message|dm|send)\\s+${escaped}\\s+(?:a\\s+message\\s+)?(.{1,300}?)(?=\\s+(?:and\\s+)?then\\b|\\s+on\\s+(?:instagram|insta|whats ?app|gmail|email|linkedin|facebook|messenger|telegram|discord)\\b|[.;]|$)`, "i"))?.[1];
    if (afterRecipient) {
      const message = cleanCandidate(afterRecipient);
      if (message) return [message];
    }
    const beforeRecipient = value.match(new RegExp(`\\b(?:send|dm)\\s+(.{1,300}?)\\s+to\\s+${escaped}(?=\\s+(?:and\\s+)?then\\b|\\s+on\\s+(?:instagram|insta|whats ?app|gmail|email|linkedin|facebook|messenger|telegram|discord)\\b|[.;]|$)`, "i"))?.[1];
    if (beforeRecipient) {
      const message = cleanCandidate(beforeRecipient);
      if (message) return [message];
    }
  }
  return [];
}

function probablePeople(text) {
  const candidates = [];
  // Content inside quotes is payload, not routing metadata. Without this,
  // `send "say hi to dad" to AJ` incorrectly treats dad as a second recipient.
  // Masked for the same reason as the commit classifier: "the most recent message shown in it"
  // matched the `message\s+(\w+)` routing pattern and produced "shown" as a recipient.
  const routingText = maskCommitNouns(String(text || "").replace(/["“”']([^"“”']{1,300})["“”']/g, " "));
  const patterns = [
    /\b(?:to|email|send(?:\s+an?\s+email)?\s+to)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
    /\b(?:[Tt]o|[Aa]sk|[Tt]ell|[Cc]ontact|[Dd][Mm]|[Mm]essage|[Ss]end)\s+([A-Z][\w.-]+(?:\s+[A-Z][\w.-]+){0,3})\b/g,
    /\b(?:[Ss]earch(?:\s+for)?|[Ff]ind|[Ss]elect|[Cc]hoose|[Rr]ecipient|[Cc]onversation\s+with|[Cc]hat\s+with)\s+([A-Z][\w.-]+(?:\s+[A-Z][\w.-]+){0,3})\b/g,
    /\b(?:[Dd]irect\s+message\s+)?(?:[Tt]hread|[Cc]onversation|[Cc]hat)\s+(?:with|for)\s+([A-Z][\w.-]+(?:\s+[A-Z][\w.-]+){0,3})\b/g,
    /\b(?:to|ask|tell|contact|dm|message)\s+(@?[a-z][\w.-]{1,40})\b/gi,
    /\b(?:search(?:\s+for)?|find|select|choose|recipient|conversation\s+with|chat\s+with|thread\s+with)\s+(@?[a-z][\w.-]{1,40})\b/gi,
  ];
  const excluded = new Set([...Object.keys(SITE_ALIASES), "the", "this", "that", "their", "his", "her", "them", "him", "me", "myself", "us", "ourselves", "a", "an", "to", "saying", "message", "email", "file", "image", "input", "field", "box", "user", "chat", "conversation", "thread", "direct", "inbox", "recipient", "unsent", "sent", "send"]);
  for (const pattern of patterns) {
    for (const match of routingText.matchAll(pattern)) {
      const value = compact(match[1], 120).replace(/\b(?:saying|with|about|on|and|then)\b.*$/i, "").trim();
      const lower = value.toLowerCase();
      const siteSurface = /^(?:instagram|insta|gmail|email|whatsapp|linkedin|github|canvas|youtube)(?:\s+(?:direct|messages?|inbox|chat|site|page))?$/i.test(value);
      if (value && !excluded.has(lower) && !siteSurface) candidates.push(value);
    }
  }
  const unique = [...new Set(candidates.map((item) => item.toLowerCase()))].map((lower) => candidates.find((item) => item.toLowerCase() === lower));
  return unique.filter((item) => !unique.some((other) => other !== item && other.toLowerCase().startsWith(`${item.toLowerCase()} `)));
}

function fileReferences(text) {
  const values = [];
  for (const match of String(text || "").matchAll(/\b(?:latest|newest|current|preferred|this|the|my)?\s*([\w ._-]{1,80}\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|md|py|js|ts|tsx|zip|png|jpe?g|gif|webp|mp4))\b/gi)) {
    values.push(compact(match[0], 120));
  }
  for (const match of String(text || "").matchAll(/\b(?:latest|newest|current|preferred|this|the|my)\s+([\w -]{1,80})\s+(file|report|resume|résumé|image|photo|attachment|dataset|presentation)\b/gi)) {
    values.push(compact(match[0], 120));
  }
  return [...new Set(values)];
}

function commitFor(text) {
  const classifiable = maskCommitNouns(text);
  const intended = [...new Set(COMMIT_TYPES.filter(([, pattern]) => pattern.test(classifiable)).map(([type]) => type))];
  const explicitlyPrepareOnly = /\b(?:draft only|prepare only|do not send|don'?t send|do not click send|without (?:clicking )?(?:send|sending)|without submitting|leave (?:it|this|the message) unsent|stop before (?:send|sending)|do not transmit|without transmitting)\b/i.test(text);
  const matches = explicitlyPrepareOnly ? intended.filter((type) => !["send", "submit"].includes(type)) : intended;
  // `intended` is what the owner asked for before the prepare-only filter removes the terminal
  // step. A draft-only task still needs its message payload extracted, so downstream consumers key
  // off intent rather than off `types`, which by then no longer mentions sending.
  return { required: matches.length > 0, types: [...new Set(matches)], intendedTypes: intended, prepareOnly: explicitlyPrepareOnly, approval: matches.length ? "terminal-effect" : "none" };
}

function criterionFor(step) {
  const value = compact(step, 400);
  if (/\b(?:draft only|prepare only|do not send|don'?t send|do not click send|without (?:clicking )?(?:send|sending)|leave (?:it|this|the message) unsent|stop before (?:send|sending)|without submitting)\b/i.test(value)) {
    return { kind: "state", description: `${value}; verify the exact recipient and draft content are visible and the message remains unsent` };
  }
  if (/\b(send|message|reply|email)\b/i.test(value)) return { kind: "external_effect", description: `${value}; verify recipient and the sent content are visible` };
  if (/\b(?:download|fetch)\b/i.test(value) || /\bget\b.{0,100}\b(?:file|attachment|document|dataset|spreadsheet|presentation|archive|image)\b/i.test(value)) return { kind: "artifact", description: `${value}; verify a local file exists with non-zero bytes` };
  if (/\b(report|paper|presentation|file|website|script)\b/i.test(value) && /\b(make|create|write|generate|build|analyse|analyze)\b/i.test(value)) return { kind: "artifact", description: `${value}; verify the requested artifact exists and can be opened` };
  if (/\b(open|show|display)\b/i.test(value)) return { kind: "visible_handoff", description: `${value}; verify the requested final page is foregrounded` };
  if (/\b(like|follow|subscribe|apply|submit|create|post|publish)\b/i.test(value)) return { kind: "external_effect", description: `${value}; verify the changed state is visible` };
  return { kind: "state", description: `${value}; verify an observable state change or extracted evidence` };
}

function deliveryFor(text, explicit) {
  if (explicit) return explicit;
  if (/\b(?:on my screen|show me|open .* on (?:my )?screen|bring (?:it|this) up|foreground)\b/i.test(text)) return "visible";
  if (/\b(?:in the background|silently|don't interrupt|do not interrupt|minimi[sz]ed|runtime widget)\b/i.test(text)) return "runtime";
  return /\b(?:open|show)\b/i.test(text) && !/\b(?:open|show)\s+(?:the|a)?\s*(?:file|page|chat|repo|repository)\s+(?:and|then)\b/i.test(text) ? "visible" : "runtime";
}

function compileOutcome(objective, options = {}) {
  const source = compact(objective, 4_000);
  if (!source) throw new Error("An automation objective is required");
  const steps = clauses(source);
  const foundUrls = urls(source);
  const site = siteFor(source, foundUrls);
  const commit = commitFor(source);
  const successCriteria = steps.map(criterionFor);
  return {
    id: options.id || `outcome-${crypto.randomUUID()}`,
    objective: source,
    steps: steps.map((description, index) => ({ id: `step-${index + 1}`, description, status: "pending" })),
    site,
    urls: foundUrls,
    entities: {
      people: probablePeople(source),
      quotedValues: quotedValues(source),
      // A payload only exists if the owner asked for something to be written and sent. Extracting
      // one from a read request is how "report the most recent message shown in it" became a
      // prepared send of the text "in it": the fast path composes any single messageValue into the
      // first composer it finds and then looks for Send. No send intent, no payload.
      messageValues: commit.intendedTypes.includes("send") ? requestedMessages(source) : [],
      files: fileReferences(source),
    },
    constraints: {
      delivery: deliveryFor(source, options.delivery),
      background: deliveryFor(source, options.delivery) !== "visible",
      preserveFocus: true,
      ambiguityPolicy: "stop-before-consequence",
      credentialsPolicy: "never-type-passwords",
    },
    commit,
    successCriteria,
    completionContract: {
      requireObservableEvidence: true,
      requireRecipientVerification: commit.types.includes("send"),
      requireArtifactIntegrity: successCriteria.some((item) => item.kind === "artifact"),
      requireFinalFrame: true,
    },
    createdAt: new Date().toISOString(),
  };
}

module.exports = { COMMIT_TYPES, SITE_ALIASES, clauses, compileOutcome, deliveryFor, probablePeople, requestedMessages };
