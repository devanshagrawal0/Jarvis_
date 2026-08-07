"use strict";

// Turning "which of these two people called Tg" into a question the owner can actually answer.
//
// An inbox row gives one thing: a display name. When two rows carry the same one, handing both back
// as a choice is no better than refusing — the owner is asked to pick between "Tg" and "Tg". The
// thing that separates them is the account behind each: the handle, the picture, the conversation.
// None of that is on the inbox row; all of it is one click away, inside the thread.
//
// So each candidate is opened and read. It costs a page load per candidate and only runs when a run
// has already stopped on a genuine ambiguity, which is rare and is otherwise a dead end.
//
// Everything here observes. It clicks conversation rows and reads pages; it never types, submits,
// or sends.

const RESERVED_PATHS = new Set([
  "direct", "explore", "reels", "accounts", "p", "stories", "settings", "inbox",
  "your_activity", "about", "legal", "privacy", "api", "developer", "emails",
]);

const MAX_CANDIDATES = 4;

function clean(value, max = 200) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

// The account name inside a profile URL: instagram.com/<handle>/ → handle.
function handleFromHref(href, origin = "instagram.com") {
  const raw = String(href || "");
  if (!raw) return "";
  const stripped = raw.replace(new RegExp(`^https?://(www\\.)?${origin.replace(/\./g, "\\.")}`, "i"), "");
  const segment = stripped.split(/[?#]/)[0].split("/").filter(Boolean)[0] || "";
  if (!segment || RESERVED_PATHS.has(segment.toLowerCase())) return "";
  return /^[A-Za-z0-9._]{1,40}$/.test(segment) ? segment : "";
}

// The other party in a conversation — never the owner.
//
// An earlier version took the first profile-shaped link on the page, which is the owner's own
// account in the nav chrome. It reported the same handle for every thread, so two different people
// looked identical and the enrichment was worse than useless: it looked authoritative and was not.
function counterpartHandles(elements = [], ownerHandle = "") {
  const owner = String(ownerHandle || "").trim().toLowerCase();
  const seen = new Set();
  const handles = [];
  for (const element of elements) {
    const handle = handleFromHref(element?.href);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (key === owner || seen.has(key)) continue;
    seen.add(key);
    handles.push(handle);
  }
  return handles;
}

// The avatar belonging to a specific account: the image inside the link to that account's profile.
// Picking "the first image on the page" returned the same picture for every thread, which is how a
// picker ends up showing two identical faces for two different people.
function avatarForHandle(elements = [], handle = "") {
  const wanted = String(handle || "").trim().toLowerCase();
  if (!wanted) return "";
  const match = elements.find((element) => handleFromHref(element?.href).toLowerCase() === wanted && element?.imageUrl);
  return clean(match?.imageUrl || "", 1000);
}

// Search results already carry the handle: a row reads "Tg sam_main" where an inbox row reads
// "Tg Active 5h ago". Reading it off the label costs nothing and works for the case where opening
// the row would not help — search rows do not exist on the inbox, so re-finding them there finds
// nothing and every field comes back empty.
const NOT_A_HANDLE = new Set([
  "active", "ago", "unread", "now", "online", "verified", "follow", "following", "message",
  "suggested", "new", "sent", "you", "and", "others", "more", "min", "mins", "hour", "hours",
]);

function handleFromLabel(label = "") {
  const tokens = String(label || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return "";
  // Walk from the end: the handle sits after the display name.
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const token = tokens[index].replace(/^@/, "").replace(/[.,·]+$/, "");
    if (!token || NOT_A_HANDLE.has(token.toLowerCase())) continue;
    // "5h", "13h", "1y", "2" — a timestamp or a count. These satisfy every shape test for a handle
    // (they contain a digit, they are lowercase) and "Tg Active 5h ago" duly reported "5h" as the
    // account. A row's age is not a person.
    if (/^\d+\s*[a-z]?$/i.test(token)) continue;
    // A handle carries the punctuation or digits a display name does not. Accepting a bare word
    // read "one" out of "Tg one" — and a wrong handle is worse than none, because it is what gets
    // saved as the contact and used to address them forever after.
    if (/^[a-z0-9][a-z0-9._]{1,29}$/.test(token) && /[._0-9]/.test(token)) return token;
    return "";
  }
  return "";
}

// The query has to match the PERSON, not something they once said. Instagram's search returns
// message bodies too — "Casey i will tg not to · 1y" ranked as highly as the actual account
// because the word appears in a year-old message. Those are not candidates for who someone is.
function namesTheQuery(label = "", query = "") {
  const normalisedLabel = String(label || "").trim().toLowerCase();
  const normalisedQuery = String(query || "").trim().toLowerCase();
  if (!normalisedLabel || !normalisedQuery) return false;
  if (normalisedLabel.startsWith(normalisedQuery)) return true;
  // Requiring the label to START with the query threw away most of the real matches. Measured live:
  // the resolver found FOUR accounts, three tied at the top score, and the owner was shown exactly
  // ONE — because only one label happened to begin with the typed name. "Vasquez, LR", "L.R.
  // Vasquez", or a display name leading with something else all failed even when they were the
  // person meant, and being shown a single stranger to confirm is worse than being shown four.
  //
  // Any WORD in the label may start the query instead. Still anchored at word starts, so a row that
  // merely contains the letters somewhere does not qualify ("majid" is not "lr"), and every word of
  // a multi-word query must be accounted for, so "lr vasquez" cannot match an unrelated "lr".
  //
  // Split on WHITESPACE and strip punctuation inside each word, rather than splitting on
  // punctuation: "L.R. Vasquez" is one person whose first name is written as two initials, and
  // splitting on the dots turns it into "l" and "r" and loses them. This way it reads as
  // ["lr", "vasquez"], while a handle like "lr.vasquez88" reads as one word — both still anchored
  // at the start of a word.
  const asWords = (value) => value.split(/\s+/).map((word) => word.replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean);
  const words = asWords(normalisedLabel);
  const queryWords = asWords(normalisedQuery);
  if (!queryWords.length) return false;
  // Only a SHORT label may match on a later word. A display name is a few words — "Vasquez, LR",
  // "L.R. Vasquez" — while a search row that merely quotes the name in an old message is prose:
  // "Casey i will tg not to · 1y" contains "tg" as a word too, and offering that as a candidate for
  // who someone IS was the original reason this rule demanded a prefix. Both requirements are real,
  // and length is what separates them.
  const NAME_LIKE_WORDS = 4;
  if (words.length > NAME_LIKE_WORDS) return false;
  return queryWords.every((part) => words.some((word) => word.startsWith(part)));
}

function ownerHandleFrom(elements = []) {
  // The owner's own account appears as a plain handle-shaped control in the inbox chrome.
  const entry = elements.find((element) => /^button$/i.test(String(element?.role || ""))
    && /^[a-z0-9._]{2,40}$/i.test(String(element?.name || "").trim()));
  return clean(entry?.name || "", 60);
}

// Opens each same-named candidate and reports who it actually is.
//
// `candidates` are inbox rows as the resolver ranked them. Refs belong to the snapshot they came
// from, so each candidate is re-found by its label on a fresh observation rather than by a ref that
// may have gone stale while another candidate was being inspected.
async function enrichCandidates({ browserService, taskId, candidates = [], inboxUrl, query = "", waitMs = 2200 } = {}) {
  if (!browserService || !inboxUrl) return [];
  const usable = candidates.filter((item) => item && (item.name || item.text));
  // Rows whose NAME is the queried person come first; a row that merely quotes the word in an old
  // message is not a candidate for who that person is. If none name the query — the query may be a
  // nickname the page never shows — fall back to what was ranked rather than offering nothing.
  const named = query ? usable.filter((item) => namesTheQuery(clean(item.name || item.text, 140), query)) : [];
  const shortlist = (named.length ? named : usable).slice(0, MAX_CANDIDATES);
  // One match is not nothing to ask — it is "is this them?", which is the question that turns a
  // found account into a saved contact. Requiring two threw away the useful case: filtering the
  // junk out of a search left exactly one real person, the run had nothing to offer, and it died
  // with a bare error instead of the answer it was holding.
  if (!shortlist.length) return [];

  const enriched = [];
  let ownerHandle = "";
  for (const candidate of shortlist) {
    const label = clean(candidate.name || candidate.text, 140);
    const entry = { ref: candidate.ref || "", label, detail: "", handle: "", profileUrl: "", avatarUrl: "", threadUrl: "" };
    // Free, and the only thing that works for search rows: the handle is already printed on them.
    const labelHandle = handleFromLabel(label);
    if (labelHandle) {
      entry.handle = labelHandle;
      entry.profileUrl = `https://www.instagram.com/${labelHandle}/`;
    }
    try {
      // Going back to the inbox costs a navigate, a fixed 2.2s wait and a full 240-element snapshot
      // — about seven seconds — and it was paid once PER CANDIDATE. With four people to show, that
      // is most of the 99 seconds an identity question took to appear. It is only actually needed
      // when the previous candidate navigated away into a thread; when we are already looking at the
      // inbox the whole trip is dead time.
      // `.catch()` cannot save a method that does not exist — calling it throws synchronously, which
      // took the whole candidate down the failure path and returned it with no handle at all. Not
      // every caller supplies a full browser service, so the capability is checked, not assumed.
      const current = typeof browserService.status === "function"
        ? await browserService.status({ taskId }).catch(() => null)
        : null;
      const alreadyOnInbox = Boolean(current) && String(current?.activePage?.url || "").startsWith(inboxUrl);
      if (!alreadyOnInbox) {
        await browserService.navigate({ url: inboxUrl, taskId });
        await browserService.wait({ taskId, milliseconds: waitMs });
      }
      const inbox = await browserService.snapshot({ taskId, limit: 240 });
      if (!ownerHandle) ownerHandle = ownerHandleFrom(inbox.elements || []);

      const row = (inbox.elements || []).find((item) => clean(item.name || item.text, 140) === label);
      if (!row) { enriched.push(entry); continue; }

      await browserService.click({ taskId, ref: row.ref });
      await browserService.wait({ taskId, milliseconds: waitMs });
      const thread = await browserService.snapshot({ taskId, limit: 240 });

      entry.threadUrl = clean(thread.url, 500);
      const [handle] = counterpartHandles(thread.elements || [], ownerHandle);
      if (handle) {
        entry.handle = handle;
        entry.profileUrl = `https://www.instagram.com/${handle}/`;
        entry.avatarUrl = avatarForHandle(thread.elements || [], handle);
      }
      // What the row itself said — "Active 5h ago", "2 new messages" — still helps once the handle
      // has done the real work of telling two accounts apart.
      const trailing = label.replace(new RegExp(`^${clean(candidate.matchedName || "", 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "").trim();
      entry.detail = clean(trailing || label, 120);
    } catch {
      // A candidate that cannot be opened is still offered, just without the extra detail. Losing
      // one row's handle is not a reason to abandon the question.
    }
    enriched.push(entry);
  }
  return enriched;
}

module.exports = { MAX_CANDIDATES, RESERVED_PATHS, avatarForHandle, counterpartHandles, enrichCandidates, handleFromHref, handleFromLabel, namesTheQuery, ownerHandleFrom };
