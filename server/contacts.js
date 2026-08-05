"use strict";

// Who the owner means when they say a name.
//
// Until now the automation had exactly two answers to "send hi to tg": guess, or refuse. It refused,
// correctly and uselessly — searching Instagram for "tg" returns a group thread containing Tg, and a
// single-recipient send must never resolve to a group. So the owner got "I cannot locate TG's
// account, please specify the exact handle" for a person they message constantly.
//
// Refusing is the wrong shape of answer. The identity is not unknowable, it is unasked. This stores
// the answer once: the owner points at the right person a single time, and every later "tg" is a
// direct navigation to a known thread — no search, no ranking, no ambiguity, and none of the failure
// classes that come with them.
//
// Lives in runtime/ (gitignored) because it is a list of the owner's real contacts. It never goes
// near the repository, the route memory, or the traces.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Every way the owner can reach a person, described once.
//
// This is the single source of truth for the whole feature: the store validates against it, the API
// serves it, and the UI builds its editor from it. A channel added here appears in the form without
// anyone touching the frontend — and, more importantly, the UI can never offer a channel the store
// would silently drop, which is the drift that makes an address book quietly lie.
//
// `kind` decides what the value IS, and therefore how it is validated and displayed:
//   handle  — an account name (@someone)
//   address — an email address
//   phone   — a dialable number
const CHANNEL_META = {
  instagram: { label: "Instagram", kind: "handle",  icon: "◉", color: "#E1306C", placeholder: "handle", url: (v) => `https://www.instagram.com/${v}/` },
  whatsapp:  { label: "WhatsApp",  kind: "phone",   icon: "◍", color: "#25D366", placeholder: "+1 555 000 1111", url: (v) => `https://wa.me/${v.replace(/[^0-9]/g, "")}` },
  telegram:  { label: "Telegram",  kind: "handle",  icon: "◈", color: "#26A5E4", placeholder: "handle", url: (v) => `https://t.me/${v}` },
  signal:    { label: "Signal",    kind: "phone",   icon: "◇", color: "#3A76F0", placeholder: "+1 555 000 1111", url: () => "" },
  sms:       { label: "SMS",       kind: "phone",   icon: "▢", color: "#6EE7B7", placeholder: "+1 555 000 1111", url: (v) => `sms:${v.replace(/[^0-9+]/g, "")}` },
  imessage:  { label: "iMessage",  kind: "phone",   icon: "▣", color: "#34C759", placeholder: "+1 555 000 1111", url: (v) => `sms:${v.replace(/[^0-9+]/g, "")}` },
  phone:     { label: "Phone",     kind: "phone",   icon: "☎", color: "#A5B4FC", placeholder: "+1 555 000 1111", url: (v) => `tel:${v.replace(/[^0-9+]/g, "")}` },
  email:     { label: "Email",     kind: "address", icon: "✉", color: "#FBBF24", placeholder: "name@example.com", url: (v) => `mailto:${v}` },
  x:         { label: "X",         kind: "handle",  icon: "✕", color: "#E7E9EA", placeholder: "handle", url: (v) => `https://x.com/${v}` },
  discord:   { label: "Discord",   kind: "handle",  icon: "◐", color: "#5865F2", placeholder: "username", url: () => "" },
  snapchat:  { label: "Snapchat",  kind: "handle",  icon: "◑", color: "#FFFC00", placeholder: "username", url: (v) => `https://snapchat.com/add/${v}` },
  facebook:  { label: "Facebook",  kind: "handle",  icon: "◒", color: "#0866FF", placeholder: "username", url: (v) => `https://facebook.com/${v}` },
  linkedin:  { label: "LinkedIn",  kind: "handle",  icon: "◓", color: "#0A66C2", placeholder: "profile-id", url: (v) => `https://www.linkedin.com/in/${v}/` },
  slack:     { label: "Slack",     kind: "handle",  icon: "⬡", color: "#E01E5A", placeholder: "member id", url: () => "" },
  github:    { label: "GitHub",    kind: "handle",  icon: "❖", color: "#C9D1D9", placeholder: "username", url: (v) => `https://github.com/${v}` },
};

const CHANNELS = Object.keys(CHANNEL_META);

// Serialisable form of the above — functions cannot cross the API boundary.
function channelCatalogue() {
  return CHANNELS.map((key) => ({
    key,
    label: CHANNEL_META[key].label,
    kind: CHANNEL_META[key].kind,
    icon: CHANNEL_META[key].icon,
    color: CHANNEL_META[key].color,
    placeholder: CHANNEL_META[key].placeholder,
  }));
}

function clean(value, max = 200) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

// A value that does not fit its channel is a mistake worth surfacing, not storing.
//
// An address book whose entries are wrong is worse than one that is empty: the wrong value is what
// gets used to contact someone. So an email without an "@" and a phone number with no digits are
// refused with a reason, rather than saved and discovered later by a failed send.
function validateChannelValue(key, value) {
  const meta = CHANNEL_META[key];
  if (!meta) return `${key} is not a channel Jarvis knows`;
  if (meta.kind === "address") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return `"${value}" is not an email address`;
    return "";
  }
  if (meta.kind === "phone") {
    const digits = value.replace(/[^0-9]/g, "");
    if (digits.length < 7) return `"${value}" is too short to be a phone number`;
    if (digits.length > 15) return `"${value}" is too long to be a phone number`;
    return "";
  }
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(value)) return `"${value}" is not a valid ${meta.label} handle`;
  return "";
}

// The one field a channel actually carries, whatever it is called internally.
function channelValueOf(account = {}) {
  return account.handle || account.address || "";
}

function linkForChannel(key, account = {}) {
  const meta = CHANNEL_META[key];
  const value = channelValueOf(account);
  if (!meta || !value) return account.profileUrl || "";
  // A stored URL is a fact; a generated one is a guess from a template. Prefer the fact.
  return account.threadUrl || account.profileUrl || meta.url(value) || "";
}

// Same normalisation the entity resolver uses, so "Tg", "tg" and " TG " are one person.
function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function channelKey(value) {
  const key = normalize(value).replace(/\s+/g, "");
  return CHANNELS.includes(key) ? key : "";
}

// Everything a contact can be called: their name, any alias the owner has used, and each handle.
function identitiesOf(contact = {}) {
  const values = [contact.name, ...(contact.aliases || [])];
  for (const channel of Object.values(contact.channels || {})) {
    if (channel?.handle) values.push(String(channel.handle).replace(/^@/, ""));
    if (channel?.address) values.push(channel.address);
  }
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function createContactStore({ runtimeDir } = {}) {
  if (!runtimeDir) throw new Error("runtimeDir is required");
  const filePath = path.join(runtimeDir, "contacts.json");

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(parsed.contacts) ? parsed.contacts : [];
    } catch {
      return [];
    }
  }

  // Write to a sibling, then rename over the target — so a crash mid-write cannot leave a truncated
  // address book behind.
  //
  // The rename is the part that breaks on Windows. This repository lives inside OneDrive, and the
  // sync client holds a transient handle on the file it is uploading; `rename` onto a handle it
  // owns fails EPERM. It is intermittent by nature, which is why it survived the unit tests (a temp
  // directory, one write) and only appeared saving a second contact in a row against the real
  // runtime folder — the first save succeeded, the next answered 400.
  //
  // Retrying is the whole fix: the lock is released in milliseconds. What must NOT happen is
  // falling back to a plain overwrite of the target, which trades a failed save for a corrupted one.
  function renameOntoTarget(temporary) {
    const transient = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
    let lastError = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        fs.renameSync(temporary, filePath);
        return;
      } catch (error) {
        lastError = error;
        if (!transient.has(error.code)) break;
        // Busy-wait: this store is small, synchronous, and called once per edit. A few milliseconds
        // of blocking beats an async rewrite of every caller.
        const until = Date.now() + 25;
        while (Date.now() < until) { /* let the sync client release the handle */ }
      }
    }
    try { fs.unlinkSync(temporary); } catch { /* the temp file is already gone or unreachable */ }
    throw lastError;
  }

  function persist(contacts) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    // Unique per write, not just per process: two saves in the same process previously reused one
    // temp name, so a retry could collide with the file it was retrying.
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, contacts }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameOntoTarget(temporary);
  }

  function list() {
    return load();
  }

  // Exact identity match only — no fuzzy scoring, deliberately.
  //
  // Fuzzy matching here would reintroduce exactly what this store exists to remove: a confident
  // guess about which person the owner meant. A near miss must fall through to asking, which is
  // cheap and correct, rather than resolving to someone the owner never named.
  function find(query, { channel = "" } = {}) {
    const wanted = normalize(query);
    if (!wanted) return null;
    const key = channelKey(channel);
    const matches = load().filter((contact) => identitiesOf(contact).includes(wanted));
    if (!matches.length) return null;
    if (key) {
      const withChannel = matches.filter((contact) => contact.channels?.[key]);
      // A contact who has no account on the surface being used is not a match for it.
      if (!withChannel.length) return null;
      return withChannel.sort((a, b) => String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")))[0];
    }
    return matches.sort((a, b) => String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")))[0];
  }

  // Two contacts sharing a name is the owner's business, not an error — but it must never be
  // silently collapsed, so callers can see it and ask.
  function findAll(query) {
    const wanted = normalize(query);
    if (!wanted) return [];
    return load().filter((contact) => identitiesOf(contact).includes(wanted));
  }

  function save({ id, name, aliases, channels = {}, notes, tags, pinned, replaceAliases = false } = {}) {
    const displayName = clean(name, 120);
    if (!displayName) throw new Error("A contact needs a name");
    const contacts = load();
    const existing = id ? contacts.find((item) => item.id === id) : null;
    if (id && !existing) throw new Error("No contact with that id");
    const now = new Date().toISOString();
    // Editing must be able to REMOVE an alias, not only add one. Union-merging every save meant a
    // typo'd alias could never be taken back out, so the editor sends the full list and says so.
    const incomingAliases = Array.isArray(aliases) ? aliases : [];
    const nextAliases = replaceAliases ? incomingAliases : [...(existing?.aliases || []), ...incomingAliases];
    const merged = {
      id: existing?.id || crypto.randomUUID(),
      name: displayName,
      aliases: [...new Set(nextAliases.map((item) => clean(item, 80)).filter(Boolean))],
      channels: { ...(existing?.channels || {}) },
      notes: notes === undefined ? (existing?.notes || "") : clean(notes, 2000),
      tags: tags === undefined
        ? (existing?.tags || [])
        : [...new Set((Array.isArray(tags) ? tags : []).map((item) => clean(item, 40)).filter(Boolean))].slice(0, 12),
      pinned: pinned === undefined ? Boolean(existing?.pinned) : Boolean(pinned),
      avatarPath: existing?.avatarPath || "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastUsedAt: existing?.lastUsedAt || null,
    };
    const problems = [];
    for (const [rawChannel, value] of Object.entries(channels || {})) {
      const key = channelKey(rawChannel);
      if (!key) { problems.push(`${rawChannel} is not a channel Jarvis knows`); continue; }
      // An explicit null is the editor saying "remove this channel" — distinct from omitting it,
      // which means "leave it alone".
      if (value === null) { delete merged.channels[key]; continue; }
      if (!value) continue;
      const meta = CHANNEL_META[key];
      const raw = clean(String(value.handle ?? value.address ?? value.value ?? ""), 200).replace(/^@/, "");
      if (raw) {
        const problem = validateChannelValue(key, raw);
        if (problem) { problems.push(problem); continue; }
      }
      const field = meta.kind === "address" ? "address" : "handle";
      merged.channels[key] = {
        ...(merged.channels[key] || {}),
        ...(raw ? { [field]: raw } : {}),
        ...(value.threadUrl ? { threadUrl: clean(value.threadUrl, 500) } : {}),
        ...(value.profileUrl ? { profileUrl: clean(value.profileUrl, 500) } : {}),
        ...(value.avatarUrl ? { avatarUrl: clean(value.avatarUrl, 1000) } : {}),
        updatedAt: now,
      };
    }
    if (problems.length) throw new Error(problems.join("; "));
    const next = existing
      ? contacts.map((item) => (item.id === merged.id ? merged : item))
      : [...contacts, merged];
    persist(next);
    return merged;
  }

  // Where the cached face for this person lives on disk. Set by the avatar fetcher, never by the
  // editor — a path the owner could type is a path that could point anywhere.
  function setAvatarPath(id, avatarPath) {
    const contacts = load();
    const contact = contacts.find((item) => item.id === id);
    if (!contact) return null;
    contact.avatarPath = clean(avatarPath, 300);
    contact.updatedAt = new Date().toISOString();
    persist(contacts);
    return contact;
  }

  // Recorded on every successful use, so the most recently used wins when a name is genuinely shared.
  function touch(id) {
    const contacts = load();
    const contact = contacts.find((item) => item.id === id);
    if (!contact) return null;
    contact.lastUsedAt = new Date().toISOString();
    persist(contacts);
    return contact;
  }

  function remove(id) {
    const contacts = load();
    const next = contacts.filter((item) => item.id !== id);
    if (next.length === contacts.length) return false;
    persist(next);
    return true;
  }

  // The one question the automation actually needs answered: where do I go to message this person
  // on this surface? A stored thread URL removes the inbox load, the search, the ranking and every
  // ambiguity that comes with them.
  function routeFor(query, channel) {
    const key = channelKey(channel);
    if (!key) return null;
    const contact = find(query, { channel: key });
    if (!contact) return null;
    const account = contact.channels[key];
    const target = account.threadUrl || account.profileUrl || "";
    if (!target && !account.handle && !account.address) return null;
    return {
      contactId: contact.id,
      name: contact.name,
      channel: key,
      handle: account.handle || "",
      address: account.address || "",
      url: target,
      avatarUrl: account.avatarUrl || "",
    };
  }

  function get(id) {
    return load().find((item) => item.id === id) || null;
  }

  return {
    CHANNELS, CHANNEL_META, channelCatalogue, filePath, find, findAll, get, identitiesOf, linkForChannel,
    list, normalize, remove, routeFor, save, setAvatarPath, touch, validateChannelValue,
  };
}

module.exports = {
  CHANNELS, CHANNEL_META, channelCatalogue, channelValueOf, createContactStore,
  linkForChannel, normalizeContactName: normalize, validateChannelValue,
};
