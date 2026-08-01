"use strict";

const { EventEmitter } = require("node:events");
const { createObservabilityRepository } = require("./repositories/observability-repository");

function createMemoryObservability({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const repository = store.attachRepository(createObservabilityRepository);
  const events = new EventEmitter();
  events.setMaxListeners(50);

  function safeEmit(name, value) {
    for (const listener of events.listeners(name)) {
      try { listener(value); } catch {}
    }
  }

  function health({ persist = false } = {}) {
    const snapshot = repository.readModel({ dbPath: store.paths.dbPath });
    if (persist) repository.saveSnapshot(snapshot);
    safeEmit("health", snapshot);
    return snapshot;
  }

  function recordMetric(input) {
    const result = repository.recordMetric(input);
    safeEmit("metric", result);
    return result;
  }

  function recordCost(input) {
    const result = repository.recordCost(input);
    safeEmit("cost", result);
    return result;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Health listener must be a function.");
    events.on("health", listener);
    return () => events.off("health", listener);
  }

  function commandCenterModel() {
    const state = health();
    return {
      title: "Memory Command Center",
      state: state.status,
      cards: [
        { id: "canonical", label: "Canonical sequence", value: state.canonicalSequence, status: "ok" },
        { id: "wal", label: "WAL bytes", value: state.storage.walBytes, status: "ok" },
        { id: "jobs", label: "Queued jobs", value: Number(state.jobs.queued || 0) + Number(state.jobs.retry || 0), status: state.deadLetters.jobs ? "degraded" : "ok" },
        { id: "outbox", label: "Pending outbox", value: Number(state.outbox.pending || 0) + Number(state.outbox.retry || 0), status: state.deadLetters.outbox ? "degraded" : "ok" },
        { id: "denials", label: "Policy denials", value: state.policyDenials, status: "ok" },
        { id: "cost", label: "Provider cost (USD)", value: state.cost.costUsd, status: "ok" },
        { id: "backups", label: "Verified backups", value: state.backups.count, status: state.backups.latest?.quick_check === "ok" || !state.backups.latest ? "ok" : "degraded" },
      ],
      actions: ["pause", "resume", "drain", "reap_expired_leases", "inspect_dead_letters", "verify_integrity"],
      generatedAt: state.generatedAt,
    };
  }

  return Object.freeze({ commandCenterModel, health, recordCost, recordMetric, repository, subscribe, trace: repository.trace });
}

module.exports = { createMemoryObservability };
