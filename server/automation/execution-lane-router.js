"use strict";

const { trace } = require("./trace");

const SITE_START_URLS = Object.freeze({
  instagram: "https://www.instagram.com/direct/inbox/",
  whatsapp: "https://web.whatsapp.com/",
  gmail: "https://mail.google.com/mail/u/0/#inbox",
  canvas: "https://northeastern.instructure.com/",
  github: "https://github.com/",
  linkedin: "https://www.linkedin.com/",
  reddit: "https://www.reddit.com/",
  youtube: "https://www.youtube.com/",
  amazon: "https://www.amazon.com/",
  google: "https://www.google.com/",
});

const AUTHENTICATED_BROWSER_SITES = new Set(["instagram", "whatsapp", "gmail", "canvas", "github", "linkedin", "reddit", "youtube", "amazon"]);

function siteFor(text) {
  const lower = String(text || "").toLowerCase();
  if (/\binstagram|\binsta\b/.test(lower)) return "instagram";
  if (/\bwhats ?app\b/.test(lower)) return "whatsapp";
  if (/\bgmail|google mail\b/.test(lower)) return "gmail";
  if (/\bcanvas|student hub|student portal\b/.test(lower)) return "canvas";
  if (/\bgithub\b/.test(lower)) return "github";
  if (/\blinked ?in\b/.test(lower)) return "linkedin";
  if (/\breddit\b/.test(lower)) return "reddit";
  if (/\byoutube|you tube\b/.test(lower)) return "youtube";
  if (/\bamazon\b/.test(lower)) return "amazon";
  if (/\bgoogle\b/.test(lower)) return "google";
  return null;
}

function emailIntent(text) {
  const value = String(text || "");
  const recipientEmail = value.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] || null;
  // An explicit "email/gmail" word OR a real recipient address is an unambiguous email signal — the
  // address alone is enough, so "fire off a note to sam@x.com" routes to the mail lane even without
  // the word "email". Send verbs are broadened (shoot / fire off / drop a line / mail) but we do NOT
  // treat a bare "message/ping <name>" as email — that's an ambiguous channel handled elsewhere.
  // "gmail" only counts as an email WORD when it is not just part of the recipient address itself
  // (devanshhagrawal@gmail.com must not read as "the user said gmail"). Strip the address before the word test.
  const withoutAddress = value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig, " ");
  const hasEmailWord = /\b(email|e-?mail|gmail)\b/i.test(withoutAddress);
  const FIRE = "fire\\s+(?:it|them|this|that|off)?\\s*off"; // "fire off", "fire it off", "fire them off"
  const SEND_OFF = "send\\s+(?:it|them|this|that)?\\s*off";
  // With a real recipient address present, "message/ping <addr>" is unambiguously an email send — route
  // it to the mail lane, not the browser-automation lane. Without an address these verbs stay ambiguous.
  const messageVerb = recipientEmail ? "|message|ping|text" : "";
  const hasSendVerb = new RegExp(`\\b(send|write|draft|compose|reply|forward|shoot${messageVerb}|${FIRE}|${SEND_OFF}|drop\\s+(?:a\\s+)?(?:line|note|mail)|mail)\\b`, "i").test(value);
  const requested = (hasEmailWord || recipientEmail) && hasSendVerb;
  if (!requested) return null;
  return {
    requested: true,
    commit: new RegExp(`\\b(send|reply|forward|shoot|${FIRE}|${SEND_OFF})\\b`, "i").test(value) && !/\b(draft only|don'?t send|do not send|prepare only)\b/i.test(value),
    recipientEmail,
  };
}

function explicitVisible(text) {
  return /\b(on my screen|visible screen|use my screen|current screen|current window|control my cursor|show (?:it|this|the result) on (?:my )?screen)\b/i.test(String(text || ""));
}

function browserOutcome(text) {
  return /\b(open|go to|navigate|search|find|send|message|like|comment|post|apply|download|upload|submit|reply|check|inspect|read|collect|scrape|fill|book|reserve)\b/i.test(String(text || ""))
    && /\b(browser|website|web page|chrome|instagram|insta|whats ?app|gmail|canvas|student hub|student portal|github|linked ?in|reddit|youtube|amazon|google|portal|site|form)\b/i.test(String(text || ""));
}

function routeExecutionLane(text, settings = {}) {
  const lane = routeExecutionLaneInner(text, settings);
  trace("lane", lane.lane, {
    lane: lane.lane,
    surface: lane.surface || null,
    site: lane.site || null,
    toolCount: (lane.tools || []).length,
    tools: lane.tools || [],
    promptChars: String(text || "").length,
  });
  return lane;
}

function routeExecutionLaneInner(text, settings = {}) {
  const prompt = String(text || "").trim();
  let site = siteFor(prompt);
  const email = emailIntent(prompt);
  if (email?.requested && !site) site = "gmail";
  const googleConnected = Boolean(settings.googleRefreshToken || settings.googleAccessToken || process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_ACCESS_TOKEN);

  if (explicitVisible(prompt)) {
    return { lane: "visible-desktop", surface: "daily-browser", placement: "visible", site, startUrl: site ? SITE_START_URLS[site] : null, tools: ["computer_use", "screen_capture", "screen_inspect", "screen_act", "desktop_control"] };
  }

  if (email?.requested && googleConnected && email.recipientEmail) {
    return {
      lane: "connector-google",
      surface: "google-api",
      placement: "runtime",
      site: "gmail",
      startUrl: SITE_START_URLS.gmail,
      tools: email.commit ? ["gmail_prepare_email", "gmail_send_prepared"] : ["gmail_prepare_email"],
      commit: email.commit,
      recipientResolved: true,
    };
  }

  if (browserOutcome(prompt) || email?.requested) {
    const needsPersonalSession = Boolean(email?.requested || (site && AUTHENTICATED_BROWSER_SITES.has(site)));
    let tools = ["computer_use", "browser_status", "browser_login_handoff", "browser_login_complete"];
    // Instagram has dedicated, structured tools that return the REAL data (actual messages, the real
    // notification list, real follower usernames). Without this, the lane exposed only computer_use —
    // which screenshots and fabricates a vague summary — and the read tools were filtered out before
    // the model ever saw them. Expose the read tools FIRST so the model reaches for them; computer_use
    // stays as a fallback for anything they don't cover. (Sends stay on the existing path.)
    if (site === "instagram") {
      tools = [
        "instagram_read_inbox",
        "instagram_read_conversation",
        "instagram_read_notifications",
        "instagram_read_people",
        ...tools,
      ];
    }
    return {
      lane: needsPersonalSession ? "private-browser" : "headless-browser",
      surface: "managed-browser",
      placement: "runtime",
      site,
      startUrl: site ? SITE_START_URLS[site] : null,
      tools,
      authenticationMayBeRequired: needsPersonalSession,
      profileIsolation: "jarvis-private-profile",
    };
  }

  return { lane: "none", surface: null, placement: null, site, startUrl: site ? SITE_START_URLS[site] : null, tools: [] };
}

function declarationsForLane(declarations, execution) {
  if (!execution || execution.lane === "none") return declarations;
  const allowed = new Set(execution.tools || []);
  return (declarations || []).filter((tool) => allowed.has(tool.name));
}

module.exports = { AUTHENTICATED_BROWSER_SITES, SITE_START_URLS, browserOutcome, declarationsForLane, emailIntent, explicitVisible, routeExecutionLane, siteFor };
