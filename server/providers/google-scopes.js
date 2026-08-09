"use strict";

// Wave 4 — Google progressive scope system (pure, no I/O, no secrets).
// The old provider asked for one flat scope list up front (openid+email+gmail). That forces a
// Gmail-only owner to grant everything at once and can't grow to Calendar without re-consenting the
// whole set. This module models capability BUNDLES so we can request only what a given action needs,
// rely on Google incremental auth (include_granted_scopes) to keep prior grants, and report health
// PER SERVICE from whatever scopes are actually granted — so a revoked scope degrades only its own
// capability. It carries owner-facing explanations for every scope and is fully unit-testable.

// Identity is always requested; each capability bundle is additive.
const IDENTITY = ["openid", "email"];

const G = "https://www.googleapis.com/auth/";
const BUNDLES = {
  gmail_send:     { service: "gmail",    level: "send", scopes: [`${G}gmail.compose`, `${G}gmail.send`],
                    label: "Send & draft email", why: "Let Jarvis draft and send emails on your behalf (always with your approval)." },
  gmail_read:     { service: "gmail",    level: "read", scopes: [`${G}gmail.readonly`],
                    label: "Read email", why: "Read your inbox to surface replies you owe and follow-ups — never to send." },
  calendar_read:  { service: "calendar", level: "read", scopes: [`${G}calendar.readonly`],
                    label: "Read calendar", why: "Show your real events on Today's timeline. Read-only — nothing is changed." },
  calendar_write: { service: "calendar", level: "write", scopes: [`${G}calendar.events`],
                    label: "Manage calendar events", why: "Create, move and cancel events (each change is previewed for your approval first)." },
};

// Per-scope plain-English explanation for the owner-facing consent screen.
const SCOPE_EXPLANATIONS = {
  "openid": { title: "Sign-in identity", why: "Confirms which Google account you connected." },
  "email": { title: "Email address", why: "Reads the address of the connected account so Jarvis can label it." },
  [`${G}gmail.compose`]: { title: "Compose email", why: "Prepare drafts. Cannot read your inbox." },
  [`${G}gmail.send`]: { title: "Send email", why: "Send a message you've approved. Cannot read your inbox." },
  [`${G}gmail.readonly`]: { title: "Read email", why: "Read messages to find replies you owe. Cannot send or delete." },
  [`${G}calendar.readonly`]: { title: "Read calendar", why: "See your events. Cannot change anything." },
  [`${G}calendar.events`]: { title: "Manage events", why: "Create/edit/cancel events you approve." },
};

// Which services exist and how their health is derived from a granted-scope set.
const SERVICES = {
  gmail: { label: "Gmail", bundles: ["gmail_send", "gmail_read"] },
  calendar: { label: "Google Calendar", bundles: ["calendar_read", "calendar_write"] },
};

function uniq(list) { return [...new Set(list.filter(Boolean))]; }
function normalizeScopeString(scopes) { return uniq(String(scopes || "").split(/\s+/)); }

// The scopes to REQUEST for a set of bundle keys (identity is always included).
function scopesForBundles(bundleKeys = []) {
  const wanted = [];
  for (const key of bundleKeys) { const b = BUNDLES[key]; if (b) wanted.push(...b.scopes); }
  return uniq([...IDENTITY, ...wanted]);
}

function hasAll(granted, scopes) { const set = new Set(granted); return scopes.length > 0 && scopes.every((s) => set.has(s)); }

// Health per service, derived per-SCOPE (not per-bundle) so each capability degrades independently:
// having gmail.send alone means "can send" even if compose was never/ no longer granted.
function serviceHealth(grantedScopes) {
  const set = new Set(normalizeScopeString(grantedScopes));
  const has = (s) => set.has(`${G}${s}`);
  const canSend = has("gmail.send");
  const canDraft = has("gmail.compose");
  const canRead = has("gmail.readonly");
  const calRead = has("calendar.readonly") || has("calendar.events");   // events access implies read
  const calWrite = has("calendar.events");
  return {
    gmail: { label: SERVICES.gmail.label, connected: canSend || canDraft || canRead, canSend, canDraft, canRead },
    calendar: { label: SERVICES.calendar.label, connected: calRead || calWrite, canRead: calRead, canWrite: calWrite },
  };
}

// True if the granted set covers a named capability (used by capability guards before an API call).
function grants(grantedScopes, bundleKey) {
  const b = BUNDLES[bundleKey];
  if (!b) return false;
  return hasAll(normalizeScopeString(grantedScopes), b.scopes);
}

// Owner-facing explanation list for a set of scopes (for the consent card).
function explainScopes(scopes) {
  return normalizeScopeString(scopes).map((s) => ({ scope: s, ...(SCOPE_EXPLANATIONS[s] || { title: s, why: "" }) }));
}

// Migration: interpret a legacy/flat granted-scope string as the equivalent bundle set, so an owner
// who already connected Gmail keeps working with zero re-consent. Non-destructive — pure derivation.
function bundlesFromGranted(grantedScopes) {
  const granted = normalizeScopeString(grantedScopes);
  return Object.keys(BUNDLES).filter((key) => hasAll(granted, BUNDLES[key].scopes));
}

module.exports = {
  IDENTITY, BUNDLES, SERVICES, SCOPE_EXPLANATIONS,
  scopesForBundles, serviceHealth, grants, explainScopes, bundlesFromGranted, normalizeScopeString,
};
