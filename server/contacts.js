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

const CHANNELS = ["instagram", "whatsapp", "email", "telegram", "slack", "linkedin", "sms"];

function clean(value, max = 200) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
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

  function persist(contacts) {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, contacts }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, filePath);
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

  function save({ id, name, aliases = [], channels = {} } = {}) {
    const displayName = clean(name, 120);
    if (!displayName) throw new Error("A contact needs a name");
    const contacts = load();
    const existing = id ? contacts.find((item) => item.id === id) : null;
    const now = new Date().toISOString();
    const merged = {
      id: existing?.id || crypto.randomUUID(),
      name: displayName,
      aliases: [...new Set([...(existing?.aliases || []), ...aliases].map((item) => clean(item, 80)).filter(Boolean))],
      channels: { ...(existing?.channels || {}) },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastUsedAt: existing?.lastUsedAt || null,
    };
    for (const [rawChannel, value] of Object.entries(channels || {})) {
      const key = channelKey(rawChannel);
      if (!key || !value) continue;
      merged.channels[key] = {
        ...(merged.channels[key] || {}),
        ...(value.handle ? { handle: clean(String(value.handle).replace(/^@/, ""), 100) } : {}),
        ...(value.address ? { address: clean(value.address, 200) } : {}),
        ...(value.threadUrl ? { threadUrl: clean(value.threadUrl, 500) } : {}),
        ...(value.profileUrl ? { profileUrl: clean(value.profileUrl, 500) } : {}),
        ...(value.avatarUrl ? { avatarUrl: clean(value.avatarUrl, 1000) } : {}),
        updatedAt: now,
      };
    }
    const next = existing
      ? contacts.map((item) => (item.id === merged.id ? merged : item))
      : [...contacts, merged];
    persist(next);
    return merged;
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

  return { CHANNELS, filePath, find, findAll, identitiesOf, list, normalize, remove, routeFor, save, touch };
}

module.exports = { CHANNELS, createContactStore, normalizeContactName: normalize };
