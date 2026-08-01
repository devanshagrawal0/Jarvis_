"use strict";
const { createEmbeddingRepository } = require("./repositories/embedding-repository");

function createEmbeddingGateway({ store, adapters = {} } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); const repository = store.attachRepository(createEmbeddingRepository);
  async function embed(input = {}) {
    const requested = repository.requestEmbedding(input); if (!requested.providerCallRequired) return requested;
    const adapter = adapters[requested.profile.lane] || adapters[requested.profile.provider];
    if (!adapter?.embed) return { ...requested, status: "queued", degraded: true, reason: "ADAPTER_UNAVAILABLE", fallbackLanes: ["exact","lexical","graph","task"] };
    const started = Date.now();
    try { const output = await adapter.embed({ content: input.content, profile: requested.profile, taskInstruction: requested.profile.taskInstruction });
      return repository.completeEmbedding({ requestId: requested.id, vector: output.vector, provider: output.provider || requested.profile.provider, model: output.model || requested.profile.model,
        lane: requested.profile.lane, batchId: output.batchId, inputUnits: output.inputUnits || 0, costUsd: output.costUsd || 0, durationMs: Date.now() - started });
    } catch (error) { const failed = repository.failEmbedding({ requestId: requested.id, errorCode: error?.code || "PROVIDER_FAILURE" }); return { ...failed, degraded: true, fallbackLanes: ["exact","lexical","graph","task"] }; }
  }
  return Object.freeze({ ...repository, embed, repository });
}
module.exports = { createEmbeddingGateway };
