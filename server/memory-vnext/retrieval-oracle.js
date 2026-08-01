"use strict";
const { createRetrievalOracleRepository } = require("./repositories/retrieval-oracle-repository");
function createRetrievalOracle({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createRetrievalOracleRepository); }
module.exports = { createRetrievalOracle };
