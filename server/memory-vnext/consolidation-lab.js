"use strict";
const { createConsolidationLabRepository } = require("./repositories/consolidation-lab-repository");
function createConsolidationLab({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createConsolidationLabRepository); }
module.exports = { createConsolidationLab };
