"use strict";
const { createCutoverCoordinatorRepository } = require("./repositories/cutover-coordinator-repository");
const { legacySnapshotTableInfo } = require("./storage/core-store");

function createMemoryCutoverCoordinator({ store, allowedSnapshotRoots = [] } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const repository = store.attachRepository(createCutoverCoordinatorRepository);
  function registerClosedArchive(input = {}) {
    const inspection = legacySnapshotTableInfo(input.snapshotPath, { allowedRoots: allowedSnapshotRoots });
    if (inspection.sha256 !== String(input.snapshotSha256)) throw Object.assign(new Error("Archive snapshot checksum mismatch."), { code: "LEGACY_SNAPSHOT_HASH_MISMATCH" });
    return repository.registerArchive({ ...input, snapshotPath: inspection.path, closedSnapshotVerified: inspection.quickCheck === "ok", readOnlyVerified: true });
  }
  return Object.freeze({ ...repository, registerClosedArchive });
}
module.exports = { createMemoryCutoverCoordinator };
