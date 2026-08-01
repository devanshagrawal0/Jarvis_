"use strict";

const { createConversationRepository } = require("./repositories/conversation-repository");

function createConversationJournal({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createConversationRepository);
}

module.exports = { createConversationJournal };
