"use strict";

// Instagram READ actions, driven by a Playwright page on the logged-in persistent profile.
//
// One rule runs through all of this: a click on an Instagram list row or nav icon must be a REAL
// coordinate mouse click (move to the element's on-screen centre, then press) — never Playwright's
// element .click(), .click({force}) or a JS .click(). Instagram lays a transparent overlay over its
// lists; that overlay IS its own click-routing layer. The element click sees the overlay on top and
// refuses (times out); force/JS clicks skip the coordinates so Instagram's handler never fires.
// A human clicks the pixel, lands on the overlay, and Instagram routes it. So do we. (Proven live
// 2026-08-08: opened a DM thread and the notifications panel first try after every other click failed.)
//
// Every action returns a plain object and NEVER throws — a read that cannot complete returns
// { ok: false, action, error, hint } so the assistant can say what happened instead of erroring out.

const { parseInbox, parseNotifications, classifyNotification } = require("./read-parsers");
const { harvestList } = require("./list-reader");
const { handleFromHref } = require("../automation/recipient-guard");

const INBOX_URL = "https://www.instagram.com/direct/inbox/";
const HOME_URL = "https://www.instagram.com/";
const RESERVED = ["explore", "reels", "reel", "direct", "p", "stories", "accounts", "about", "legal", "popular", "settings"];

const sleep = (page, ms) => page.waitForTimeout(ms);

// A real human click at an element's centre. `rect` is {x,y,w,h} in viewport pixels (from getBoundingClientRect).
async function humanClick(page, rect) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  await page.mouse.move(cx, cy, { steps: 8 });
  await sleep(page, 220);
  await page.mouse.click(cx, cy);
}

// Instagram throws interstitial dialogs after navigation — "Turn on Notifications", "Save your login
// info", "Add Instagram to your Home screen". Each lays a modal over the page whose OWN element sits
// under the nav icons and thread rows, so a coordinate click lands on the popup instead of the target
// (observed live: the click hit a "Turn on Notifications" div, not the notifications heart). Dismiss
// any of them via their "Not Now" button before interacting. Runs a couple of times because they can
// stack. Read-only and safe: "Not Now" declines every one of these prompts.
async function dismissInterstitials(page) {
  for (let i = 0; i < 2; i += 1) {
    let hit = false;
    try {
      const rect = await page.evaluate(() => {
        const cands = [...document.querySelectorAll('button,[role="button"]')];
        const el = cands.find((b) => /^\s*not now\s*$/i.test(b.innerText || ""));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (rect && rect.w > 0) {
        await humanClick(page, rect);
        await sleep(page, 700);
        hit = true;
      }
    } catch { /* best effort */ }
    if (!hit) break;
  }
}

// True when the page is sitting on a login wall rather than a signed-in surface.
async function isLoggedOut(page) {
  if (/\/accounts\/login/i.test(page.url())) return true;
  return page.evaluate(() => Boolean(document.querySelector('input[name="password"]')));
}

const loggedOut = (action) => ({
  ok: false,
  action,
  error: "Instagram is signed out in the automation browser.",
  hint: "Run scripts/ig-login-window.mjs once to sign in, then try again.",
});

// ---- inbox -----------------------------------------------------------------------------------

async function readInbox(page, args = {}) {
  const limit = Math.max(1, Math.min(60, Number(args.limit) || 30));
  await page.goto(INBOX_URL, { waitUntil: "domcontentloaded" });
  await sleep(page, 3800);
  if (await isLoggedOut(page)) return loggedOut("inbox");
  await dismissInterstitials(page);

  // Every thread row is a div[role=button] whose innerText is the whole row. Hand those to the
  // tested parser as {role,name} elements; it keeps only real conversation rows (time/Unread/Active).
  const elements = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('div[role="button"]')) {
      const name = (b.innerText || "").replace(/\s+/g, " ").trim();
      if (name) out.push({ role: "button", name });
    }
    return out;
  });
  const { threads } = parseInbox({ elements });
  const conversations = threads.slice(0, limit);
  return {
    ok: true,
    action: "inbox",
    count: conversations.length,
    unreadCount: conversations.filter((t) => t.unread).length,
    conversations,
  };
}

// ---- one conversation ------------------------------------------------------------------------

async function readConversation(page, args = {}) {
  const name = String(args.name || "").trim();
  const threadUrl = String(args.threadUrl || "").trim();
  const wantMessages = Math.max(5, Math.min(60, Number(args.messages) || 30));

  // Preferred path: a known thread URL — navigate straight to it, no row click, nothing to intercept.
  if (/instagram\.com\/direct\/t\/\d+/i.test(threadUrl)) {
    await page.goto(threadUrl, { waitUntil: "domcontentloaded" });
    await sleep(page, 4000);
    if (await isLoggedOut(page)) return loggedOut("conversation");
  } else {
    if (!name) {
      return { ok: false, action: "conversation", error: "Tell me whose conversation to open (a name or handle).", hint: "e.g. \"read my chat with aj\"" };
    }
    await page.goto(INBOX_URL, { waitUntil: "domcontentloaded" });
    await sleep(page, 3800);
    if (await isLoggedOut(page)) return loggedOut("conversation");
    await dismissInterstitials(page);

    const rect = await page.evaluate((needle) => {
      const rows = [...document.querySelectorAll('div[role="button"]')];
      const el = rows.find((d) => {
        const t = (d.innerText || "").trim();
        return t.toLowerCase().startsWith(needle) && /you:|·|active|unread|sent|new messages/i.test(t);
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 90) };
    }, name.toLowerCase());

    if (!rect) {
      return { ok: false, action: "conversation", error: `No open conversation starts with "${name}".`, hint: "Check the exact name in your inbox, or send them a message first." };
    }
    await humanClick(page, rect);
    await sleep(page, 4200);
  }

  if (!/\/direct\/t\/\d+/.test(page.url())) {
    return { ok: false, action: "conversation", error: "The conversation did not open.", hint: "The thread row may have moved; try again or give the exact name." };
  }

  // The thread partner's profile link sits in the conversation HEADER — top of the right pane, right
  // of the ~245px inbox sidebar. Picking the first profile link on the page would return our own nav
  // avatar instead, so anchor on the header's screen position.
  const participant = await page.evaluate(() => {
    const reserved = ["explore", "reels", "reel", "direct", "p", "stories", "accounts", "about"];
    for (const a of document.querySelectorAll('a[href^="/"]')) {
      const m = (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]+)\/$/);
      if (!m || reserved.includes(m[1])) continue;
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.top < 170 && r.left > 320) return m[1]; // header region, right pane
    }
    return null;
  });

  // Message bubbles carry their text in <div dir="auto">. Skip anything inside a role=button (that
  // is the left inbox list and controls, not the conversation). Order is DOM order = chat order.
  const raw = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div[dir="auto"]')) {
      if (el.closest('[role="button"]')) continue;
      const t = (el.innerText || "").trim();
      if (t && t.length < 500) out.push(t);
    }
    return out;
  });
  // Drop consecutive duplicates, keep the most recent tail.
  const deduped = raw.filter((t, i) => t !== raw[i - 1]);
  const messages = deduped.slice(-wantMessages);

  return {
    ok: true,
    action: "conversation",
    url: page.url(),
    participant,
    messageCount: messages.length,
    messages,
    note: "Messages are in order, most recent last. Sender attribution is not distinguished.",
  };
}

// ---- notifications ---------------------------------------------------------------------------

async function readNotifications(page) {
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  await sleep(page, 4200);
  if (await isLoggedOut(page)) return loggedOut("notifications");
  await dismissInterstitials(page);

  // Click the icon's nearest INTERACTIVE ancestor (a real link/button), not a fixed number of
  // parents up — the nav's DOM depth changes with viewport width, and a fixed climb lands on the
  // bare 24px icon wrapper at wide widths, so the coordinate click misses the clickable target.
  const findNotifRect = () => page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label="Notifications"]');
    if (!svg) return null;
    const el = svg.closest('a, [role="link"], [role="button"], button, [tabindex]') || svg.parentElement;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const anchorCount = () => page.evaluate(() => document.querySelectorAll('a[href^="/"]').length);

  let rect = await findNotifRect();
  if (!rect) return { ok: false, action: "notifications", error: "The Notifications button was not found on the page." };

  await humanClick(page, rect);
  await sleep(page, 4000);
  // If the panel did not open (the feed's link count barely changed), the icon may have re-rendered
  // after load — re-find and click once more before giving up.
  if ((await anchorCount()) < 30) {
    rect = await findNotifRect();
    if (rect) { await humanClick(page, rect); await sleep(page, 3500); }
  }

  // Each notification row = a profile link plus verb text. Climb to the SMALLEST ancestor whose text
  // names one verb and is short — that isolates a single row instead of the whole panel.
  const rows = await page.evaluate(() => {
    const VERB = /(started following you|requested to follow you|liked your|commented|replied|mentioned you|tagged you|reacted)/i;
    const out = [];
    for (const a of document.querySelectorAll('a[href^="/"]')) {
      const m = (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (!m) continue;
      let row = a.parentElement;
      let best = null;
      for (let i = 0; i < 6 && row; i += 1, row = row.parentElement) {
        const t = (row.innerText || "").replace(/\s+/g, " ").trim();
        if (VERB.test(t) && t.length <= 90) { best = t; break; }
      }
      if (best) out.push({ href: `/${m[1]}/`, text: best });
    }
    return out;
  });

  const seen = new Set();
  const events = [];
  for (const r of rows) {
    const username = handleFromHref(r.href);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    events.push({ username, text: r.text, type: classifyNotification(r.text) });
  }

  const followRequests = events.filter((e) => e.type === "follow_request").map((e) => e.username);
  const newFollowers = events.filter((e) => e.type === "follow").map((e) => e.username);
  const likes = events.filter((e) => e.type === "like");
  const comments = events.filter((e) => e.type === "comment");
  const mentions = events.filter((e) => e.type === "mention");

  return {
    ok: true,
    action: "notifications",
    total: events.length,
    followRequests: { count: followRequests.length, usernames: followRequests },
    newFollowers: { count: newFollowers.length, usernames: newFollowers },
    likes: { count: likes.length, items: likes },
    comments: { count: comments.length, items: comments },
    mentions: { count: mentions.length, items: mentions },
  };
}

// ---- followers / following -------------------------------------------------------------------

async function ownHandle(page) {
  return page.evaluate(() => {
    const fromHref = (a) => {
      const m = a && (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]+)\/$/);
      return m ? m[1] : null;
    };
    // 1) The Profile nav item links to /<own-handle>/.
    const svg = document.querySelector('svg[aria-label="Profile"]');
    let h = fromHref(svg && svg.closest('a[href^="/"]'));
    if (h) return h;
    // 2) The nav avatar image: alt is "<handle>'s profile picture".
    const img = document.querySelector('img[alt$="profile picture"]');
    if (img) {
      h = fromHref(img.closest('a[href^="/"]'));
      if (h) return h;
      const m = (img.getAttribute("alt") || "").match(/^([A-Za-z0-9._]+)'s profile picture$/);
      if (m) return m[1];
    }
    return null;
  });
}

async function readPeople(page, args = {}) {
  const which = args.which === "followers" ? "followers" : "following";
  const cap = Math.max(1, Math.min(2000, Number(args.cap) || 200));
  let handle = String(args.handle || "").replace(/^@/, "").trim();

  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  await sleep(page, 3200);
  if (await isLoggedOut(page)) return loggedOut(which);
  await dismissInterstitials(page);
  if (!handle) handle = await ownHandle(page);
  if (!handle) return { ok: false, action: which, error: "Could not determine whose list to read.", hint: "Say whose followers/following, e.g. \"who follows me\"." };

  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" });
  await sleep(page, 3200);

  // The count control ("<N> following") is a real link — a normal click works, no overlay in the way.
  const link = page.getByRole("link", { name: new RegExp(`^\\d[\\d,]*\\s+${which}$`, "i") }).first();
  try {
    await link.click({ timeout: 6000 });
  } catch {
    return { ok: false, action: which, error: `Could not open ${handle}'s ${which} list.`, hint: "The profile may be private or the count link was not visible." };
  }
  await sleep(page, 3200);

  const hasScroller = await page.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;
    for (const d of dialog.querySelectorAll("div")) {
      const s = getComputedStyle(d);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && d.scrollHeight > d.clientHeight + 10) {
        d.setAttribute("data-ig-scroller", "1");
        return true;
      }
    }
    return false;
  });
  if (!hasScroller) return { ok: false, action: which, error: `The ${which} list did not open.`, hint: "The account may be private, or the list is empty." };

  const driver = {
    rows: () => page.evaluate((reserved) => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return [];
      const out = [];
      for (const a of dialog.querySelectorAll('a[href^="/"]')) {
        const m = (a.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (m && !reserved.includes(m[1])) out.push({ key: m[1], username: m[1] });
      }
      return out;
    }, RESERVED),
    scrollHeight: () => page.evaluate(() => document.querySelector("[data-ig-scroller]")?.scrollHeight || 0),
    scrollStep: () => page.evaluate(() => { const el = document.querySelector("[data-ig-scroller]"); if (el) el.scrollTop = el.scrollHeight; }),
    settle: () => sleep(page, 1500 + Math.floor((cap % 7) * 130)), // small, fixed-ish human pause between batches
  };

  const result = await harvestList(driver, { maxItems: cap, stallLimit: 3, maxScrolls: 200 });
  return {
    ok: true,
    action: which,
    handle,
    count: result.count,
    complete: result.complete,          // true only if the whole list ended; false if we hit the cap
    cappedAt: result.cappedOut ? cap : null,
    usernames: result.items.map((p) => p.username),
  };
}

// ---- dispatcher --------------------------------------------------------------------------------

async function runInstagramRead(page, args = {}) {
  const action = String(args.action || "").toLowerCase();
  try {
    // Real coordinate mouse clicks (notifications, opening a thread by name) only register on the
    // FOREGROUND tab — a background tab in headless Chromium silently drops the input, so the panel
    // never opens. The shared browser runs IG reads on their own tab, which may be backgrounded
    // behind another page, so make it the front tab before doing anything.
    await page.bringToFront().catch(() => {});
    switch (action) {
      case "inbox": return await readInbox(page, args);
      case "conversation": return await readConversation(page, args);
      case "notifications": return await readNotifications(page);
      case "followers": return await readPeople(page, { ...args, which: "followers" });
      case "following": return await readPeople(page, { ...args, which: "following" });
      default:
        return { ok: false, action: action || "unknown", error: `Unknown Instagram read action "${action}".`, hint: "Use inbox, conversation, notifications, followers, or following." };
    }
  } catch (err) {
    // Never throw out of a read — turn any failure into a message the assistant can relay.
    return { ok: false, action: action || "unknown", error: String(err?.message || err).slice(0, 300), hint: "The page may have changed or been slow; try once more." };
  }
}

module.exports = { runInstagramRead, humanClick, readInbox, readConversation, readNotifications, readPeople };
