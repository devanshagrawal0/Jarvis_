"use strict";

const { createPersonalMemoryRepository } = require("./repositories/personal-memory-repository");

function createPersonalMemoryService({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createPersonalMemoryRepository);
}

module.exports = { createPersonalMemoryService };
