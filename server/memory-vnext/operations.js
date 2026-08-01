"use strict";
const { createOperationsRepository } = require("./repositories/operations-repository");
function createMemoryOperations({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository((dependencies) => createOperationsRepository({ ...dependencies, rootDir: store.paths.rootDir, dbPath: store.paths.dbPath }));
}
module.exports = { createMemoryOperations };
