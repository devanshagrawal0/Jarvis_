"use strict";
const { createArtifactRegistryRepository } = require("./repositories/artifact-registry-repository");
function createArtifactRegistry({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createArtifactRegistryRepository); }
module.exports = { createArtifactRegistry };
