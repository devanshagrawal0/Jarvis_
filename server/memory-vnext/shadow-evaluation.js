"use strict";
const { createShadowEvaluationRepository } = require("./repositories/shadow-evaluation-repository");
function createMemoryShadowEvaluation({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createShadowEvaluationRepository);
}
module.exports = { createMemoryShadowEvaluation };
