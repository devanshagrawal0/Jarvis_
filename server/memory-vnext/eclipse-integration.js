"use strict";
const { createEclipseIntegrationRepository } = require("./repositories/eclipse-integration-repository");
const { createRoomManifestRepository } = require("./repositories/room-manifest-repository");
function createEclipseMemoryIntegration({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  return store.attachRepository((dependencies) => createEclipseIntegrationRepository({ ...dependencies, rooms: createRoomManifestRepository(dependencies) }));
}
module.exports = { createEclipseMemoryIntegration };
