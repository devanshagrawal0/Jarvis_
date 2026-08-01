"use strict";
const { createRoomManifestRepository } = require("./repositories/room-manifest-repository");
function createRoomManifests({ store } = {}) { if (!store?.attachRepository) throw new Error("A Memory vNext core store is required."); return store.attachRepository(createRoomManifestRepository); }
module.exports = { createRoomManifests };
