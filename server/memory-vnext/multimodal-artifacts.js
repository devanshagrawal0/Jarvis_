"use strict";
const { createMultimodalArtifactRepository } = require("./repositories/multimodal-artifact-repository");
function createMultimodalArtifacts({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createMultimodalArtifactRepository); }
module.exports = { createMultimodalArtifacts };
