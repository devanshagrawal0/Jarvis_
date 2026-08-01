const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".css", ".html"]);
const SECRET_LIKE_PATTERN = /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{20,}|[A-Za-z0-9_-]{40,})\b|(?:api[_-]?key|secret|password|private[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^"'\s]{12,}/i;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "runtime",
  "output",
  "artifacts",
  "reports",
  "design",
  "test-results",
  "playwright-report",
  ".wrangler",
]);
const MAX_FILE_BYTES = 300_000;
const CHUNK_LINES = 90;
const CHUNK_OVERLAP = 12;

function tokenize(value) {
  const separated = String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return [...new Set(separated.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])];
}

function dot(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += a[index] * b[index];
  return total;
}

function extractSymbols(text) {
  const symbols = [];
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g,
    /\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) symbols.push(match[1]);
  }
  return [...new Set(symbols)].slice(0, 80);
}

function createCodeKnowledge({ rootDir, runtimeDir, getSettings }) {
  const indexPath = path.join(runtimeDir, "code-knowledge.json");
  let index = { version: 1, generatedAt: "", rootDir, hash: "", chunks: [] };
  let building = null;

  function readStored() {
    try {
      const stored = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (stored?.version === 1 && Array.isArray(stored.chunks)) index = stored;
    } catch {
      // The first build creates the index.
    }
  }

  const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

  async function sourceFiles() {
    const files = [];
    const queue = [rootDir];
    let scannedDirectories = 0;
    while (queue.length) {
      const current = queue.shift();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(target);
        } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          const stat = fs.statSync(target);
          if (stat.size <= MAX_FILE_BYTES) files.push({ path: target, size: stat.size, mtimeMs: stat.mtimeMs });
        }
      }
      scannedDirectories += 1;
      if (scannedDirectories % 20 === 0) await yieldEventLoop();
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  function corpusHash(files) {
    return crypto.createHash("sha256")
      .update(files.map((file) => `${file.path}:${file.size}:${file.mtimeMs}`).join("\n"))
      .digest("hex");
  }

  function chunkFile(file) {
    const relativePath = path.relative(rootDir, file.path);
    const text = fs.readFileSync(file.path, "utf8");
    if (SECRET_LIKE_PATTERN.test(text)) {
      return [{
        id: crypto.createHash("sha1").update(`${relativePath}:secret-blocked`).digest("hex"),
        path: relativePath,
        startLine: 1,
        endLine: 1,
        symbols: [],
        text: "[secret-like content blocked from source-code index]",
        tokens: tokenize(`${relativePath} secret blocked credential private key token`).slice(0, 1000),
        blocked: true,
        blockReason: "secret-like content",
        embedding: null,
      }];
    }
    const lines = text.split(/\r?\n/);
    const symbols = extractSymbols(text);
    const chunks = [];
    for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
      const selected = lines.slice(start, start + CHUNK_LINES);
      if (!selected.join("").trim()) continue;
      const content = selected.join("\n").slice(0, 12_000);
      chunks.push({
        id: crypto.createHash("sha1").update(`${relativePath}:${start}:${content}`).digest("hex"),
        path: relativePath,
        startLine: start + 1,
        endLine: Math.min(lines.length, start + selected.length),
        symbols: symbols.filter((symbol) => content.includes(symbol)).slice(0, 30),
        text: content,
        tokens: tokenize(`${relativePath} ${symbols.join(" ")} ${content}`).slice(0, 1000),
        embedding: null,
      });
      if (start + CHUNK_LINES >= lines.length) break;
    }
    return chunks;
  }

  async function embedChunks(chunks) {
    const settings = getSettings();
    if (!settings.geminiKey || !chunks.length) return chunks;
    const ai = new GoogleGenAI({ apiKey: settings.geminiKey });
    const preferred = chunks
      .filter((chunk) => /^(server\.js|server[\\/]|src[\\/]|config[\\/]|tests[\\/])/.test(chunk.path))
      .slice(0, 500);
    const pending = preferred.filter((chunk) => !Array.isArray(chunk.embedding));
    for (let offset = 0; offset < pending.length; offset += 20) {
      const batch = pending.slice(offset, offset + 20);
      try {
        const response = await ai.models.embedContent({
          model: settings.geminiEmbeddingModel || "gemini-embedding-2",
          contents: batch.map((chunk) => ({
            parts: [{
              text: `title: ${chunk.path} lines ${chunk.startLine}-${chunk.endLine} | text: ${chunk.text.slice(0, 6000)}`,
            }],
          })),
          config: { outputDimensionality: 768 },
        });
        for (let index = 0; index < batch.length; index += 1) {
          batch[index].embedding = response.embeddings?.[index]?.values || null;
        }
      } catch {
        break;
      }
    }
    return chunks;
  }

  async function rebuild(options = {}) {
    if (building) return building;
    building = (async () => {
      const files = await sourceFiles();
      const hash = corpusHash(files);
      if (!options.force && hash === index.hash && index.chunks.length) {
        if (options.embeddings !== false && !index.embeddingComplete) {
          await embedChunks(index.chunks);
          index.embeddingComplete = true;
          fs.writeFileSync(indexPath, `${JSON.stringify(index)}\n`, "utf8");
        }
        return index;
      }
      const oldEmbeddings = new Map(index.chunks.map((chunk) => [chunk.id, chunk.embedding]));
      const chunks = [];
      for (let index = 0; index < files.length; index += 1) {
        chunks.push(...chunkFile(files[index]));
        if (index > 0 && index % 20 === 0) await yieldEventLoop();
      }
      for (const chunk of chunks) chunk.embedding = oldEmbeddings.get(chunk.id) || null;
      index = {
        version: 1,
        generatedAt: new Date().toISOString(),
        rootDir,
        hash,
        files: files.length,
        embeddingComplete: false,
        chunks,
      };
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(indexPath, `${JSON.stringify(index)}\n`, "utf8");
      if (options.embeddings !== false) {
        await embedChunks(chunks);
        index.embeddingComplete = true;
        fs.writeFileSync(indexPath, `${JSON.stringify(index)}\n`, "utf8");
      }
      return index;
    })().finally(() => {
      building = null;
    });
    return building;
  }

  function lexicalScore(chunk, queryTokens) {
    if (!queryTokens.length) return 0;
    const tokenSet = new Set(chunk.tokens);
    let score = 0;
    for (const token of queryTokens) {
      if (tokenSet.has(token)) score += 2;
      if (chunk.path.toLowerCase().includes(token)) score += 4;
      if (chunk.symbols.some((symbol) => symbol.toLowerCase().includes(token))) score += 5;
    }
    if (/^(server\.js|server[\\/]|src[\\/]|config[\\/])/.test(chunk.path)) score += 1.5;
    if (/^(app\.mjs|styles\.css)$/.test(chunk.path)) score -= 1;
    return score / Math.max(1, queryTokens.length);
  }

  async function queryEmbedding(query) {
    const settings = getSettings();
    if (!settings.geminiKey) return null;
    try {
      const ai = new GoogleGenAI({ apiKey: settings.geminiKey });
      const response = await ai.models.embedContent({
        model: settings.geminiEmbeddingModel || "gemini-embedding-2",
        contents: `task: question answering | query: ${query}`,
        config: { outputDimensionality: 768 },
      });
      return response.embeddings?.[0]?.values || null;
    } catch {
      return null;
    }
  }

  async function search(query, options = {}) {
    if (!index.chunks.length) await rebuild({ embeddings: false });
    const limit = Math.max(1, Math.min(20, Number(options.limit || 8)));
    const queryTokens = tokenize(query).slice(0, 30);
    const lexical = index.chunks
      .map((chunk) => ({ chunk, lexical: lexicalScore(chunk, queryTokens) }))
      .filter((item) => item.lexical > 0)
      .sort((a, b) => b.lexical - a.lexical)
      .slice(0, 80);
    const lexicalConfidence = lexical[0]?.lexical || 0;
    const shouldUseSemantic = options.semantic !== false
      && index.embeddingComplete
      && lexicalConfidence < Number(options.semanticThreshold || 2.4);
    const embedding = shouldUseSemantic ? await queryEmbedding(query) : null;
    const candidates = embedding
      ? lexical.map((item) => ({
          ...item,
          semantic: item.chunk.embedding ? dot(embedding, item.chunk.embedding) : 0,
        }))
      : lexical.map((item) => ({ ...item, semantic: 0 }));
    return candidates
      .map((item) => ({
        path: item.chunk.path,
        startLine: item.chunk.startLine,
        endLine: item.chunk.endLine,
        symbols: item.chunk.symbols,
        excerpt: item.chunk.text.slice(0, 3500),
        score: Number((item.lexical * 0.55 + item.semantic * 8 * 0.45).toFixed(4)),
        retrieval: embedding ? "hybrid" : "lexical",
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function inspect() {
    const important = ["server.js", "server/capability-engine.js", "server/memory-store.js", "src/liveVoice.ts", "src/SimpleApp.tsx"];
    let frontendEntry = "";
    try {
      frontendEntry = fs.readFileSync(path.join(rootDir, "src", "main.tsx"), "utf8").slice(0, 3000);
    } catch {
      frontendEntry = "Frontend entry could not be read.";
    }
    return {
      stats: stats(),
      activeRuntime: {
        backendEntry: "server.js",
        frontendEntry: "src/main.tsx",
        frontendEntryEvidence: frontendEntry,
        currentShell: frontendEntry.includes("SimpleApp") ? "src/SimpleApp.tsx" : "Inspect src/main.tsx",
        voicePipeline: ["server.js:createGeminiLiveToken", "src/liveVoice.ts:LiveVoiceController", "src/SimpleApp.tsx:toggleVoice"],
      },
      architecture: important.map((file) => {
        const chunks = index.chunks.filter((chunk) => chunk.path.replaceAll("\\", "/") === file);
        return { file, symbols: [...new Set(chunks.flatMap((chunk) => chunk.symbols))].slice(0, 40) };
      }),
    };
  }

  function stats() {
    return {
      generatedAt: index.generatedAt,
      rootDir,
      files: index.files || 0,
      chunks: index.chunks.length,
      embeddedChunks: index.chunks.filter((chunk) => Array.isArray(chunk.embedding)).length,
      embeddingComplete: Boolean(index.embeddingComplete),
      indexPath,
    };
  }

  readStored();
  return { rebuild, search, inspect, stats };
}

module.exports = { createCodeKnowledge };
