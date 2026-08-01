"use strict";
const { createMeshSyncRepository } = require("./repositories/mesh-sync-repository");
function createMeshMemorySync({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createMeshSyncRepository); }
module.exports = { createMeshMemorySync };
