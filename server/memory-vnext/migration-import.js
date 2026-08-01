"use strict";

const crypto = require("node:crypto");
const { createImportStagingRepository } = require("./repositories/import-staging-repository");
const { legacySnapshotTableInfo, readLegacySnapshotTable } = require("./storage/core-store");

function hashJson(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function createMemoryMigration({ store, allowedSnapshotRoots = [] } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const repository = store.attachRepository(createImportStagingRepository);

  function verifySources(sources) {
    const inspections = new Map();
    return sources.map((source) => {
      const snapshotKey = String(source.snapshotPath);
      const inspection = inspections.get(snapshotKey) || legacySnapshotTableInfo(source.snapshotPath, { allowedRoots: allowedSnapshotRoots });
      inspections.set(snapshotKey, inspection);
      if (inspection.sha256 !== String(source.snapshotSha256)) throw Object.assign(new Error(`Snapshot checksum mismatch for ${source.sourceKey}.`), { code: "LEGACY_SNAPSHOT_HASH_MISMATCH" });
      const table = inspection.tables.find((candidate) => candidate.name === String(source.table));
      if (!table) throw Object.assign(new Error(`Snapshot table ${source.table} is unavailable.`), { code: "LEGACY_TABLE_UNAVAILABLE" });
      if (source.expectedRows != null && Number(source.expectedRows) !== table.rowCount) throw Object.assign(new Error(`Snapshot row-count mismatch for ${source.sourceKey}/${source.table}.`), { code: "LEGACY_ROW_COUNT_MISMATCH" });
      return { ...source, expectedRows: table.rowCount, columns: source.columns?.length ? source.columns : table.columns };
    });
  }

  function stageClosedSnapshots(input = {}) {
    const verified = verifySources(Array.isArray(input.sources) ? input.sources : []);
    const inventoryHash = String(input.inventoryHash || hashJson(verified.map(({ snapshotPath, ...source }) => source)));
    const snapshotSetHash = String(input.snapshotSetHash || hashJson(verified.map((source) => ({ sourceKey: source.sourceKey, sha256: source.snapshotSha256 }))));
    const created = repository.createRun({ id: input.id, inventoryHash, snapshotSetHash, adapterVersion: input.adapterVersion, sources: verified });
    for (const source of verified) {
      const registered = created.sources.find((item) => item.source_key === String(source.sourceKey) && item.table_name === String(source.table));
      if (source.action === "exclude") {
        repository.excludeSource({ sourceId: registered.id, reason: source.exclusionReason || "ARCHIVE_ONLY" });
        input.onProgress?.({ sourceKey: source.sourceKey, table: source.table, action: "exclude", rows: source.expectedRows });
        continue;
      }
      for (let offset = 0; offset < source.expectedRows; offset += Math.max(1, Number(input.batchSize) || 500)) {
        const page = readLegacySnapshotTable(source.snapshotPath, { allowedRoots: allowedSnapshotRoots, table: source.table, columns: source.columns, limit: input.batchSize || 500, offset });
        repository.stageRecords({ sourceId: registered.id, rows: page.rows, offset });
      }
      if (source.expectedRows === 0) repository.stageRecords({ sourceId: registered.id, rows: [] });
      input.onProgress?.({ sourceKey: source.sourceKey, table: source.table, action: "import", rows: source.expectedRows });
    }
    return repository.inspectRun(created.id);
  }

  return Object.freeze({ ...repository, stageClosedSnapshots, verifySources });
}

module.exports = { createMemoryMigration, hashJson };
