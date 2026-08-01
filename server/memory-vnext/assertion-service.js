"use strict";

const { createAssertionRepository } = require("./repositories/assertion-repository");

function createAssertionService({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createAssertionRepository);
}

module.exports = { createAssertionService };
