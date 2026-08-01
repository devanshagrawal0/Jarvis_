"use strict";

const { createConversationStateRepository } = require("./repositories/conversation-state-repository");

function createConversationStateKernel({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createConversationStateRepository);
}

module.exports = { createConversationStateKernel };
