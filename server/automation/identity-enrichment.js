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
async function enrichCandidates({ browserService, taskId, candidates = [], inboxUrl, waitMs = 2200 } = {}) {
  if (!browserService || !inboxUrl) return [];
  const shortlist = candidates.filter((item) => item && (item.name || item.text)).slice(0, MAX_CANDIDATES);
  if (shortlist.length < 2) return [];

  const enriched = [];
  let ownerHandle = "";
  for (const candidate of shortlist) {
    const label = clean(candidate.name || candidate.text, 140);
    const entry = { ref: candidate.ref || "", label, detail: "", handle: "", profileUrl: "", avatarUrl: "", threadUrl: "" };
    try {
      await browserService.navigate({ url: inboxUrl, taskId });
      await browserService.wait({ taskId, milliseconds: waitMs });
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

module.exports = { MAX_CANDIDATES, RESERVED_PATHS, avatarForHandle, counterpartHandles, enrichCandidates, handleFromHref, ownerHandleFrom };
