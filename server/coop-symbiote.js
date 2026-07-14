const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { openCoopStore } = require("./coop-store");
const { RATE, makeCodeSalt, mintTurnCredentials, verifyCodeProof, newHostIdentity, keyFingerprint, safetyNumber, issueResumeToken, verifyResumeToken } = require("./coop-transport");
const { mintGuestLease, revokeLease } = require("./coop-leases");
const { applyHunks, ciLite, redTeamReview } = require("./coop-patchcourt");
const { exportSession: buildExport, sessionMetrics: buildMetrics, buildRecap } = require("./coop-intelligence");
const { fuseSkills, applyReputation, pairRunCompare, warRoomBrief } = require("./coop-advanced");

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

  // W0: durable SQLite substrate. Per-session rows (no whole-array rewrite → no lost updates),
  // no 20-session cap, optimistic-concurrency version, DB-backed attempts, events.jsonl rotation.
  // Migrates any legacy state.json + sessions/*.json on first open.
  const store = openCoopStore({
    dbPath: path.join(coopDir, "coop.db"),
    legacyStatePath: statePath,
    legacySessionsDir: sessionsDir,
    eventsPath: path.join(logsDir, "events.jsonl"),
  });

  function saveSession(session) {
    return store.saveSession(session);
  }

  function getSession(id) {
    return store.getSession(id);
  }

  function activeSession() {
    const sessions = store.listSessions().filter((s) => s.status !== "wiped");
    return sessions.find((session) => session.status === "active" || session.status === "pending_guest") || sessions[0] || null;
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
    // Atomic timeline append (skips silently if the session is gone); event still logged.
    store.mutateSession(sessionId, (session) => {
      session.timeline ||= [];
      session.timeline.unshift(event);
      session.timeline = session.timeline.slice(0, 240);
    }, false);
    store.appendEvent(event);
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

  // W2: invite links carry the public/base URLs plus the code salt + host fingerprint so a
  // remote guest can reach the host and (in W3) verify it out-of-band. Recomputed live in
  // publicSession() so links always reflect the current tunnel URL.
  function inviteUrls(code, { salt = "", fp = "" } = {}) {
    const q = (base) => {
      const parts = [`tool=coop`, `coop_code=${encodeURIComponent(cleanCode(code))}`];
      if (salt) parts.push(`coop_salt=${encodeURIComponent(salt)}`);
      if (fp) parts.push(`coop_fp=${encodeURIComponent(fp)}`);
      return `${base}?${parts.join("&")}`;
    };
    return localUrls().map(q);
  }

  function createSession(data = {}) {
    const code = sessionCode();
    const now = isoNow();
    const codeSalt = makeCodeSalt();
    // W3: real X25519 host identity. The private key + resume secret live ONLY server-side
    // (stripped in publicSession); the guest sees only the public key + fingerprint.
    const identity = newHostIdentity();
    const hostFp = identity.fingerprint;
    const session = {
      _secrets: { hostPrivateKey: identity.privateKey, hostSecret: crypto.randomBytes(24).toString("hex") },
      hostPublicKey: identity.publicKey,
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
      codeSalt,
      hostFingerprint: hostFp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      inviteLinks: inviteUrls(code, { salt: codeSalt, fp: hostFp }),
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
    const codeHash = sha256(code);
    // W2: `ip` is the REAL client IP (from clientIp() on the route), never the spoofable body.
    const ip = String(data.ip || "").trim();
    store.recordAttempt({ id: crypto.randomUUID(), codeHash, at: isoNow(), peerName: data.displayName || "Trusted friend", ip });
    // Rate limit across three dimensions so code-spraying (fresh code each try) can't bypass it.
    const attempts = store.countAttempts({ codeHash, ip, windowMs: 60_000 });
    if (attempts.byCode > RATE.perCodePerMin || (ip && attempts.byIp > RATE.perIpPerMin) || attempts.global > RATE.globalPerMin) {
      throw Object.assign(new Error("Too many co-op join attempts. Wait a minute and try again."), { statusCode: 429 });
    }
    const session = store.listSessions().find((item) => item.codeHash === codeHash && Date.parse(item.expiresAt) > Date.now() && item.status !== "ended");
    if (!session) throw Object.assign(new Error("Invalid or expired co-op session code."), { statusCode: 404 });
    // If the guest supplies a code proof (from the invite salt), verify it constant-time.
    if (data.codeProof && !verifyCodeProof(session.codeSalt || "", code, data.codeProof)) {
      throw Object.assign(new Error("Co-op code proof did not verify."), { statusCode: 403 });
    }
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
      // W3: the guest's X25519 static public key (real handshake in W4) → fingerprint for the
      // safety number. Falls back to a fingerprint over publicSessionKey when not supplied.
      guestPublicKey: data.guestPublicKey || "",
      guestFingerprint: keyFingerprint(data.guestPublicKey || data.publicSessionKey || crypto.randomBytes(8).toString("hex")),
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
    // W3: approval MINTS the guest's capability lease (scoped, non-side-effecting, non-delegable),
    // the safety number (both fingerprints), and a resume token for reconnect-without-re-approval.
    const gfp = session.guest.guestFingerprint;
    session.guest.lease = mintGuestLease(session.id);
    session.guest.safetyNumber = safetyNumber(session.hostFingerprint, gfp);
    session.guest.resumeToken = issueResumeToken({ secret: session._secrets.hostSecret, sessionId: session.id, guestFp: gfp });
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
    // W3: ending the session REVOKES the guest lease (verify() will now fail) and burns the
    // resume token so a dropped guest can't silently reconnect.
    if (session.guest?.lease) session.guest.lease = revokeLease(session.guest.lease);
    if (session.guest) session.guest.resumeToken = "";
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
    // W7: multi-hunk patches. `hunks:[{originalText,replacementText}]` applies in sequence; single
    // originalText/replacementText/nextContent still works (wrapped as one hunk).
    const hunks = Array.isArray(data.hunks) && data.hunks.length
      ? data.hunks
      : [{ originalText, replacementText, nextContent: data.nextContent }];
    let nextContent;
    if (hunks.some((h) => h.originalText || h.nextContent)) {
      const applied = applyHunks(file.content, hunks);
      if (!applied.ok) throw Object.assign(new Error(`Patch does not apply: ${applied.reason}`), { statusCode: 409 });
      nextContent = applied.content;
    } else {
      nextContent = String(data.nextContent || "");
    }
    const scan = scanSecrets(nextContent || replacementText || data.patchText || "");
    if (!scan.ok) throw Object.assign(new Error(`Patch blocked: ${scan.reason}`), { statusCode: 403 });
    const patch = {
      id: crypto.randomUUID(),
      sessionId,
      filePath: file.path,
      author: data.author || session.peerName || "Trusted friend",
      baseHash: file.hash,
      baseLength: file.content.length,
      patchText: data.patchText || `${hunks.length} hunk(s) in ${file.path}`,
      originalText,
      replacementText,
      hunks,
      nextContent,
      summary: data.summary || `Suggested change to ${file.path}`,
      riskLevel: data.riskLevel || (nextContent ? "medium" : "low"),
      affectedModules: [moduleBadge(file.path)],
      testsToRun: data.testsToRun || ["npm run test:coop-symbiote"],
      status: "proposed",
      createdAt: isoNow(),
      decisions: [],
      ghostResult: null,
      review: null,
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
    const result = updatePatch(sessionId, patchId, (patch) => {
      patch.status = decision === "approve" ? "approved" : "rejected";
      patch.decisions.unshift({ decision, actor, at: isoNow(), reason: decision === "approve" ? "Approved in Patch Court." : "Rejected in Patch Court." });
      record(sessionId, `patch_${decision}d`, { patchId, filePath: patch.filePath }, actor);
    });
    try { recordReputation(sessionId, decision === "approve" ? "patch_approved" : "patch_rejected"); } catch { /* reputation is best-effort */ }
    return result;
  }

  function ghostTest(sessionId, patchId) {
    return updatePatch(sessionId, patchId, (patch) => {
      const { fullPath } = safeResolve(rootDir, patch.filePath);
      if (hashFile(fullPath) !== patch.baseHash) {
        patch.ghostResult = { status: "blocked", build: "not-run", tests: "not-run", risk: "high", summary: "Base file hash changed. Reopen file and regenerate patch." };
        patch.status = "needs_rebase";
        return;
      }
      const base = fs.readFileSync(fullPath, "utf8");
      // Build the patched content from hunks (W7) or legacy single-hunk fields.
      let content;
      if (Array.isArray(patch.hunks) && patch.hunks.some((h) => h.originalText || h.nextContent)) {
        const applied = applyHunks(base, patch.hunks);
        if (!applied.ok) { patch.ghostResult = { status: "blocked", risk: "medium", summary: applied.reason }; patch.status = "blocked"; return; }
        content = applied.content;
      } else if (patch.nextContent) content = patch.nextContent;
      else if (patch.originalText && base.includes(patch.originalText)) content = base.replace(patch.originalText, patch.replacementText);
      else { patch.ghostResult = { status: "blocked", risk: "medium", summary: "Patch original text was not found in the base file." }; patch.status = "blocked"; return; }

      // Real CI-lite (isolated git worktree: syntax + risky scan) + deterministic adversarial review.
      const secret = scanSecrets(content);
      const sandbox = path.join(ghostDir, sessionId, patchId);
      ensureDir(sandbox);
      const ciResult = ciLite({ rootDir, relPath: patch.filePath, content, sandboxDir: sandbox });
      const review = redTeamReview({ patch, content, hasSecret: !secret.ok, ciResult });
      patch.ciResult = ciResult;
      patch.review = review;
      patch.ghostResult = {
        status: (secret.ok && ciResult.status === "passed") ? "passed" : "failed",
        build: ciResult.status,
        tests: "syntax + red-team (CI-lite in git worktree)",
        risk: review.verdict === "block" ? "high" : review.verdict === "warn" ? "medium" : "low",
        checks: ciResult.checks,
        verdict: review.verdict,
        objections: review.objections,
        sandboxPath: sandbox,
        summary: !secret.ok ? "Secret-like content blocked."
          : ciResult.status === "failed" ? "CI-lite found a syntax problem."
          : review.verdict === "block" ? "Adversarial review BLOCKED the patch."
          : review.objections.length ? `Passed CI-lite with ${review.objections.length} review objection(s).`
          : "Passed CI-lite + adversarial review cleanly.",
        checkedAt: isoNow(),
      };
      patch.status = patch.ghostResult.status === "passed" ? "ghost_passed" : "ghost_failed";
      record(sessionId, "ghost_test_result", { patchId, result: patch.ghostResult, verdict: review.verdict }, "Patch Court");
    });
  }

  function applyPatch(sessionId, patchId, actor = "Devansh") {
    const applyResult = updatePatch(sessionId, patchId, (patch) => {
      if (!["approved", "ghost_passed"].includes(patch.status)) {
        throw Object.assign(new Error("Patch must be approved or ghost-tested before apply."), { statusCode: 409 });
      }
      // W7: a patch the adversarial review BLOCKED cannot be applied to the host's disk.
      if (patch.review?.verdict === "block") {
        throw Object.assign(new Error("Adversarial review blocked this patch — resolve the objections before applying."), { statusCode: 409 });
      }
      const { fullPath } = safeResolve(rootDir, patch.filePath);
      if (hashFile(fullPath) !== patch.baseHash) throw Object.assign(new Error("Patch base hash no longer matches the file."), { statusCode: 409 });
      const base = fs.readFileSync(fullPath, "utf8");
      let next;
      if (Array.isArray(patch.hunks) && patch.hunks.some((h) => h.originalText || h.nextContent)) {
        const applied = applyHunks(base, patch.hunks);
        if (!applied.ok) throw Object.assign(new Error(`Patch does not apply: ${applied.reason}`), { statusCode: 409 });
        next = applied.content;
      } else {
        next = patch.nextContent || base.replace(patch.originalText, patch.replacementText);
      }
      const scan = scanSecrets(next);
      if (!scan.ok) throw Object.assign(new Error(`Patch blocked: ${scan.reason}`), { statusCode: 403 });
      fs.writeFileSync(fullPath, next, "utf8");
      patch.status = "applied";
      patch.appliedAt = isoNow();
      patch.appliedBy = actor;
      record(sessionId, "patch_applied", { patchId, filePath: patch.filePath }, actor);
    });
    try { recordReputation(sessionId, "patch_applied"); } catch { /* reputation is best-effort */ }
    return applyResult;
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
    // W3: strip server-only secrets (host private key + resume HMAC secret) — never sent to any client.
    const { codeHash, _secrets, ...safe } = session;
    const ended = session.status === "ended";
    return {
      ...safe,
      code: ended ? "" : session.code,
      // Recompute invites live so they always carry the current tunnel URL (W2).
      inviteLinks: ended ? [] : inviteUrls(session.code, { salt: session.codeSalt, fp: session.hostFingerprint }),
      memory: neuralVault?.coopMemorySummary?.(session.id) || null,
      deviceMesh: meshStatus ? meshStatus() : null,
    };
  }

  // W2: mint ephemeral TURN credentials for an active session (real relay config is W4; the
  // credential shape is already correct so W4 only swaps in the TURN server URLs/secret).
  function turnCredentials(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    if (session.status === "ended") throw Object.assign(new Error("Co-op session has ended."), { statusCode: 409 });
    return { sessionId, ...mintTurnCredentials({ sessionId }) };
  }

  // W4/W5: resolve a code → minimal live-session descriptor for the WS signaling room. NOTE: unlike
  // join (which enforces the 10-min code window to bound the invite), the CHANNEL auth only requires
  // a non-ended session — otherwise a live collaboration would lose its relay after 10 minutes.
  function resolveCode(code) {
    const codeHash = sha256(cleanCode(code));
    const session = store.listSessions().find((s) => s.codeHash === codeHash && s.status !== "ended" && s.status !== "wiped");
    return session ? { id: session.id, status: session.status } : null;
  }

  // W3 (§2.5): a dropped guest reconnects with the host-signed resume token — re-establishing the
  // channel WITHOUT a second human approval, within the token window. Rejected if session ended.
  function resumeSession(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    if (session.status !== "active" || !session.guest) throw Object.assign(new Error("No active co-op session to resume."), { statusCode: 409 });
    const check = verifyResumeToken(data.resumeToken, { secret: session._secrets?.hostSecret || "", sessionId, guestFp: session.guest.guestFingerprint });
    if (!check.ok) throw Object.assign(new Error(`Resume rejected: ${check.reason}.`), { statusCode: 401 });
    session.transport.lastHeartbeat = isoNow();
    session.updatedAt = isoNow();
    saveSession(session);
    record(sessionId, "guest_resumed", { peerName: session.guest.displayName }, "resume");
    return { session: publicSession(session) };
  }

  // ---- W8: required-features hardening + Session Intelligence ----

  // Rotate the invite code (invalidates the old one) — invite management / revoke a leaked code.
  function regenerateCode(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    if (session.status === "ended") throw Object.assign(new Error("Co-op session has ended."), { statusCode: 409 });
    const code = sessionCode();
    session.code = code;
    session.codeHash = sha256(cleanCode(code));
    session.codeSalt = makeCodeSalt();
    session.expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    session.updatedAt = isoNow();
    saveSession(session);
    record(sessionId, "code_rotated", {}, session.hostName);
    return publicSession(session);
  }

  // Moderation: eject the guest, revoke their lease + resume token, return to hosting.
  function kickGuest(sessionId, reason = "Removed by host.") {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    if (session.guest?.lease) session.guest.lease = revokeLease(session.guest.lease);
    const peer = session.guest?.displayName || session.pendingJoin?.displayName || "guest";
    session.guest = null;
    session.pendingJoin = null;
    session.peerName = "";
    session.status = "active";
    session.repoMatch = "waiting";
    session.updatedAt = isoNow();
    saveSession(session);
    record(sessionId, "guest_kicked", { peerName: peer, reason }, session.hostName);
    return publicSession(session);
  }

  // Update the ability envelope (roles/permissions / granular toggles).
  function setAbilities(sessionId, abilities = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const allowed = Object.keys(DEFAULT_ABILITIES);
    for (const [k, v] of Object.entries(abilities)) if (allowed.includes(k)) session.abilities[k] = !!v;
    session.updatedAt = isoNow();
    saveSession(session);
    record(sessionId, "abilities_updated", { abilities: session.abilities }, session.hostName);
    return publicSession(session);
  }

  // Data retention: SOFT-delete (no hard delete) — clears content, keeps a tombstone + audit.
  function wipeSession(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const metrics = buildMetrics(session);
    session.status = "wiped";
    session.wipedAt = isoNow();
    session.chat = []; session.patches = []; session.jarvisMessages = []; session.tasks = [];
    session.memoryPackets = []; session.skillTransfers = []; session.replays = [];
    session.timeline = (session.timeline || []).slice(0, 1); // keep the tombstone event only
    session.guest = null; session.pendingJoin = null;
    session._secrets = undefined;
    session.summary = `Session wiped (retention). Pre-wipe: ${metrics.messages} msgs, ${metrics.patchesApplied}/${metrics.patches} patches applied.`;
    session.updatedAt = isoNow();
    saveSession(session);
    record(sessionId, "session_wiped", { metrics }, session.hostName);
    return publicSession(session);
  }

  function exportSession(sessionId, format = "json") {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    return buildExport(session, format);
  }

  function sessionMetrics(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    return buildMetrics(session);
  }

  function recap(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    return buildRecap(session);
  }

  // ---- W9: advanced differentiators ----

  // Cross-user skill fusion: merge two offered skills into a superset with dual provenance.
  function skillFusion(sessionId, { skillIdA, skillIdB, name } = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    const find = (id) => (session.skillTransfers || []).find((t) => t.id === id || t.skillId === id)?.skillManifest;
    const a = find(skillIdA), b = find(skillIdB);
    if (!a || !b) throw Object.assign(new Error("Both skills must exist in this session to fuse."), { statusCode: 404 });
    const fused = fuseSkills(a, b, { name });
    const scan = scanSecrets(JSON.stringify(fused));
    if (!scan.ok) throw Object.assign(new Error(`Skill fusion blocked: ${scan.reason}`), { statusCode: 403 });
    return offerSkill(sessionId, { ...fused, offeredBy: "skill-fusion" });
  }

  // Per-peer reputation (keyed by the guest fingerprint), updated on accept/reject events.
  function recordReputation(sessionId, event) {
    const session = getSession(sessionId);
    if (!session?.guest?.guestFingerprint) return null;
    session.reputation ||= {};
    const fp = session.guest.guestFingerprint;
    session.reputation[fp] = applyReputation(session.reputation[fp], event);
    session.updatedAt = isoNow();
    saveSession(session);
    return session.reputation[fp];
  }
  function getReputation(sessionId) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    return session.reputation || {};
  }

  // Session templates: save/list/apply a {mode, abilities} preset (roster of reusable setups).
  const templatesPath = path.join(coopDir, "templates.json");
  function listTemplates() { return readJson(templatesPath, []); }
  function saveTemplate({ name, mode, abilities } = {}) {
    const templates = listTemplates();
    const tpl = { id: crypto.randomUUID(), name: name || "Untitled preset", mode: mode || "Code Review Mode", abilities: abilities || {}, createdAt: isoNow() };
    templates.unshift(tpl);
    writeJson(templatesPath, templates.slice(0, 50));
    return tpl;
  }
  function applyTemplate(sessionId, templateId) {
    const tpl = listTemplates().find((t) => t.id === templateId);
    if (!tpl) throw Object.assign(new Error("Template not found."), { statusCode: 404 });
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    session.mode = tpl.mode;
    session.abilities = { ...DEFAULT_ABILITIES, ...(tpl.abilities || {}) };
    session.updatedAt = isoNow();
    saveSession(session);
    record(sessionId, "template_applied", { templateId, name: tpl.name }, session.hostName);
    return publicSession(session);
  }

  // Ghost pair-run: race two candidate patches to the same file in isolated worktrees.
  function pairRun(sessionId, { filePath, candidateA, candidateB } = {}) {
    const file = readSharedFile(filePath); // enforces path policy + secret scan on the base
    const sandbox = path.join(ghostDir, sessionId, `pairrun-${crypto.randomBytes(3).toString("hex")}`);
    ensureDir(sandbox);
    const result = pairRunCompare({ rootDir, relPath: file.path, baseContent: file.content, candidateA: String(candidateA || ""), candidateB: String(candidateB || ""), sandboxDir: sandbox });
    record(sessionId, "ghost_pair_run", { filePath: file.path, winner: result.winner }, "Ghost Pair-Run");
    return result;
  }

  // Kalshi/Quant war-room advisory brief (ANALYSIS ONLY — never places trades).
  function warRoom(sessionId, data = {}) {
    const session = getSession(sessionId);
    if (!session) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
    return warRoomBrief(data);
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
      sessions: store.listSessions(50).map(publicSession),
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
    turnCredentials,
    resumeSession,
    resolveCode,
    regenerateCode,
    kickGuest,
    setAbilities,
    wipeSession,
    exportSession,
    sessionMetrics,
    recap,
    skillFusion,
    getReputation,
    listTemplates,
    saveTemplate,
    applyTemplate,
    pairRun,
    warRoom,
  };
}

module.exports = {
  createCoOpSymbioteMesh,
  scanSecrets,
  isBlockedPath,
};
