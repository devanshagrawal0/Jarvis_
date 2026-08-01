"use strict";

const { createKnowledgeRepository } = require("./repositories/knowledge-repository");

function createKnowledgeService({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createKnowledgeRepository);
}

module.exports = { createKnowledgeService };
