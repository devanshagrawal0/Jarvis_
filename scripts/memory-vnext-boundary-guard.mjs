#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionEntrypointsAllowedToConstructLegacyMemory = new Set([
  "server.js",
  "server/memory-full-test.js",
  "server/smoke-tests.js",
]);
const vnextDatabaseDriverOwners = new Set(["server/memory-vnext/storage/core-store.js"]);
const vnextSqlOwners = [
  "server/memory-vnext/storage/core-store.js",
  "server/memory-vnext/storage/migrations.js",
  "server/memory-vnext/repositories/",
  "server/memory-vnext/key-hierarchy.js",
  "server/memory-vnext/supervisor.js",
];
const legacyConstructorPattern = /require\(["'][^"']*(?:memory-store|neural-vault|memory-vectors|user-context)["']\)/g;
// NOT global: this is consumed with `.test()` inside the file loop, and a /g regex carries
// `lastIndex` between calls — so it matched, advanced past the match, then returned false on the
// next file that genuinely violated the rule. The guard skipped roughly every other offender
// while reporting a clean pass. `legacyConstructorPattern` keeps /g because it uses matchAll.
const databaseDriverPattern = /require\(["'](?:better-sqlite3|node:sqlite|sqlite3)["']\)/;
const sqlUsagePattern = /\bdb\.(?:prepare|exec|pragma)\s*\(/;

// A guard that cannot fail is worse than no guard, because it gets trusted. Before scanning
// anything, confirm each detector still fires on a known-bad sample and stays quiet on a
// known-good one. Testing each twice also proves no regex state is carried between calls —
// the exact defect above.
function selfTest() {
  const problems = [];
  const twice = (pattern, sample) => pattern.test(sample) && pattern.test(sample);
  if (!twice(databaseDriverPattern, 'const Database = require("better-sqlite3");')) problems.push("databaseDriverPattern misses a driver import, or carries regex state between calls");
  if (databaseDriverPattern.test('require("./storage/core-store")')) problems.push("databaseDriverPattern matches a safe import");
  if (!twice(sqlUsagePattern, 'db.prepare("SELECT 1")')) problems.push("sqlUsagePattern misses raw SQL, or carries regex state between calls");
  if (sqlUsagePattern.test("store.attachRepository(factory)")) problems.push("sqlUsagePattern matches a safe call");
  if ([...'const x = require("./neural-vault");'.matchAll(legacyConstructorPattern)].length !== 1) problems.push("legacyConstructorPattern misses a legacy constructor import");
  if (problems.length) {
    console.error("Memory vNext boundary guard SELF-TEST FAILED — the guard cannot detect violations:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}
selfTest();

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "dist-desktop"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
}

const violations = [];
for (const absolute of [path.join(root, "server.js"), ...walk(path.join(root, "server"))]) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = fs.readFileSync(absolute, "utf8");
  const constructorImports = [...source.matchAll(legacyConstructorPattern)];
  if (constructorImports.length && !productionEntrypointsAllowedToConstructLegacyMemory.has(relative)) {
    violations.push(`${relative}: imports a legacy memory constructor outside the approved composition root`);
  }
  if (relative.startsWith("server/memory-vnext/") && databaseDriverPattern.test(source) && !vnextDatabaseDriverOwners.has(relative)) {
    violations.push(`${relative}: imports a database driver outside the protected core owner`);
  }
  if (relative.startsWith("server/memory-vnext/")
    && /\bdb\.(?:prepare|exec|pragma)\s*\(/.test(source)
    && !vnextSqlOwners.some((owner) => relative === owner || relative.startsWith(owner))) {
    violations.push(`${relative}: issues SQL outside the approved storage/repository layer`);
  }
}

if (violations.length) {
  process.stderr.write(`Memory vNext boundary guard failed:\n- ${violations.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Memory vNext boundary guard passed: legacy constructors stay grandfathered; one protected vNext driver owner; SQL remains repository-scoped.\n");
}
