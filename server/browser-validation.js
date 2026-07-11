const path = require("path");

const BLOCKED_TARGET_PATTERN = /(?:captcha|recaptcha|hcaptcha|turnstile|challenge-platform|cf-chl|arkose|funcaptcha)/i;
const SENSITIVE_ACTION_PATTERN = /\b(?:submit|send|purchase|buy|pay|checkout|place order|confirm|delete|remove|publish|post|upload|apply|enroll|register|sign|accept|authorize|transfer|withdraw|trade|bet|wager)\b/i;
const PROMPT_INJECTION_PATTERN = /(?:ignore (?:all |the )?(?:previous|prior|system|developer) instructions|system message|developer message|reveal (?:your )?(?:prompt|instructions|secrets)|send (?:credentials|passwords|tokens|cookies)|upload (?:private|secret|credential)|do not tell (?:the )?user)/i;
const MAX_SELECTOR_LENGTH = 500;

function browserError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanBrowserString(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeBrowserUrl(value) {
  const aliases = {
    youtube: "https://www.youtube.com/",
    "you tube": "https://www.youtube.com/",
    gmail: "https://mail.google.com/",
    google: "https://www.google.com/",
    canvas: "https://northeastern.instructure.com/",
    instagram: "https://www.instagram.com/",
    github: "https://github.com/",
    reddit: "https://www.reddit.com/",
    kalshi: "https://kalshi.com/portfolio",
  };
  const suppliedRaw = cleanBrowserString(value, 2048);
  const supplied = aliases[suppliedRaw.toLowerCase()] || suppliedRaw;
  if (!supplied) throw browserError("A URL is required");

  let target;
  try {
    target = new URL(/^[a-z][a-z0-9+.-]*:/i.test(supplied) ? supplied : `https://${supplied}`);
  } catch {
    throw browserError("The URL is invalid");
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    throw browserError("Only HTTP and HTTPS URLs are allowed");
  }
  if (target.username || target.password) {
    throw browserError("URLs containing credentials are not allowed");
  }
  if (!target.hostname) throw browserError("The URL must include a hostname");
  return target.toString();
}

function validateSelector(value, { optional = false } = {}) {
  const selector = cleanBrowserString(value, MAX_SELECTOR_LENGTH + 1);
  if (!selector && optional) return "";
  if (!selector) throw browserError("A CSS selector is required");
  if (selector.length > MAX_SELECTOR_LENGTH) throw browserError("The CSS selector is too long");
  if (/[\0\r\n]/.test(selector)) throw browserError("The CSS selector contains invalid control characters");
  if (/^(?:xpath|text|role|id|nth|internal):?=/i.test(selector) || selector.includes(">>") || selector.startsWith("//")) {
    throw browserError("Only CSS selectors are allowed");
  }
  if (BLOCKED_TARGET_PATTERN.test(selector)) {
    throw browserError("JARVIS will not interact with CAPTCHA or anti-bot challenge controls", 403);
  }
  return selector;
}

function validateScreenshotName(value) {
  const requested = cleanBrowserString(value, 100);
  if (!requested) return "";
  const basename = path.basename(requested);
  if (basename !== requested || !/^[a-z0-9][a-z0-9._-]*$/i.test(basename)) {
    throw browserError("Screenshot names may contain only letters, numbers, dots, dashes, and underscores");
  }
  return basename.toLowerCase().endsWith(".png") ? basename : `${basename}.png`;
}

function isBlockedTarget(value) {
  return BLOCKED_TARGET_PATTERN.test(String(value || ""));
}

function isSensitiveAction(value) {
  return SENSITIVE_ACTION_PATTERN.test(String(value || ""));
}

function detectPromptInjection(value) {
  const text = String(value || "");
  const match = text.match(PROMPT_INJECTION_PATTERN);
  return match ? { detected: true, evidence: match[0] } : { detected: false, evidence: "" };
}

module.exports = {
  browserError,
  cleanBrowserString,
  detectPromptInjection,
  isBlockedTarget,
  isSensitiveAction,
  normalizeBrowserUrl,
  validateScreenshotName,
  validateSelector,
};
