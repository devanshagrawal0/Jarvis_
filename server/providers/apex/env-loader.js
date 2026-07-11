"use strict";
/* Minimal .env loader (no npm dep). Reads KEY=VALUE lines from the project
   root .env and sets them on process.env WITHOUT overwriting values that are
   already present (real shell env wins). Comments (#) and blanks are skipped;
   surrounding quotes and whitespace are trimmed. CommonJS. */

const fs = require("fs");
const path = require("path");

function loadEnvFile(rootDir) {
  const file = path.join(rootDir, ".env");
  let loaded = 0;
  try {
    if (!fs.existsSync(file)) return { loaded: 0, file, present: false };
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (val && process.env[key] === undefined) { process.env[key] = val; loaded++; }
    }
    return { loaded, file, present: true };
  } catch (e) { return { loaded, file, present: false, error: e.message }; }
}

module.exports = { loadEnvFile };
