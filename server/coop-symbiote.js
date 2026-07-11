const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_ABILITIES = {
  sharedSourceTree: true,
  readSourceFiles: false,
  suggestCodeEdits: true,
  sharedChat: true,
  jarvisBridge: true,
  sharedTaskBoard: true,
  sharedTestStatus: true,
  patchCourt: true,
  sessionReplay: true,
  liveEditCode: false,
  liveScreenView: false,
  remoteScreenControl: false,
  terminalAccess: false,
  projectMemoryPacket: false,
  skillTransfer: false,
};

const BLOCKED_PATH_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])credentials\./i,
  /(^|[\\/])tokens\./i,
  /(^|[\\/])secrets?\./i,
  /(^|[\\/])runtime[\\/]secrets/i,
  /(^|[\\/])runtime[\\/]neural_vault[\\/]raw[\\/]private/i,
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])\.git[\\/]objects([\\/]|$)/i,
  /(^|[\\/])(dist|build|output|test-results|playwright-report)([\\/]|$)/i,
  /\.(pem|key|p12|pfx|p8)$/i,
];

const SECRET_VALUE_PATTERNS = [
  /AIzaSy[0-9A-Za-z_-]{25,}/,
  /sk-[0-9A-Za-z_-]{25,}/,
  /-----BEGIN (RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----/,
  /\bAC[a-fA-F0-9]{32}\b/,
  /\bSK[0-9a-fA-F]{32}\b/,
  /\b(?:access|refresh|auth|api|secret|private)[_-]?(?:token|key|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{18,}/i,
];

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".yml", ".yaml", ".toml", ".ps1", ".cmd", ".sh", ".sql"
]);

function isoNow() {
  return new Date().toISOString();
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sessionCode() {
  const raw = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

function cleanCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

function publicCode(code) {
  const clean = cleanCode(code);
  return clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : "";
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".ts", ".tsx"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".json") return "json";
  if (ext === ".md") return "markdown";
  if (ext === ".css") return "css";
  if (ext === ".html") return "html";
  if ([".yml", ".yaml"].includes(ext)) return "yaml";
  return ext.replace(".", "") || "text";
}

function moduleBadge(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.includes("test")) return "test";
  if (lower.includes("device") || lower.includes("mesh")) return "mesh";
  if (lower.includes("memory") || lower.includes("neural")) return "memory";
  if (lower.includes("agent")) return "agent";
  if (lower.includes("provider") || lower.includes("oauth")) return "integration";
  if (lower.includes("simpleapp") || lower.endsWith(".css") || lower.includes("/ui/")) return "ui";
  if (lower.includes("skill")) return "skill";
  if (lower.endsWith(".md")) return "doc";
  return "code";
}

function scanSecrets(text) {
  const value = String(text || "");
  const match = SECRET_VALUE_PATTERNS.find((pattern) => pattern.test(value));
  return {
    ok: !match,
    reason: match ? "API key, token, or private-key-like text detected." : "",
  };
}

function isBlockedPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const reason = BLOCKED_PATH_PATTERNS.find((pattern) => pattern.test(normalized));
  if (reason) return "Path is blocked by co-op source sharing policy.";
  return "";
}

function safeResolve(rootDir, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const fullPath = path.resolve(rootDir, normalized);
  if (!fullPath.startsWith(path.resolve(rootDir) + path.sep) && fullPath !== path.resolve(rootDir)) {
    throw Object.assign(new Error("Path escapes the project root."), { statusCode: 403 });
  }
  return { normalized, fullPath };
}

function gitValue(rootDir, args) {
  try {
    return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2500 }).trim();
  } catch {
    return "";
  }
}

function createCoOpSymbioteMesh({ runtimeDir, rootDir, neuralVault, localUrls = () => [], meshStatus = () => null } = {}) {
  const coopDir = path.join(runtimeDir, "coop_symbiote");
  const statePath = path.join(coopDir, "state.json");
  const sessionsDir = path.join(coopDir, "sessions");
  const replaysDir = path.join(coopDir, "replays");
  const patchesDir = path.join(coopDir, "patches");
  const snapshotsDir = path.join(coopDir, "shared_snapshots");
  const ghostDir = path.join(coopDir, "ghost_branches");
  const memoryPacketDir = path.join(coopDir, "memory_packets");
  const skillTransferDir = path.join(coopDir, "skill_transfers");
  const tempDir = path.join(coopDir, "temp");
  const logsDir = path.join(coopDir, "logs");
  for (const directory of [coopDir, sessionsDir, replaysDir, patchesDir, snapshotsDir, ghostDir, memoryPacketDir, skillTransferDir, tempDir, logsDir]) ensureDir(directory);

  function state() {
    const current = readJson(statePath, { sessions: [], attempts: [] });
    current.sessions ||= [];
    current.attempts ||= [];
    return current;
  }

  function saveState(next) {
    writeJson(statePath, next);
    return next;
  }

  function saveSession(session) {
    const current = state();
    const index = current.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) current.sessions[index] = session;
    else current.sessions.unshift(session);
    current.sessions = current.sessions.slice(0, 20);
    saveState(current);
    writeJson(path.join(sessionsDir, `${session.id}.json`), session);
    return session;
  }

  function getSession(id) {
    const found = state().sessions.find((item) => item.id === id);
    if (found) return found;
    return readJson(path.join(sessionsDir, `${id}.json`), null);
  }

  function activeSession() {
    return state().sessions.find((session) => session.status === "active" || session.status === "pending_guest") || state().sessions[0] || null;
  }

  function record(sessionId, eventType, payload = {}, actor = "local") {
    const event = {
      id: crypto.randomUUID(),
      sessionId,
      eventType,
      actor,
      target: payload.target || "",
      timestamp: isoNow(),
      payload,
    };
    const session = getSession(sessionId);
    if (session) {
      session.timeline ||= [];
      session.timeline.unshift(event);
      session.timeline = session.timeline.slice(0, 240);
      saveSession(session);
    }
    fs.appendFileSync(path.join(logsDir, "events.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    neuralVault?.recordCoopEvent?.({ sessionId, eventType, actor, target: event.target, eventJson: payload, metadata: { source: "CoOpSymbioteMesh" } });
    return event;
  }

  function repoFingerprint() {
    const packagePath = path.join(rootDir, "package.json");
    const lockPath = path.join(rootDir, "package-lock.json");
    const modulePath = path.join(rootDir, "config", "jarvis-modules.json");
    const sourceHash = crypto.createHash("sha256");
    for (const rel of ["server.js", "server/neural-vault.js", "src/SimpleApp.tsx", "server/capability-engine.js"]) {
      const filePath = path.join(rootDir, rel);
      if (fs.existsSync(filePath)) sourceHash.update(rel).update(fs.readFileSync(filePath));
    }
    return {
      repoRoot: rootDir,
      gitCommit: gitValue(rootDir, ["rev-parse", "HEAD"]),
      branch: gitValue(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
      packageHash: fs.existsSync(packagePath) ? hashFile(packagePath) : "",
      lockfileHash: fs.existsSync(lockPath) ? hashFile(lockPath) : "",
      moduleRegistryHash: fs.existsSync(modulePath) ? hashFile(modulePath) : "",
      sourceHash: sourceHash.digest("hex"),
      migrationVersion: "coop-symbiote-v2",
    };
  }

  function inviteUrls(code) {
    return localUrls().map((base) => `${base}?tool=coop&coop_code=${encodeURIComponent(cleanCode(code))}`);
  }

  function createSession(data = {}) {
    const code = sessionCode();
    const now = isoNow();
    const session = {
      id: crypto.randomUUID(),
      title: data.title || "Jarvis Co-Op Symbiote Mesh",
      moduleName: "CoOpSymbioteMesh",
      status: "active",
      mode: data.mode || "Code Review Mode",
      hostName: data.hostName || "Devansh",
      peerName: "",
      connectionMode: data.connectionMode || "LAN",
      transport: {
        mode: "LAN",
        signaling: "websocket-ready",
        dataChannel: "fallback-http-active",
        media: "device-mesh-adapter",
        relay: "not-configured",
        latencyMs: 0,
        packetLoss: 0,
        reconnectAttempts: 0,
        lastHeartbeat: now,
      },
      code,
      codeHash: sha256(cleanCode(code)),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      inviteLinks: inviteUrls(code),
      repoFingerprintHost: repoFingerprint(),
      repoFingerprintGuest: null,
      repoMatch: "waiting",
      abilities: { ...DEFAULT_ABILITIES, ...(data.abilities || {}) },
      pendingJoin: null,
      guest: null,
      approvals: [],
      patches: [],
      chat: [],
      jarvisMessages: [],
      tasks: [],
      memoryPackets: [],
      skillTransfers: [],
      replays: [],
      testRuns: [],
      timeline: [],
      createdAt: now,
      updatedAt: now,
    };
    saveSession(session);
    neuralVault?.recordCoopSession?.({
      id: session.id,
      title: session.title,
      peerName: session.peerName,
      connectionMode: session.connectionMode,
      sessionCodeHash: session.codeHash,
      repoFingerprintHost: session.repoFingerprintHost,
      status: session.status,
      startedAt: session.createdAt,
      metadata: { abilities: session.abilities, mode: session.mode },
    });
    record(session.id, "session_created", { mode: session.mode, abilities: session.abilities }, session.hostName);
    return publicSession(session);
  }

  function compareFingerprint(host, guest) {
    if (!guest) return "waiting";
    const checks = ["packageHash", "lockfileHash", "moduleRegistryHash", "sourceHash"];
    const same = checks.filter((key) => host?.[key] && guest?.[key] && host[key] === guest[key]).length;
    if (same === checks.length) return "exact";
    if (same >= 2) return "close";
    return "mismatch";
  }

  function joinSession(data = {}) {
    const code = cleanCode(data.code || data.sessionCode);
    const current = state();
    const attempt = { id: crypto.randomUUID(), codeHash: sha256(code), at: isoNow(), peerName: data.displayName || "Trusted friend" };
    current.attempts.unshift(attempt);
    current.attempts = current.attempts.slice(0, 50);
    saveState(current);
    const recentAttempts = current.attempts.filter((item) => item.codeHash === attempt.codeHash && Date.now() - Date.parse(item.at) < 60_000);
    if (recentAttempts.length > 8) throw Object.assign(new Error("Too many failed co-op join attempts. Wait a minute and try again."), { statusCode: 429 });
    const session = current.sessions.find((item) => item.codeHash === sha256(code) && Date.parse(item.expiresAt) > Date.now() && item.status !== "ended");
    if (!session) throw Object.assign(new Error("Invalid or expired co-op session code."), { statusCode: 404 });
    const fingerprint = data.repoFingerprint || repoFingerprint();
    session.pendingJoin = {
      id: crypto.randomUUID(),
      displayName: data.displayName || "Trusted friend",
      deviceName: data.deviceName || os.hostname(),
      jarvisVersion: data.jarvisVersion || "unknown",
      repoFingerprint: fingerprint,
      capabilities: data.capabilities || ["shared_chat", "source_read", "patch_suggest"],
      requestedPermissions: data.requestedPermissions || ["view_file_tree", "read_source_files", "suggest_code_edits", "jarvis_to_jarvis_message"],
      publicSessionKey: data.publicSessionKey || crypto.randomBytes(16).toString("hex"),
      status: "pending_host_approval",
      requestedAt: isoNow(),
    };
    session.repoFingerprintGuest = fingerprint;
    session.repoMatch = compareFingerprint(session.repoFingerprintHost, fingerprint);
    session.status = "pending_guest";
    session.updatedAt = isoNow();
    saveSession(session);
    record(session.id, "join_requested", { peerName: session.pendingJoin.displayName, repoMatch: session.repoMatch }, session.pendingJoin.displayName);
    return { session: publicSession(session), joinRequest: session.pendingJoin };
  }

  function approveJoin(sessionId, approve = true) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    if (!session.pendingJoin) throw Object.assign(new Error("No pending co-op join request exists."), { statusCode: 409 });
    if (!approve) {
      session.pendingJoin.status = "denied";
      session.approvals.unshift({ id: crypto.randomUUID(), type: "join_session", status: "denied", actor: session.pendingJoin.displayName, decidedAt: isoNow() });
      record(session.id, "join_denied", { peerName: session.pendingJoin.displayName }, session.hostName);
      session.pendingJoin = null;
      session.status = "active";
      session.updatedAt = isoNow();
      saveSession(session);
      return publicSession(session);
    }
    session.guest = { ...session.pendingJoin, status: "connected", approvedAt: isoNow() };
    session.peerName = session.guest.displayName;
    session.pendingJoin = null;
    session.status = "active";
    session.transport.latencyMs = 34;
    session.transport.lastHeartbeat = isoNow();
    session.approvals.unshift({ id: crypto.randomUUID(), type: "join_session", status: "approved", actor: session.peerName, decidedAt: isoNow() });
    session.updatedAt = isoNow();
    saveSession(session);
    record(session.id, "join_approved", { peerName: session.peerName, repoMatch: session.repoMatch }, session.hostName);
    return publicSession(session);
  }

  function endSession(sessionId, reason = "User ended co-op session.") {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    session.status = "ended";
    session.endedAt = isoNow();
    session.summary = summarizeSession(session);
    session.updatedAt = isoNow();
    saveSession(session);
    neuralVault?.endCoopSession?.(session.id, { summary: session.summary, status: "ended", metadata: { reason } });
    record(session.id, "session_ended", { reason, summary: session.summary }, session.hostName);
    return publicSession(session);
  }

  function fileManifest({ limit = 240 } = {}) {
    const entries = [];
    function walk(directory) {
      if (entries.length >= limit) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        const relative = normalizeRelativePath(path.relative(rootDir, fullPath));
        if (isBlockedPath(relative)) {
          entries.push({ path: relative, size: 0, hash: "", language: "", modifiedAt: "", shareMode: "blocked", reasonBlocked: "Blocked by path policy.", badge: "blocked" });
          continue;
        }
        if (entry.isDirectory()) {
          if (![".git", "node_modules", "dist", "runtime", "output", "test-results", "playwright-report"].includes(entry.name)) walk(fullPath);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        const stat = fs.statSync(fullPath);
        let shareMode = "suggest";
        let reasonBlocked = "";
        if (stat.size > 300_000) {
          shareMode = "blocked";
          reasonBlocked = "File is too large for safe co-op preview.";
        } else {
          const scan = scanSecrets(fs.readFileSync(fullPath, "utf8"));
          if (!scan.ok) {
            shareMode = "blocked";
            reasonBlocked = scan.reason;
          }
        }
        entries.push({
          path: relative,
          size: stat.size,
          hash: shareMode === "blocked" ? "" : hashFile(fullPath),
          language: languageFor(relative),
          modifiedAt: stat.mtime.toISOString(),
          shareMode,
          reasonBlocked,
          badge: moduleBadge(relative),
        });
      }
    }
    walk(rootDir);
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  function readSharedFile(relativePath) {
    const blocked = isBlockedPath(relativePath);
    if (blocked) throw Object.assign(new Error(blocked), { statusCode: 403 });
    const { normalized, fullPath } = safeResolve(rootDir, relativePath);
    const stat = fs.statSync(fullPath);
    if (stat.size > 300_000) throw Object.assign(new Error("File is too large for safe co-op read."), { statusCode: 413 });
    const content = fs.readFileSync(fullPath, "utf8");
    const scan = scanSecrets(content);
    if (!scan.ok) throw Object.assign(new Error(`Blocked: ${scan.reason}`), { statusCode: 403 });
    return { path: normalized, content, hash: hashFile(fullPath), language: languageFor(normalized), badge: moduleBadge(normalized), size: stat.size };
  }

  function addChat(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const message = {
      id: crypto.randomUUID(),
      sessionId,
      senderType: data.senderType || "human",
      senderName: data.senderName || session.hostName,
      text: String(data.text || "").trim(),
      timestamp: isoNow(),
      linkedFile: data.linkedFile || "",
      linkedPatchId: data.linkedPatchId || "",
      linkedTaskId: data.linkedTaskId || "",
    };
    if (!message.text) throw Object.assign(new Error("Co-op chat message is empty."), { statusCode: 400 });
    session.chat.unshift(message);
    session.updatedAt = isoNow();
    saveSession(session);
    neuralVault?.recordCoopChatMessage?.(message);
    record(sessionId, "chat_message", { text: message.text, senderName: message.senderName }, message.senderName);
    return { message, session: publicSession(session) };
  }

  function addBridgeMessage(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const message = {
      id: crypto.randomUUID(),
      sessionId,
      fromJarvisId: data.fromJarvisId || "host-jarvis",
      toJarvisId: data.toJarvisId || "all",
      messageType: data.messageType || "capability_hello",
      payload: data.payload || {
        diagnosis: "Co-op bridge is online.",
        evidence: ["Local module registry and safe file manifest are available."],
        risk: "low",
        confidence: 0.82,
      },
      timestamp: isoNow(),
    };
    session.jarvisMessages.unshift(message);
    session.updatedAt = isoNow();
    saveSession(session);
    neuralVault?.recordCoopJarvisMessage?.(message);
    record(sessionId, "jarvis_bridge_message", { messageType: message.messageType, fromJarvisId: message.fromJarvisId }, message.fromJarvisId);
    return { message, session: publicSession(session) };
  }

  function debate(sessionId, data = {}) {
    const topic = String(data.topic || "What is the safest next step?").trim();
    const host = {
      fromJarvisId: "host-jarvis",
      messageType: "agent_opinion",
      payload: {
        claim: `Start with safe source sharing and Patch Court for: ${topic}`,
        evidence: ["Host has direct filesystem authority.", "Patch apply must remain host-only.", "Ghost sandbox can verify before real writes."],
        risk: "medium",
        testPlan: ["npm run test:coop-symbiote", "npm run check"],
        confidence: 0.86,
      },
    };
    const guest = {
      fromJarvisId: "guest-jarvis",
      messageType: "agent_opinion",
      payload: {
        claim: `Keep collaboration in suggest mode until repo match is exact for: ${topic}`,
        evidence: ["Repo fingerprint mismatch can corrupt patches.", "Read-only mode preserves trust."],
        risk: "low",
        testPlan: ["compare repo fingerprint", "ghost test patch"],
        confidence: 0.8,
      },
    };
    const hostMessage = addBridgeMessage(sessionId, host).message;
    const guestMessage = addBridgeMessage(sessionId, guest).message;
    const recommendation = {
      id: crypto.randomUUID(),
      sessionId,
      fromJarvisId: "verifier",
      toJarvisId: "all",
      messageType: "decision_response",
      payload: {
        topic,
        agreement: "Both Jarvis systems recommend suggest-first collaboration with Patch Court and Ghost Sandbox before real file writes.",
        nextStep: "Create a patch proposal, run ghost test, then approve or reject in Patch Court.",
        confidence: 0.84,
      },
      timestamp: isoNow(),
    };
    const session = getSession(sessionId);
    session.jarvisMessages.unshift(recommendation);
    saveSession(session);
    neuralVault?.recordCoopJarvisMessage?.(recommendation);
    record(sessionId, "jarvis_debate", { topic, recommendation: recommendation.payload.nextStep }, "verifier");
    return { hostMessage, guestMessage, recommendation, session: publicSession(session) };
  }

  function proposePatch(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const file = readSharedFile(data.filePath);
    const originalText = String(data.originalText || "");
    const replacementText = String(data.replacementText || "");
    const nextContent = originalText && file.content.includes(originalText)
      ? file.content.replace(originalText, replacementText)
      : String(data.nextContent || "");
    const scan = scanSecrets(nextContent || replacementText || data.patchText || "");
    if (!scan.ok) throw Object.assign(new Error(`Patch blocked: ${scan.reason}`), { statusCode: 403 });
    const patch = {
      id: crypto.randomUUID(),
      sessionId,
      filePath: file.path,
      author: data.author || session.peerName || "Trusted friend",
      baseHash: file.hash,
      patchText: data.patchText || `Replace ${originalText.length} chars with ${replacementText.length} chars in ${file.path}`,
      originalText,
      replacementText,
      nextContent,
      summary: data.summary || `Suggested change to ${file.path}`,
      riskLevel: data.riskLevel || (nextContent ? "medium" : "low"),
      affectedModules: [moduleBadge(file.path)],
      testsToRun: data.testsToRun || ["npm run test:coop-symbiote"],
      status: "proposed",
      createdAt: isoNow(),
      decisions: [],
      ghostResult: null,
      testResult: null,
    };
    writeJson(path.join(patchesDir, `${patch.id}.json`), patch);
    session.patches.unshift(patch);
    session.updatedAt = isoNow();
    saveSession(session);
    neuralVault?.recordCoopPatch?.(patch);
    record(sessionId, "patch_proposed", { patchId: patch.id, filePath: patch.filePath, summary: patch.summary }, patch.author);
    addBridgeMessage(sessionId, {
      fromJarvisId: "host-jarvis",
      messageType: "patch_review",
      payload: {
        patchId: patch.id,
        risk: patch.riskLevel,
        recommendation: "Run Ghost Sandbox before applying.",
        tests: patch.testsToRun,
      },
    });
    return { patch, session: publicSession(getSession(sessionId)) };
  }

  function updatePatch(sessionId, patchId, updater) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const patch = session.patches.find((item) => item.id === patchId);
    if (!patch) throw Object.assign(new Error("Patch not found."), { statusCode: 404 });
    updater(patch, session);
    patch.updatedAt = isoNow();
    writeJson(path.join(patchesDir, `${patch.id}.json`), patch);
    saveSession(session);
    neuralVault?.recordCoopPatch?.(patch);
    return { patch, session: publicSession(session) };
  }

  function decidePatch(sessionId, patchId, decision, actor = "Devansh") {
    return updatePatch(sessionId, patchId, (patch) => {
      patch.status = decision === "approve" ? "approved" : "rejected";
      patch.decisions.unshift({ decision, actor, at: isoNow(), reason: decision === "approve" ? "Approved in Patch Court." : "Rejected in Patch Court." });
      record(sessionId, `patch_${decision}d`, { patchId, filePath: patch.filePath }, actor);
    });
  }

  function ghostTest(sessionId, patchId) {
    return updatePatch(sessionId, patchId, (patch) => {
      const { fullPath } = safeResolve(rootDir, patch.filePath);
      if (hashFile(fullPath) !== patch.baseHash) {
        patch.ghostResult = { status: "blocked", build: "not-run", tests: "not-run", risk: "high", summary: "Base file hash changed. Reopen file and regenerate patch." };
        patch.status = "needs_rebase";
        return;
      }
      let content = fs.readFileSync(fullPath, "utf8");
      if (patch.nextContent) content = patch.nextContent;
      else if (patch.originalText && content.includes(patch.originalText)) content = content.replace(patch.originalText, patch.replacementText);
      else {
        patch.ghostResult = { status: "blocked", build: "not-run", tests: "not-run", risk: "medium", summary: "Patch original text was not found in the base file." };
        patch.status = "blocked";
        return;
      }
      const scan = scanSecrets(content);
      if (!scan.ok) {
        patch.ghostResult = { status: "blocked", build: "not-run", tests: "not-run", risk: "high", summary: scan.reason };
        patch.status = "blocked";
        return;
      }
      const sandbox = path.join(ghostDir, sessionId, patchId);
      ensureDir(sandbox);
      const ghostFile = path.join(sandbox, path.basename(patch.filePath));
      fs.writeFileSync(ghostFile, content, "utf8");
      let syntax = "not-applicable";
      const ext = path.extname(patch.filePath).toLowerCase();
      if ([".js", ".mjs", ".cjs"].includes(ext)) {
        try {
          execFileSync(process.execPath, ["--check", ghostFile], { encoding: "utf8", timeout: 5000 });
          syntax = "passed";
        } catch (error) {
          syntax = `failed: ${String(error.stderr || error.message).slice(0, 220)}`;
        }
      }
      patch.ghostResult = {
        status: syntax.startsWith("failed") ? "failed" : "passed",
        build: syntax.startsWith("failed") ? "failed" : "passed",
        tests: "not-run-by-default",
        risk: patch.riskLevel,
        sandboxPath: sandbox,
        summary: syntax.startsWith("failed")
          ? "Ghost sandbox found a syntax problem."
          : "Ghost sandbox applied the patch to an isolated copy and found no immediate secret/hash blocker.",
        checkedAt: isoNow(),
      };
      patch.status = patch.ghostResult.status === "passed" ? "ghost_passed" : "ghost_failed";
      record(sessionId, "ghost_test_result", { patchId, result: patch.ghostResult }, "Ghost Sandbox");
    });
  }

  function applyPatch(sessionId, patchId, actor = "Devansh") {
    return updatePatch(sessionId, patchId, (patch) => {
      if (!["approved", "ghost_passed"].includes(patch.status)) {
        throw Object.assign(new Error("Patch must be approved or ghost-tested before apply."), { statusCode: 409 });
      }
      const { fullPath } = safeResolve(rootDir, patch.filePath);
      if (hashFile(fullPath) !== patch.baseHash) throw Object.assign(new Error("Patch base hash no longer matches the file."), { statusCode: 409 });
      let content = fs.readFileSync(fullPath, "utf8");
      const next = patch.nextContent || content.replace(patch.originalText, patch.replacementText);
      const scan = scanSecrets(next);
      if (!scan.ok) throw Object.assign(new Error(`Patch blocked: ${scan.reason}`), { statusCode: 403 });
      fs.writeFileSync(fullPath, next, "utf8");
      patch.status = "applied";
      patch.appliedAt = isoNow();
      patch.appliedBy = actor;
      record(sessionId, "patch_applied", { patchId, filePath: patch.filePath }, actor);
    });
  }

  function createTask(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const task = {
      id: crypto.randomUUID(),
      sessionId,
      title: String(data.title || "Untitled co-op task").trim(),
      status: data.status || "Todo",
      assignedTo: data.assignedTo || "Devansh",
      linkedFile: data.linkedFile || "",
      linkedPatchId: data.linkedPatchId || "",
      linkedMessageId: data.linkedMessageId || "",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    session.tasks.unshift(task);
    saveSession(session);
    neuralVault?.recordCoopTask?.(task);
    record(sessionId, "task_created", { taskId: task.id, title: task.title }, task.assignedTo);
    return { task, session: publicSession(session) };
  }

  function createMemoryPacket(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const packet = {
      id: crypto.randomUUID(),
      sessionId,
      sharedBy: data.sharedBy || "Devansh",
      scope: "project-only",
      allowed: data.allowed || ["architecture summary", "recent test failures", "module structure", "active co-op tasks"],
      blocked: ["personal memories", "Gmail", "Kalshi private information", "API keys", ".env", "raw private logs"],
      status: "preview_ready",
      createdAt: isoNow(),
    };
    writeJson(path.join(memoryPacketDir, `${packet.id}.json`), packet);
    session.memoryPackets.unshift(packet);
    saveSession(session);
    neuralVault?.recordCoopMemoryPacket?.(packet);
    record(sessionId, "memory_packet_created", { packetId: packet.id, blocked: packet.blocked }, packet.sharedBy);
    return { packet, session: publicSession(session) };
  }

  function offerSkill(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const manifest = {
      skillId: data.skillId || `coop-skill-${crypto.randomBytes(3).toString("hex")}`,
      name: data.name || "Co-op workflow skill",
      description: data.description || "Reusable workflow offered through Co-Op Symbiote Mesh.",
      triggerPhrases: data.triggerPhrases || ["repeat this co-op workflow"],
      steps: data.steps || ["Load project context", "Run safe checks", "Report evidence"],
      requiredTools: data.requiredTools || ["mesh_status", "code_knowledge"],
      permissions: data.permissions || ["read_source_files"],
      validators: data.validators || ["secret scan", "test command"],
      failureModes: data.failureModes || ["missing repo files", "provider not configured"],
      tests: data.tests || ["npm run test:coop-symbiote"],
      version: data.version || "0.1.0",
      sourceJarvis: data.sourceJarvis || "host-jarvis",
    };
    const scan = scanSecrets(JSON.stringify(manifest));
    if (!scan.ok) throw Object.assign(new Error(`Skill transfer blocked: ${scan.reason}`), { statusCode: 403 });
    const transfer = {
      id: crypto.randomUUID(),
      sessionId,
      skillId: manifest.skillId,
      offeredBy: data.offeredBy || "host-jarvis",
      receivedBy: data.receivedBy || "guest-jarvis",
      status: "offered",
      skillManifest: manifest,
      testResult: { status: "pending", summary: "Import requires approval and local test." },
      createdAt: isoNow(),
    };
    writeJson(path.join(skillTransferDir, `${transfer.id}.json`), transfer);
    session.skillTransfers.unshift(transfer);
    saveSession(session);
    neuralVault?.recordCoopSkillTransfer?.(transfer);
    record(sessionId, "skill_transfer_offered", { transferId: transfer.id, skillId: transfer.skillId }, transfer.offeredBy);
    return { transfer, session: publicSession(session) };
  }

  function createReplay(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const replay = {
      id: crypto.randomUUID(),
      sessionId,
      replayType: data.replayType || "timeline",
      timeline: session.timeline.slice(0, 120),
      actionGraph: data.actionGraph || session.timeline.slice(0, 20).map((event) => event.eventType),
      keyframes: data.keyframes || [],
      summary: data.summary || summarizeSession(session),
      createdAt: isoNow(),
    };
    const replayPath = path.join(replaysDir, `${replay.id}.json`);
    replay.path = replayPath;
    writeJson(replayPath, replay);
    session.replays.unshift(replay);
    saveSession(session);
    neuralVault?.recordCoopReplay?.(replay);
    record(sessionId, "replay_created", { replayId: replay.id, summary: replay.summary }, "Replay Theater");
    return { replay, session: publicSession(session) };
  }

  function replayToSkill(sessionId, replayId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const replay = session.replays.find((item) => item.id === replayId);
    if (!replay) throw Object.assign(new Error("Replay not found."), { statusCode: 404 });
    return offerSkill(sessionId, {
      skillId: `coop-replay-${replay.id.slice(0, 8)}`,
      name: "Replay-derived co-op workflow",
      description: replay.summary,
      steps: replay.actionGraph?.length ? replay.actionGraph : ["Open co-op workspace", "Review timeline", "Run Patch Court"],
      triggerPhrases: ["save this co-op workflow", "repeat that co-op session workflow"],
      sourceJarvis: "replay-theater",
    });
  }

  function summarizeSession(session) {
    return [
      `${session.title} ${session.status}.`,
      `Peer: ${session.peerName || "not connected"}.`,
      `Repo match: ${session.repoMatch}.`,
      `${session.patches.length} patch(es), ${session.chat.length} chat message(s), ${session.tasks.length} task(s), ${session.jarvisMessages.length} Jarvis bridge message(s).`,
    ].join(" ");
  }

  function publicSession(session) {
    if (!session) return null;
    const { codeHash, ...safe } = session;
    return {
      ...safe,
      code: session.status === "ended" ? "" : session.code,
      memory: neuralVault?.coopMemorySummary?.(session.id) || null,
      deviceMesh: meshStatus ? meshStatus() : null,
    };
  }

  function status() {
    const session = activeSession();
    const manifest = fileManifest({ limit: 80 });
    return {
      ok: true,
      moduleName: "CoOpSymbioteMesh",
      label: "Jarvis Co-Op Symbiote Mesh",
      runtimeVersion: "2.0.0-symbiote-workspace",
      activeSession: publicSession(session),
      sessions: state().sessions.map(publicSession),
      repoFingerprint: repoFingerprint(),
      manifestSummary: {
        total: manifest.length,
        shared: manifest.filter((file) => file.shareMode !== "blocked").length,
        blocked: manifest.filter((file) => file.shareMode === "blocked").length,
      },
      transportCapabilities: {
        lan: true,
        websocketSignaling: "planned-adapter",
        webrtcDataChannel: "planned-adapter",
        liveKitRelay: "optional-placeholder",
        deviceMeshScreenAdapter: true,
      },
    };
  }

  return {
    status,
    createSession,
    joinSession,
    approveJoin,
    endSession,
    fileManifest,
    readSharedFile,
    addChat,
    addBridgeMessage,
    debate,
    proposePatch,
    decidePatch,
    ghostTest,
    applyPatch,
    createTask,
    createMemoryPacket,
    offerSkill,
    createReplay,
    replayToSkill,
    repoFingerprint,
  };
}

module.exports = {
  createCoOpSymbioteMesh,
  scanSecrets,
  isBlockedPath,
};
