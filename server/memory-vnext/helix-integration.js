"use strict";
const { createHelixIntegrationRepository } = require("./repositories/helix-integration-repository");
function createHelixIntegration({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createHelixIntegrationRepository); }
module.exports = { createHelixIntegration };
