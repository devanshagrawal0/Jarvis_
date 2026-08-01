"use strict";

const { createTruthMaintenanceRepository } = require("./repositories/truth-maintenance-repository");

function createTruthMaintenance({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository(createTruthMaintenanceRepository);
}

module.exports = { createTruthMaintenance };
