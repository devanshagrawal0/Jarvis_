"use strict";
const { createTemporalGraphRepository } = require("./repositories/temporal-graph-repository");
function createTemporalGraph({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createTemporalGraphRepository); }
module.exports = { createTemporalGraph };
