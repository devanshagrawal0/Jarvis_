const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Agent Protocol Standard — auto-discovery from runtime plugin directories.
// Each .js file must export: { meta, triggers, permissions, character, behavior, steps }
// Skills also export steps[]. Modules also export tools[] and routes[].

const REQUIRED_META_FIELDS = ["name", "version", "description"];
const VALID_CATEGORIES = new Set(["agent", "skill", "module", "tool", "persona"]);

function validatePlugin(exported, filePath) {
  const errors = [];
  const { meta } = exported;
  if (!meta || typeof meta !== "object") {
    errors.push("missing or invalid meta object");
    return errors;
  }
  for (const field of REQUIRED_META_FIELDS) {
    if (!meta[field]) errors.push(`meta.${field} is required`);
  }
  if (meta.category && !VALID_CATEGORIES.has(meta.category)) {
    errors.push(`meta.category must be one of: ${[...VALID_CATEGORIES].join(", ")}`);
  }
  return errors;
}

function safeRequire(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    return { ok: true, exported: require(filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function scanDirectory(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js") || entry.name.startsWith("_")) continue;
    const filePath = path.join(dirPath, entry.name);
    const { ok, exported, error } = safeRequire(filePath);
    if (!ok) {
      results.push({ filePath, ok: false, error, plugin: null });
      continue;
    }
    const errors = validatePlugin(exported, filePath);
    if (errors.length) {
      results.push({ filePath, ok: false, error: errors.join("; "), plugin: null });
      continue;
    }
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    results.push({
      filePath,
      ok: true,
      error: null,
      plugin: {
        id: crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 12),
        filePath,
        name: exported.meta.name,
        version: exported.meta.version,
        description: exported.meta.description,
        category: exported.meta.category || "agent",
        author: exported.meta.author || "unknown",
        icon: exported.meta.icon || null,
        tags: Array.isArray(exported.meta.tags) ? exported.meta.tags : [],
        triggers: exported.triggers || {},
        permissions: exported.permissions || {},
        character: exported.character || {},
        behavior: exported.behavior || {},
        steps: Array.isArray(exported.steps) ? exported.steps : null,
        tools: Array.isArray(exported.tools) ? exported.tools : null,
        routes: Array.isArray(exported.routes) ? exported.routes : null,
        onStart: typeof exported.onStart === "function" ? exported.onStart : null,
        onShutdown: typeof exported.onShutdown === "function" ? exported.onShutdown : null,
        loadedAt: new Date().toISOString(),
        mtimeMs: stat?.mtimeMs || 0,
      },
    });
  }
  return results;
}

function createAgentLoader({ runtimeDir } = {}) {
  const pluginDirs = {
    agents: path.join(runtimeDir, "neural_vault", "agents", "definitions"),
    skills: path.join(runtimeDir, "neural_vault", "skills", "compiled"),
    modules: path.join(runtimeDir, "neural_vault", "skills", "templates"),
  };

  // Ensure directories exist
  for (const dir of Object.values(pluginDirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let plugins = [];
  let loadedAt = null;
  let errors = [];

  function reload() {
    const all = [];
    const allErrors = [];
    for (const [kind, dir] of Object.entries(pluginDirs)) {
      const results = scanDirectory(dir);
      for (const result of results) {
        if (result.ok) {
          all.push({ ...result.plugin, sourceKind: kind });
        } else {
          allErrors.push({ filePath: result.filePath, error: result.error, sourceKind: kind });
        }
      }
    }
    plugins = all;
    errors = allErrors;
    loadedAt = new Date().toISOString();
    return { plugins: all.length, errors: allErrors.length, loadedAt };
  }

  function list(options = {}) {
    const { category, tag, search } = options;
    let result = [...plugins];
    if (category) result = result.filter((p) => p.category === category);
    if (tag) result = result.filter((p) => p.tags.includes(tag));
    if (search) {
      const q = String(search).toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    return result;
  }

  function get(name) {
    return plugins.find((p) => p.name === name || p.id === name) || null;
  }

  function matchTrigger(prompt, context = {}) {
    const matches = [];
    const promptLower = String(prompt || "").toLowerCase();
    for (const plugin of plugins) {
      const { triggers } = plugin;
      if (!triggers) continue;
      let score = 0;
      // Phrase matching
      if (Array.isArray(triggers.phrases)) {
        for (const phrase of triggers.phrases) {
          if (promptLower.includes(String(phrase).toLowerCase())) {
            score += 1;
          }
        }
      }
      // Intent matching
      if (Array.isArray(triggers.intents) && context.intent) {
        if (triggers.intents.includes(context.intent)) score += 2;
      }
      // Event matching
      if (triggers.onEvent && context.event && triggers.onEvent === context.event) score += 3;
      if (score > 0) matches.push({ plugin, score });
    }
    return matches.sort((a, b) => b.score - a.score).map((m) => m.plugin);
  }

  function status() {
    return {
      plugins: plugins.length,
      errors: errors.length,
      errorList: errors,
      loadedAt,
      dirs: pluginDirs,
      byCategory: Object.fromEntries(
        [...new Set(plugins.map((p) => p.category))].map((cat) => [
          cat,
          plugins.filter((p) => p.category === cat).length,
        ]),
      ),
    };
  }

  // Load on creation
  reload();

  return { reload, list, get, matchTrigger, status, dirs: pluginDirs };
}

module.exports = { createAgentLoader };
