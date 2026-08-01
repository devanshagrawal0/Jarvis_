"use strict";
const { createContextRuntimeRepository } = require("./repositories/context-runtime-repository");
function createContextRuntime({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createContextRuntimeRepository); }
module.exports = { createContextRuntime };
