"use strict";

// The wire between Eclipse and the rest of Jarvis.
//
// Eclipse was built with a clean seam for this and nobody ever plugged anything into it:
// `run-graph.js` accepts an injected `toolbox`, the nodes call `toolbox["name"].run(args)`, and the
// lease gateway takes the implementation as a callback. What Eclipse was actually given at launch
// was web search and page fetch — nothing else. So a mission could research the world and know
// nothing about the owner: it could not name a contact, could not recall a memory, and could not
// use any of the capabilities the rest of Jarvis runs on.
//
// Worse, with no toolbox at all `runtime.js` falls back to `defaultToolStub`, which returns
// `sourceUri: "https://example.com/evidence"` — invented evidence. A mission could therefore
// "verify" a claim against a source that does not exist.
//
// This module supplies the real thing. Two rules govern it, and both are deliberate:
//
//   1. READING is free, ACTING is not. Looking up a contact or recalling a memory is a read and
//      needs only a read scope. Anything that touches the world goes through `jarvis.capability`,
//      which is registered as side-effecting — so the lease must be an approved one, and Eclipse
//      cannot talk its way past the gate any more than an agent can.
//   2. This bridge never becomes a second authority. It calls the same capability engine, the same
//      contact store and the same vault the main assistant uses. It holds no state of its own and
//      writes nothing. Eclipse's own curated memory stays where it is; this only lets a mission
//      READ what Jarvis already knows.

// Scopes the gateway needs to know about. Unknown tools are default-denied there, so a tool that
// is not listed here simply cannot run — which is the correct failure direction.
// The scope is deliberately named `…control`, not `…capability`. `lease.narrow()` only grants
// `sideEffecting` to a lease whose scopes match /write|control/, so a scope named anything else
// could never become side-effecting and `jarvis.capability` would have been permanently
// undeniable-in-theory and unusable-in-practice. Fitting the existing vocabulary is correct here;
// widening that regex to admit a new name would have quietly loosened every other lease too.
const BRIDGE_TOOL_SCOPE = {
  "contacts.lookup": "memory.read",
  "jarvis.capability": "jarvis.control",
};

// `jarvis.capability` reaches the real world, so it is always treated as side-effecting even when
// the specific capability behind it happens to be read-only. The engine's own confirmation gate
// still applies underneath; this is the outer of two locks, not a replacement for it.
const BRIDGE_SIDE_EFFECTING = ["jarvis.capability"];

function clean(value, max = 400) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

// Builds the toolbox Eclipse's nodes and agents call.
//
// Every dependency is injected rather than required here: the capability engine, contact store and
// vault are constructed in server.js with real paths and keys, and importing them again would
// create a second instance pointed at the same files — which is exactly the class of bug that made
// an entire "memory is dead" diagnosis wrong once already.
function createJarvisToolbox({ capabilityEngine = null, contactStore = null, neuralVault = null, sessionId = "eclipse", deviceId = "eclipse", source = "eclipse" } = {}) {
  const toolbox = {};

  // ── who someone is ────────────────────────────────────────────────────────
  // The specific thing Eclipse could not do: a mission told to message "tg" had no way to find out
  // that tg is a real person with a known handle and a known conversation.
  if (contactStore) {
    toolbox["contacts.lookup"] = {
      async run({ name = "", channel = "" } = {}) {
        const query = clean(name, 120);
        if (!query) return { found: false, reason: "no name given" };
        const matches = contactStore.findAll(query);
        if (!matches.length) return { found: false, query, reason: "no contact by that name" };
        // More than one match is not an answer. Say so rather than picking — guessing which person
        // the owner meant is the failure this store was built to end.
        if (matches.length > 1) {
          return { found: false, ambiguous: true, query, candidates: matches.map((item) => ({ name: item.name, channels: Object.keys(item.channels || {}) })) };
        }
        const contact = matches[0];
        const route = channel ? contactStore.routeFor(query, channel) : null;
        return {
          found: true,
          name: contact.name,
          aliases: contact.aliases || [],
          channels: Object.keys(contact.channels || {}),
          route: route ? { channel: route.channel, handle: route.handle, url: route.url } : null,
        };
      },
    };
  }

  // ── what Jarvis remembers ─────────────────────────────────────────────────
  // Read-only against the live vault. Eclipse keeps its own curated mission memory; this is purely
  // so a mission can see what the owner has already told the assistant.
  if (neuralVault && typeof neuralVault.searchMemories === "function") {
    toolbox["memory.retrieve"] = {
      async run({ query = "", limit = 8 } = {}) {
        const term = clean(query, 300);
        const rows = neuralVault.searchMemories(term, { limit: Math.min(Math.max(Number(limit) || 8, 1), 25) }) || [];
        return {
          query: term,
          count: rows.length,
          memories: rows.map((row) => ({ text: clean(row.content ?? row.text ?? row.title ?? "", 600), topic: row.topic || row.type || null, at: row.created_at || row.createdAt || null })).filter((row) => row.text),
        };
      },
    };
  }

  // ── doing something in the world ──────────────────────────────────────────
  // One door to all 129 capabilities rather than 129 doors. The lease gateway decides whether the
  // door opens at all; the engine decides whether the specific action needs owner confirmation.
  if (capabilityEngine && typeof capabilityEngine.execute === "function") {
    toolbox["jarvis.capability"] = {
      async run({ tool = "", args = {} } = {}) {
        const name = clean(tool, 80);
        if (!name) return { ok: false, error: "no capability named" };
        const known = (capabilityEngine.definitions || []).some((item) => item.name === name);
        if (!known) return { ok: false, error: `unknown capability "${name}"` };
        const result = await capabilityEngine.execute(name, args && typeof args === "object" ? args : {}, { sessionId, deviceId, source });
        // A capability that stopped for approval has NOT run. Report that as its own state — the
        // difference between "did not happen" and "failed" is the distinction the runtime kept
        // collapsing, and a mission that treats a pending approval as a failure will retry it.
        if (result?.status === "confirmation_required") {
          return { ok: false, pendingApproval: true, tool: name, confirmationId: result.confirmation?.id || null, summary: clean(result.confirmation?.summary, 300) };
        }
        return { ok: Boolean(result?.ok), tool: name, status: result?.status || null, error: result?.ok ? null : clean(result?.error, 400), result: result?.result ?? null };
      },
    };
  }

  return toolbox;
}

// What this bridge actually made available, for logging and for tests that must be able to fail.
function bridgeSummary(toolbox = {}) {
  return { tools: Object.keys(toolbox).sort(), count: Object.keys(toolbox).length };
}

module.exports = { BRIDGE_SIDE_EFFECTING, BRIDGE_TOOL_SCOPE, bridgeSummary, createJarvisToolbox };
