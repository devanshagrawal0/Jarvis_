"use strict";
const { createRetrievalPlannerRepository } = require("./repositories/retrieval-planner-repository");
function createRetrievalPlanner({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createRetrievalPlannerRepository); }
module.exports = { createRetrievalPlanner };
