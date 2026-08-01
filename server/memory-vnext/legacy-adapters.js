"use strict";

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createMemoryStoreReadAdapter({ memoryStore } = {}) {
  if (!memoryStore || typeof memoryStore.search !== "function") return null;
  return {
    id: "legacy.memory-store",
    authority: "legacy",
    capabilities: Object.freeze({ search: true, health: true, write: false }),
    scopes: Object.freeze(["owner"]),
    async health() {
      const stats = typeof memoryStore.stats === "function" ? memoryStore.stats() : {};
      return { ok: true, active: numberOr(stats?.active), kinds: {
        episodic: numberOr(stats?.episodic),
        semantic: numberOr(stats?.semantic),
        procedural: numberOr(stats?.procedural),
      } };
    },
    async search({ query, limit, kinds }) {
      const rows = memoryStore.search(query, { limit, kinds });
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        ref: String(row?.id || ""),
        text: String(row?.text || ""),
        kind: String(row?.kind || "unknown"),
        category: row?.category == null ? null : String(row.category),
        source: row?.source == null ? "legacy" : String(row.source),
        confidence: numberOr(row?.confidence),
        importance: numberOr(row?.importance),
        score: numberOr(row?.score),
        createdAt: row?.createdAt == null ? null : String(row.createdAt),
        updatedAt: row?.updatedAt == null ? null : String(row.updatedAt),
      })).filter((row) => row.text);
    },
  };
}

function createNeuralVaultHealthAdapter({ neuralVault } = {}) {
  if (!neuralVault || typeof neuralVault.status !== "function") return null;
  return {
    id: "legacy.neural-vault-health",
    authority: "legacy",
    capabilities: Object.freeze({ search: false, health: true, write: false }),
    scopes: Object.freeze(["owner"]),
    async health() {
      const status = neuralVault.status() || {};
      return {
        ok: status.ok !== false,
        schemaVersion: status.schemaVersion == null ? null : String(status.schemaVersion),
        countsPresent: Boolean(status.counts && typeof status.counts === "object"),
      };
    },
  };
}

function createLegacyMemoryAdapters({ memoryStore, neuralVault } = {}) {
  return [
    createMemoryStoreReadAdapter({ memoryStore }),
    createNeuralVaultHealthAdapter({ neuralVault }),
  ].filter(Boolean);
}

module.exports = { createLegacyMemoryAdapters, createMemoryStoreReadAdapter, createNeuralVaultHealthAdapter };
