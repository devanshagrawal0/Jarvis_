const APP_VERSION = "2026.06.16-spatial-agent-camera";
const ROOM_NAME = "primary-user-room";
const GEMINI_MODEL = "gemini-2.5-flash";

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  USER_ROOM: any;
  GEMINI_API_KEY?: string;
  JARVIS_ACCESS_TOKEN?: string;
  JARVIS_LOCAL_ORIGIN?: string;
  APP_VERSION?: string;
};

type JsonRecord = Record<string, unknown>;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function suppliedAccessToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return new URL(request.url).searchParams.get("access_token") || "";
}

function tokenMatches(expected: string, supplied: string) {
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function authorize(request: Request, env: Env) {
  if (!env.JARVIS_ACCESS_TOKEN) return json({ error: "Cloud access is disabled until JARVIS_ACCESS_TOKEN is configured." }, 503);
  if (!tokenMatches(env.JARVIS_ACCESS_TOKEN, suppliedAccessToken(request))) {
    return json({ error: "A valid JARVIS access token is required." }, 401);
  }
  return null;
}

function now() {
  return new Date().toISOString();
}

async function readJson(request: Request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function roomFetch(env: Env, request: Request) {
  const id = env.USER_ROOM.idFromName(ROOM_NAME);
  return env.USER_ROOM.get(id).fetch(request);
}

async function serveAsset(env: Env, request: Request) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;
  const url = new URL(request.url);
  if (!request.headers.get("accept")?.includes("text/html")) return response;
  return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
}

async function proxyToLocalJarvis(request: Request, origin: string) {
  const base = origin.replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(base)) {
    return json({ error: "JARVIS_LOCAL_ORIGIN must be a trycloudflare HTTPS origin." }, 502);
  }
  const input = new URL(request.url);
  const target = new URL(`${input.pathname}${input.search}`, base);
  const headers = new Headers(request.headers);
  headers.set("x-jarvis-stable-front-door", input.origin);
  headers.set("x-forwarded-host", input.host);
  headers.set("x-forwarded-proto", input.protocol.replace(":", ""));
  headers.delete("host");
  try {
    return await fetch(new Request(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual"
    }));
  } catch (error) {
    return json({
      error: "Laptop JARVIS tunnel is offline.",
      detail: (error as Error).message,
      next: "Start JARVIS on the laptop; the phone link stays the same."
    }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    const url = new URL(request.url);

    if (env.JARVIS_LOCAL_ORIGIN) {
      return proxyToLocalJarvis(request, env.JARVIS_LOCAL_ORIGIN);
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        name: "jarvis-command-ui",
        version: env.APP_VERSION || APP_VERSION,
        environment: "cloudflare-worker",
        deploymentTimestamp: now(),
        durableRoom: "UserRoom",
        publicUrl: url.origin,
        accessProtected: Boolean(env.JARVIS_ACCESS_TOKEN)
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const rejected = authorize(request, env);
      if (rejected) return rejected;
      return roomFetch(env, request);
    }

    return serveAsset(env, request);
  }
};

export class UserRoom {
  state: any;
  env: Env;

  constructor(state: any, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const rejected = authorize(request, this.env);
    if (rejected) return rejected;
    if (request.headers.get("upgrade") === "websocket") return this.handleWebSocket();

    if (url.pathname === "/api/provider-health") {
      return json({ providers: await this.providerHealth(), generatedAt: now() });
    }

    if (url.pathname === "/api/camera/capabilities") {
      return json({
        serverIngestsMedia: false,
        requiresHttps: true,
        localDevelopmentAllowedOnLocalhost: true,
        profiles: [
          { id: "low", label: "Low", width: 640, height: 360, frameRate: 15 },
          { id: "balanced", label: "Balanced", width: 1280, height: 720, frameRate: 24 },
          { id: "high", label: "High", width: 1920, height: 1080, frameRate: 30 }
        ],
        webrtc: {
          signaling: "/api/room/ws",
          stun: "stun:stun.cloudflare.com:3478",
          serverRole: "signals peers only; camera media is peer-to-peer"
        }
      });
    }

    if (url.pathname === "/api/receipts" && request.method === "GET") {
      return json({ receipts: await this.list("receipts") });
    }

    if (url.pathname === "/api/devices" && request.method === "GET") {
      return json({ devices: await this.list("devices"), pairings: await this.publicPairings() });
    }

    if (url.pathname === "/api/devices" && request.method === "POST") {
      const device = await this.upsertDevice({ ...(await readJson(request)), status: "local", approved: true });
      return json({ device }, 201);
    }

    const deviceAction = url.pathname.match(/^\/api\/devices\/([^/]+)\/(approve|revoke)$/);
    if (deviceAction && request.method === "POST") {
      return json({ device: await this.approveDevice(deviceAction[1], deviceAction[2] === "approve") });
    }

    if (url.pathname === "/api/pair" && request.method === "GET") {
      return json({ pairing: await this.createPairing(), publicUrl: url.origin });
    }

    if (url.pathname === "/api/pair" && request.method === "POST") {
      return json(await this.claimPairing(await readJson(request)));
    }

    if ((url.pathname === "/api/agents" || url.pathname === "/api/missions") && request.method === "GET") {
      const missions = await this.list("missions");
      return json(url.pathname === "/api/agents" ? { agents: missions } : { missions });
    }

    if ((url.pathname === "/api/agents" || url.pathname === "/api/missions") && request.method === "POST") {
      const mission = await this.createMission(await readJson(request));
      const missions = await this.list("missions");
      return json(url.pathname === "/api/agents" ? { agent: mission, agents: missions } : { mission, missions }, 201);
    }

    const missionAction = url.pathname.match(/^\/api\/(?:agents|missions)\/([^/]+)\/(pause|resume|cancel|advance|complete)$/);
    if (missionAction && request.method === "POST") {
      const mission = await this.updateMission(missionAction[1], missionAction[2]);
      const missions = await this.list("missions");
      return json(url.pathname.includes("/api/agents/") ? { agent: mission, agents: missions } : { mission, missions });
    }

    if (url.pathname === "/api/emergency-stop" && request.method === "POST") {
      return json(await this.emergencyStop((await readJson(request)).reason || "Emergency stop"));
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return json(await this.chat(await readJson(request)));
    }

    return json({ error: "Unknown API route" }, 404);
  }

  async list(key: string) {
    return (await this.state.storage.get(key)) || [];
  }

  async save(key: string, value: unknown[]) {
    await this.state.storage.put(key, value.slice(0, 120));
    return value;
  }

  async receipt(data: JsonRecord) {
    const receipts = await this.list("receipts");
    const item = {
      id: crypto.randomUUID(),
      action: data.action || "unknown",
      target: data.target || "JARVIS",
      risk: data.risk || "Observe",
      status: data.status || "verified",
      input: data.input || "",
      plan: Array.isArray(data.plan) ? data.plan : [],
      result: data.result || "",
      verification: Array.isArray(data.verification) ? data.verification : [],
      createdAt: now()
    };
    await this.save("receipts", [item, ...receipts]);
    return item;
  }

  async providerHealth() {
    const runtime = (await this.state.storage.get("providerHealth")) || {};
    const geminiRuntime = ((runtime as JsonRecord).gemini || {}) as JsonRecord;
    return {
      gemini: {
        connected: Boolean(this.env.GEMINI_API_KEY),
        source: this.env.GEMINI_API_KEY ? "wrangler-secret" : "missing",
        label: "Gemini Brain",
        model: GEMINI_MODEL,
        ...geminiRuntime
      }
    };
  }

  async createPairing() {
    const pairings = await this.list("pairings");
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const pairing = {
      id: crypto.randomUUID(),
      code,
      status: "waiting",
      createdAt: now(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    };
    await this.save("pairings", [pairing, ...pairings]);
    await this.receipt({
      action: "device.pair_code",
      target: "Device Mesh",
      risk: "Observe",
      result: "Short-lived pairing code created.",
      verification: ["Code expires in five minutes", "No credential exposed"]
    });
    return pairing;
  }

  async publicPairings() {
    const current = await this.list("pairings");
    const active = current.filter((item: any) => new Date(item.expiresAt).getTime() > Date.now() && item.status !== "claimed");
    if (active.length !== current.length) await this.save("pairings", active);
    return active.map(({ code, ...item }: any) => item);
  }

  async upsertDevice(data: any) {
    const devices = await this.list("devices");
    const id = data.id || crypto.randomUUID();
    const device = {
      id,
      name: String(data.name || "Browser device").slice(0, 80),
      kind: String(data.kind || "browser").slice(0, 40),
      status: data.status || "pending",
      approved: Boolean(data.approved),
      capabilities: Array.isArray(data.capabilities) ? data.capabilities.slice(0, 20) : [],
      userAgent: String(data.userAgent || "").slice(0, 240),
      screen: data.screen || {},
      updatedAt: now(),
      lastSeenAt: now(),
      createdAt: data.createdAt || now()
    };
    const next = [device, ...devices.filter((item: any) => item.id !== id)];
    await this.save("devices", next);
    await this.broadcast({ type: "device", device });
    return device;
  }

  async claimPairing(data: any) {
    const pairings = await this.list("pairings");
    const pairing = pairings.find((item: any) => item.code === String(data.code || "").trim());
    if (!pairing || new Date(pairing.expiresAt).getTime() < Date.now()) return { error: "Pairing code is invalid or expired" };
    const device = await this.upsertDevice({ ...data, status: "waiting-approval", approved: false });
    await this.save("pairings", pairings.map((item: any) => item.id === pairing.id ? { ...item, status: "claimed", claimedBy: device.id, claimedAt: now() } : item));
    await this.receipt({
      action: "device.claim",
      target: device.name,
      risk: "Execute",
      result: "Device joined room pending approval.",
      verification: ["Pairing code matched", "Device is not auto-approved"]
    });
    return { device, pairing: { id: pairing.id, status: "claimed", expiresAt: pairing.expiresAt } };
  }

  async approveDevice(id: string, approved: boolean) {
    const devices = await this.list("devices");
    const next = devices.map((device: any) => device.id === id ? { ...device, approved, status: approved ? "approved" : "revoked", updatedAt: now() } : device);
    await this.save("devices", next);
    const device = next.find((item: any) => item.id === id);
    await this.receipt({
      action: approved ? "device.approve" : "device.revoke",
      target: device?.name || id,
      risk: "Execute",
      result: approved ? "Device approved." : "Device revoked.",
      verification: ["Device record persisted"]
    });
    return device;
  }

  async createMission(data: any) {
    const missions = await this.list("missions");
    const title = String(data.title || "Research task").slice(0, 140);
    const mission = {
      id: crypto.randomUUID(),
      title,
      objective: String(data.objective || title).slice(0, 8000),
      mode: data.mode || data.role || "research",
      role: data.role || "research",
      model: GEMINI_MODEL,
      status: "queued",
      progress: 0,
      attempts: 0,
      checkpoint: { phase: "queued" },
      createdAt: now(),
      updatedAt: now(),
      events: [
        { id: crypto.randomUUID(), type: "created", message: `Mission created: ${title}`, at: now() }
      ],
      evidence: [],
      artifacts: []
    };
    await this.save("missions", [mission, ...missions]);
    await this.state.storage.setAlarm(Date.now() + 100);
    await this.receipt({
      action: "agent.deploy",
      target: title,
      risk: "Execute",
      input: title,
      plan: ["Persist mission", "Run on Durable Object alarm", "Store provider result and evidence"],
      result: "Mission durably queued.",
      verification: ["Mission has id", "Durable Object storage updated", "Alarm scheduled"]
    });
    await this.broadcast({ type: "mission", mission });
    return mission;
  }

  async updateMission(id: string, action: string) {
    const missions = await this.list("missions");
    const mission = missions.find((item: any) => item.id === id);
    if (!mission) return { error: "Mission not found" };
    const event = { id: crypto.randomUUID(), type: action, message: "", at: now() };
    if (action === "pause") {
      mission.status = "paused";
      event.message = "Mission paused.";
    } else if (action === "resume") {
      mission.status = "queued";
      event.message = "Mission resumed from its checkpoint.";
      await this.state.storage.setAlarm(Date.now() + 100);
    } else if (action === "cancel") {
      mission.status = "cancelled";
      event.message = "Mission cancelled.";
    } else if (action === "advance" || action === "complete") {
      return { error: "Durable missions progress only when the executor produces real evidence." };
    }
    mission.events = [event, ...(mission.events || [])].slice(0, 30);
    mission.updatedAt = now();
    await this.save("missions", missions.map((item: any) => item.id === id ? mission : item));
    await this.receipt({
      action: `agent.${action}`,
      target: mission.title,
      risk: "Execute",
      result: event.message,
      verification: ["Mission record updated", "Event persisted"]
    });
    await this.broadcast({ type: "mission", mission });
    return mission;
  }

  async alarm() {
    const missions = await this.list("missions");
    const mission = missions.find((item: any) => item.status === "queued" || item.status === "retrying");
    if (!mission) return;
    mission.status = "running";
    mission.progress = Math.max(5, Number(mission.progress || 0));
    mission.attempts = Number(mission.attempts || 0) + 1;
    mission.checkpoint = { ...(mission.checkpoint || {}), phase: "executing" };
    mission.updatedAt = now();
    mission.events = [{ id: crypto.randomUUID(), type: "started", message: `Attempt ${mission.attempts} started.`, at: now() }, ...(mission.events || [])];
    await this.save("missions", missions.map((item: any) => item.id === mission.id ? mission : item));

    try {
      if (!this.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(this.env.GEMINI_API_KEY)}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `You are a ${mission.role} JARVIS agent. Execute the objective using only provided context. Never claim external actions occurred. Return evidence, blockers, and verification.` }] },
          contents: [{ role: "user", parts: [{ text: mission.objective }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 1200 }
        })
      });
      const payload = await response.json() as any;
      if (!response.ok) throw new Error(payload?.error?.message || `Gemini ${response.status}`);
      const summary = (payload.candidates || []).flatMap((candidate: any) => candidate?.content?.parts || []).map((part: any) => part.text).filter(Boolean).join("\n").trim();
      const current = (await this.list("missions")).find((item: any) => item.id === mission.id);
      if (!current || ["cancelled", "paused"].includes(current.status)) return;
      current.status = "complete";
      current.progress = 100;
      current.checkpoint = { phase: "complete" };
      current.updatedAt = now();
      current.completedAt = now();
      current.artifacts = [{ id: crypto.randomUUID(), type: "report", title: `${current.title} report`, createdAt: now(), summary }];
      current.evidence = [{ id: crypto.randomUUID(), label: "Gemini mission result", detail: `Attempt ${current.attempts}`, at: now() }];
      current.events = [{ id: crypto.randomUUID(), type: "completed", message: "Mission completed with provider evidence.", at: now() }, ...(current.events || [])];
      const latest = await this.list("missions");
      await this.save("missions", latest.map((item: any) => item.id === current.id ? current : item));
      await this.broadcast({ type: "mission", mission: current });
    } catch (error) {
      const latest = await this.list("missions");
      const current = latest.find((item: any) => item.id === mission.id);
      if (!current || ["cancelled", "paused"].includes(current.status)) return;
      current.status = current.attempts < 3 ? "retrying" : "failed";
      current.error = (error as Error).message;
      current.checkpoint = { phase: current.status, lastError: current.error };
      current.updatedAt = now();
      current.events = [{ id: crypto.randomUUID(), type: current.status, message: current.error, at: now() }, ...(current.events || [])];
      await this.save("missions", latest.map((item: any) => item.id === current.id ? current : item));
      if (current.status === "retrying") await this.state.storage.setAlarm(Date.now() + Math.min(30_000, 1000 * (2 ** current.attempts)));
    }

    const remaining = (await this.list("missions")).some((item: any) => item.status === "queued" || item.status === "retrying");
    if (remaining) await this.state.storage.setAlarm(Date.now() + 100);
  }

  async emergencyStop(reason: unknown) {
    const missions = (await this.list("missions")).map((mission: any) => {
      if (["complete", "cancelled"].includes(mission.status)) return mission;
      return {
        ...mission,
        status: "cancelled",
        updatedAt: now(),
        events: [{ id: crypto.randomUUID(), type: "emergency-stop", message: String(reason), at: now() }, ...(mission.events || [])]
      };
    });
    await this.save("missions", missions);
    const receipt = await this.receipt({
      action: "emergency.stop",
      target: "All room sessions",
      risk: "Commit",
      input: String(reason),
      result: "Missions cancelled and clients instructed to stop camera/WebRTC tracks.",
      verification: ["Durable room state updated", "Broadcast sent"]
    });
    await this.broadcast({ type: "emergency-stop", reason, receipt });
    return { stopped: true, receipt, agents: missions, missions };
  }

  async chat(data: any) {
    const prompt = String(data.prompt || data.command || data.message || "");
    const started = Date.now();
    let response = "I am online. I can open agents, camera, devices, provider health, receipts, projects, and run missions.";
    let source = "local";
    let error = "";

    if (this.env.GEMINI_API_KEY) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(this.env.GEMINI_API_KEY)}`;
        const result = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "You are JARVIS. Be concise, operational, and never claim actions succeeded without evidence." }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.55, maxOutputTokens: 700 }
          })
        });
        const payload = await result.json() as any;
        if (!result.ok) throw new Error(payload?.error?.message || `Gemini ${result.status}`);
        response = (payload.candidates || []).flatMap((candidate: any) => candidate?.content?.parts || []).map((part: any) => part.text).filter(Boolean).join("\n").trim() || response;
        source = "gemini";
      } catch (err) {
        error = (err as Error).message;
      }
    }

    const providerHealth = (await this.state.storage.get("providerHealth") || {}) as JsonRecord;
    providerHealth.gemini = {
      connected: Boolean(this.env.GEMINI_API_KEY),
      source: this.env.GEMINI_API_KEY ? "wrangler-secret" : "missing",
      label: "Gemini Brain",
      model: GEMINI_MODEL,
      latencyMs: Date.now() - started,
      lastRequestAt: now(),
      lastError: error,
      lastToolCall: "chat"
    };
    await this.state.storage.put("providerHealth", providerHealth);

    const receipt = await this.receipt({
      action: "conversation.answer",
      target: source === "gemini" ? "Gemini Brain" : "Local Brain",
      risk: "Observe",
      input: prompt,
      result: response,
      verification: [source === "gemini" ? "Gemini returned text" : "Local fallback returned text"]
    });
    return { intent: "conversation.answer", response, source, model: source === "gemini" ? GEMINI_MODEL : undefined, needsKey: !this.env.GEMINI_API_KEY, error, receipt };
  }

  handleWebSocket() {
    const pair = new (globalThis as any).WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (this.state.acceptWebSocket) this.state.acceptWebSocket(server);
    else server.accept();
    server.send(JSON.stringify({ type: "connected", room: ROOM_NAME, at: now() }));
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let payload: unknown = message;
    try {
      payload = typeof message === "string" ? JSON.parse(message) : message;
    } catch {
      payload = { type: "message", data: String(message) };
    }
    await this.broadcast({ type: "signal", payload, at: now() }, ws);
  }

  async broadcast(payload: unknown, except?: WebSocket) {
    const sockets = this.state.getWebSockets ? this.state.getWebSockets() : [];
    for (const socket of sockets) {
      if (socket === except) continue;
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // Ignore disconnected clients; Durable Objects prune dead sockets.
      }
    }
  }
}
