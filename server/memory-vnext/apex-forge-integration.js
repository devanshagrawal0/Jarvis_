"use strict";
const { createApexForgeIntegrationRepository } = require("./repositories/apex-forge-integration-repository");
function createApexForgeIntegration({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createApexForgeIntegrationRepository); }
module.exports = { createApexForgeIntegration };
