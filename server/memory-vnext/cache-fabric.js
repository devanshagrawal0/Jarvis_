"use strict";
const { createCacheFabricRepository } = require("./repositories/cache-fabric-repository");
function createCacheFabric({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createCacheFabricRepository); }
module.exports = { createCacheFabric };
