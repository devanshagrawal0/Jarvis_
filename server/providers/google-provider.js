const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const { cleanString, createOAuthStateStore, errorWithStatus, fetchJson } = require("./provider-utils");
const scopeModel = require("./google-scopes");

// Legacy default = the original Gmail send/draft grant, so an owner who connected before Wave 4 (or
// who calls start with no bundles) keeps exactly today's behaviour.
const GOOGLE_SCOPES = scopeModel.scopesForBundles(["gmail_send"]);
const DEFAULT_BUNDLES = ["gmail_send"];

function createGoogleProvider({
  runtimeDir,
  getSettings,
  saveSettings,
  localBaseUrl,
  fetchImpl = fetch,
  oauthClientFactory = (clientId, clientSecret, callback) => new OAuth2Client(clientId, clientSecret, callback),
}) {
  const stateStore = createOAuthStateStore(runtimeDir);

  function redirectUri(settings = getSettings()) {
    // googleRedirectBase pins the OAuth callback origin (e.g. http://localhost:8799) independent of
    // webhookBaseUrl — needed because webhookBaseUrl points at an ephemeral tunnel that won't match a
    // stable redirect URI registered in the Google console.
    const override = cleanString(settings.googleRedirectBase, 500).replace(/\/+$/, "");
    const configured = cleanString(settings.webhookBaseUrl, 500).replace(/\/+$/, "");
    const base = override || configured || localBaseUrl;
    const url = new URL("/api/oauth/google/callback", `${base}/`);
    if (!["http:", "https:"].includes(url.protocol)) throw errorWithStatus("Google OAuth callback must use HTTP or HTTPS", 412);
    if (url.protocol === "http:" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw errorWithStatus("Remote Google OAuth callbacks must use HTTPS", 412);
    }
    return url.toString();
  }

  function credentials(settings = getSettings()) {
    return {
      clientId: settings.googleClientId || process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: settings.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || "",
    };
  }

  function client(settings = getSettings()) {
    const { clientId, clientSecret } = credentials(settings);
    if (!clientId || !clientSecret) {
      throw errorWithStatus("Google OAuth is not configured. Add googleClientId and googleClientSecret.", 412);
    }
    const oauth = oauthClientFactory(clientId, clientSecret, redirectUri(settings));
    oauth.setCredentials({
      access_token: settings.googleAccessToken || process.env.GOOGLE_ACCESS_TOKEN || undefined,
      refresh_token: settings.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN || undefined,
      expiry_date: Number(settings.googleTokenExpiry || 0) || undefined,
      token_type: "Bearer",
      scope: settings.googleScopes || GOOGLE_SCOPES.join(" "),
    });
    oauth.on("tokens", (tokens) => {
      const patch = {};
      if (tokens.access_token) patch.googleAccessToken = tokens.access_token;
      if (tokens.refresh_token) patch.googleRefreshToken = tokens.refresh_token;
      if (tokens.expiry_date) patch.googleTokenExpiry = String(tokens.expiry_date);
      if (Object.keys(patch).length) saveSettings(patch);
    });
    return oauth;
  }

  function status(settings = getSettings()) {
    const { clientId, clientSecret } = credentials(settings);
    const hasAccess = Boolean(settings.googleAccessToken || process.env.GOOGLE_ACCESS_TOKEN);
    const hasRefresh = Boolean(settings.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN);
    const missing = [];
    if (!clientId) missing.push("googleClientId");
    if (!clientSecret) missing.push("googleClientSecret");
    if (!hasAccess && !hasRefresh) missing.push("Google login");
    const grantedScopeString = String(settings.googleScopes || (hasAccess || hasRefresh ? GOOGLE_SCOPES.join(" ") : ""));
    return {
      connected: Boolean(clientId && clientSecret && (hasAccess || hasRefresh)),
      configured: Boolean(clientId && clientSecret),
      source: process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_REFRESH_TOKEN ? "env" : hasAccess || hasRefresh ? "local" : "missing",
      label: "Google Workspace",
      authMode: "oauth2",
      missing,
      canConnect: Boolean(clientId && clientSecret),
      scopes: grantedScopeString.split(/\s+/).filter(Boolean),
      // Wave 4 — per-service health, granted bundles, and the catalogue of connectable capabilities.
      services: scopeModel.serviceHealth(grantedScopeString),
      grantedBundles: scopeModel.bundlesFromGranted(grantedScopeString),
      catalog: Object.entries(scopeModel.BUNDLES).map(([key, b]) => ({ key, service: b.service, level: b.level, label: b.label, why: b.why })),
    };
  }

  // Progressive: request identity + only the named capability bundles. include_granted_scopes keeps
  // whatever was granted before, so connecting Calendar never re-prompts (or drops) Gmail, and a
  // Gmail-only owner never grants Calendar. `bundles` defaults to the legacy Gmail grant.
  function start({ sessionId, bundles } = {}) {
    const settings = getSettings();
    const oauth = client(settings);
    const callback = redirectUri(settings);
    const state = stateStore.issue("google", sessionId, callback);
    const requested = Array.isArray(bundles) && bundles.length ? bundles.filter((b) => scopeModel.BUNDLES[b]) : DEFAULT_BUNDLES;
    const scope = scopeModel.scopesForBundles(requested);
    return {
      authorizationUrl: oauth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope,
        state,
      }),
      redirectUri: callback,
      requestedBundles: requested,
      requestedScopes: scope,
      explanations: scopeModel.explainScopes(scope),
      expiresInSeconds: 600,
    };
  }

  // Fail a capability cleanly (412) when its scope was never granted or has been revoked — so the
  // affected feature degrades on its own instead of surfacing a raw Google 403.
  function requireCapability(bundleKey, label) {
    const scopes = getSettings().googleScopes;
    if (!scopes) return;   // legacy/unknown grant — don't block; Google itself still enforces server-side
    if (!scopeModel.grants(scopes, bundleKey)) {
      throw errorWithStatus(`Google ${label} isn't connected. Grant the "${scopeModel.BUNDLES[bundleKey]?.label || bundleKey}" scope from Connections.`, 412);
    }
  }

  async function callback({ code, state, sessionId }) {
    if (!code) throw errorWithStatus("Google OAuth callback did not include an authorization code", 400);
    const pending = stateStore.consume("google", state, sessionId);
    const settings = getSettings();
    const oauth = client({ ...settings, webhookBaseUrl: new URL(pending.redirectUri).origin });
    const { tokens } = await oauth.getToken({ code, redirect_uri: pending.redirectUri });
    if (!tokens.access_token && !tokens.refresh_token) throw errorWithStatus("Google did not return usable OAuth credentials", 502);
    saveSettings({
      googleAccessToken: tokens.access_token || null,
      googleRefreshToken: tokens.refresh_token || settings.googleRefreshToken || null,
      googleTokenExpiry: tokens.expiry_date ? String(tokens.expiry_date) : "",
      googleScopes: tokens.scope || GOOGLE_SCOPES.join(" "),
    });
    return verify();
  }

  // Service-aware post-connect check: probe ONLY the services the owner actually granted, and never
  // throw if one is missing — so connecting just Calendar doesn't blow up on a Gmail-scope 403.
  async function verify() {
    const token = await accessToken();
    const health = scopeModel.serviceHealth(getSettings().googleScopes);
    const out = { connected: true, scopes: status().scopes, services: {} };
    if (health.gmail.canSend || health.gmail.canDraft || health.gmail.canRead) {
      try { const { data } = await fetchJson(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${token}` } }); out.emailAddress = data.emailAddress || ""; out.services.gmail = { ok: true }; }
      catch (e) { out.services.gmail = { ok: false, error: String(e && e.message || e) }; }
    }
    if (health.calendar.connected) {
      try { const { data } = await fetchJson(fetchImpl, "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", { headers: { authorization: `Bearer ${token}` } }); out.services.calendar = { ok: true, calendars: (data.items || []).length }; }
      catch (e) { out.services.calendar = { ok: false, error: String(e && e.message || e) }; }
    }
    return out;
  }

  async function accessToken() {
    const oauth = client();
    const result = await oauth.getAccessToken();
    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw errorWithStatus("Google OAuth login is required", 412);
    return token;
  }

  async function test() {
    const token = await accessToken();
    const { data } = await fetchJson(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${token}` },
    });
    return {
      connected: true,
      emailAddress: data.emailAddress || "",
      messagesTotal: data.messagesTotal ?? null,
      threadsTotal: data.threadsTotal ?? null,
      scopes: status().scopes,
    };
  }

  function encodeEmail({ recipient, subject, body }) {
    const settings = getSettings();
    const from = cleanString(settings.googleFromEmail || "", 320).replace(/[\r\n]/g, "");
    const to = cleanString(recipient, 320).replace(/[\r\n]/g, "");
    const cleanSubject = cleanString(subject, 200).replace(/[\r\n]/g, " ");
    const encodedSubject = Buffer.from(cleanSubject, "utf8").toString("base64");
    const headers = [
      from ? `From: ${from}` : "",
      `To: ${to}`,
      `Subject: =?UTF-8?B?${encodedSubject}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
    ].filter(Boolean);
    return Buffer.from([...headers, "", cleanString(body, 10000)].join("\r\n")).toString("base64url");
  }

  function normalizedMessage(message = {}) {
    const recipient = cleanString(message.recipient, 320).replace(/[\r\n]/g, "");
    const subject = cleanString(message.subject, 200).replace(/[\r\n]/g, " ");
    const body = cleanString(message.body, 10000);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw errorWithStatus("A valid recipient email address is required", 400);
    if (!subject) throw errorWithStatus("An email subject is required", 400);
    if (!body) throw errorWithStatus("An email body is required", 400);
    return { recipient, subject, body };
  }

  async function sendEmail(message) {
    requireCapability("gmail_send", "email sending");
    const normalized = normalizedMessage(message);
    const token = await accessToken();
    const { data } = await fetchJson(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: encodeEmail(normalized) }),
    });
    return {
      sent: true,
      providerMessageId: data.id,
      threadId: data.threadId,
      recipient: normalized.recipient,
    };
  }

  async function createDraft(message) {
    const normalized = normalizedMessage(message);
    const token = await accessToken();
    const raw = encodeEmail(normalized);
    const { data } = await fetchJson(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    return {
      draftId: data.id,
      providerMessageId: data.message?.id || null,
      threadId: data.message?.threadId || null,
      recipient: normalized.recipient,
      subject: normalized.subject,
      bodyHash: crypto.createHash("sha256").update(normalized.body).digest("hex"),
      sent: false,
    };
  }

  async function getDraft(draftId) {
    const token = await accessToken();
    const safeId = encodeURIComponent(cleanString(draftId, 200));
    const { data } = await fetchJson(fetchImpl, `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${safeId}?format=raw`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const raw = data.message?.raw ? Buffer.from(data.message.raw, "base64url").toString("utf8") : "";
    const split = raw.split(/\r?\n\r?\n/);
    const headers = split.shift() || "";
    const header = (name) => headers.match(new RegExp(`^${name}:\\s*(.*)$`, "im"))?.[1]?.trim() || "";
    const rawSubject = header("Subject");
    const encodedSubject = rawSubject.match(/^=\?UTF-8\?B\?([^?]+)\?=$/i);
    const subject = encodedSubject ? Buffer.from(encodedSubject[1], "base64").toString("utf8") : rawSubject;
    return { draftId:data.id, providerMessageId:data.message?.id||null, threadId:data.message?.threadId||null,
      recipient:header("To"), subject, rawBody:split.join("\n\n"), labelIds:data.message?.labelIds||[], sent:false };
  }

  async function deleteDraft(draftId) {
    const token = await accessToken();
    const safeId = encodeURIComponent(cleanString(draftId, 200));
    const response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${safeId}`, {
      method: "DELETE", headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw errorWithStatus(`Google draft deletion failed (${response.status})`, 502);
    return { deleted:true, draftId };
  }

  async function sendDraft({ draftId, expectedRecipient, expectedSubject, expectedBodyHash } = {}) {
    const id = cleanString(draftId, 200);
    if (!id) throw errorWithStatus("A Gmail draft id is required", 400);
    const current = await getDraft(id);
    const actualBodyHash = crypto.createHash("sha256").update(cleanString(current.rawBody, 10000)).digest("hex");
    if (expectedRecipient && current.recipient.toLowerCase() !== cleanString(expectedRecipient, 320).toLowerCase()) {
      throw errorWithStatus("The Gmail draft recipient changed after approval preparation", 409);
    }
    if (expectedSubject && current.subject !== cleanString(expectedSubject, 200)) {
      throw errorWithStatus("The Gmail draft subject changed after approval preparation", 409);
    }
    if (expectedBodyHash && actualBodyHash !== cleanString(expectedBodyHash, 128)) {
      throw errorWithStatus("The Gmail draft body changed after approval preparation", 409);
    }
    const token = await accessToken();
    const { data } = await fetchJson(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    return {
      sent: true,
      draftId: id,
      providerMessageId: data.id || current.providerMessageId || null,
      threadId: data.threadId || current.threadId || null,
      recipient: current.recipient,
      subject: current.subject,
      bodyHash: actualBodyHash,
    };
  }

  // ── Reading (gmail.readonly) ───────────────────────────────────────────────
  // List message ids matching a Gmail search query (e.g. "is:unread", "newer_than:2d"). Read-only.
  async function listMessages({ query = "", maxResults = 10 } = {}) {
    requireCapability("gmail_read", "reading email");
    const token = await accessToken();
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    if (query) url.searchParams.set("q", String(query));
    url.searchParams.set("maxResults", String(Math.max(1, Math.min(50, Number(maxResults) || 10))));
    const { data } = await fetchJson(fetchImpl, url.toString(), { headers: { authorization: `Bearer ${token}` } });
    return { messages: Array.isArray(data.messages) ? data.messages : [], resultSizeEstimate: data.resultSizeEstimate ?? null };
  }

  // Fetch one message's full payload (headers + parts) so the caller can parse sender/subject/body.
  async function getMessage(id, { format = "full" } = {}) {
    requireCapability("gmail_read", "reading email");
    const token = await accessToken();
    const safeId = encodeURIComponent(String(id || ""));
    const { data } = await fetchJson(fetchImpl, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${safeId}?format=${encodeURIComponent(format)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return data;
  }

  // ── Calendar write (calendar.events) ───────────────────────────────────────
  // All three re-check the write scope; a missing grant throws a clean 412 the caller turns into a
  // "grant Manage calendar events" hint. Times are RFC3339 (the proposal already produced ISO instants).
  const CAL_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  async function createCalendarEvent({ title, startAt, endAt, location, allDay = false } = {}) {
    requireCapability("calendar_write", "calendar editing");
    if (!startAt) throw errorWithStatus("An event start time is required", 400);
    const token = await accessToken();
    const body = {
      summary: cleanString(title || "Event", 500),
      start: allDay ? { date: String(startAt).slice(0, 10) } : { dateTime: startAt },
      end: allDay ? { date: String(endAt || startAt).slice(0, 10) } : { dateTime: endAt || new Date(new Date(startAt).getTime() + 3600_000).toISOString() },
    };
    if (location) body.location = cleanString(location, 500);
    const { data } = await fetchJson(fetchImpl, CAL_BASE, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { id: data.id, htmlLink: data.htmlLink || null, summary: data.summary || body.summary, start: data.start, end: data.end };
  }
  async function updateCalendarEvent(id, { startAt, endAt, title, location } = {}) {
    requireCapability("calendar_write", "calendar editing");
    const token = await accessToken();
    const patch = {};
    if (startAt) patch.start = { dateTime: startAt };
    if (endAt || startAt) patch.end = { dateTime: endAt || new Date(new Date(startAt).getTime() + 3600_000).toISOString() };
    if (title) patch.summary = cleanString(title, 500);
    if (location != null) patch.location = cleanString(location, 500);
    const { data } = await fetchJson(fetchImpl, `${CAL_BASE}/${encodeURIComponent(String(id))}`, {
      method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(patch),
    });
    return { id: data.id, htmlLink: data.htmlLink || null, summary: data.summary, start: data.start, end: data.end };
  }
  async function deleteCalendarEvent(id) {
    requireCapability("calendar_write", "calendar editing");
    const token = await accessToken();
    const response = await fetchImpl(`${CAL_BASE}/${encodeURIComponent(String(id))}`, {
      method: "DELETE", headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 410) { // 410 = already gone; treat as success
      const t = await response.text().catch(() => "");
      throw errorWithStatus(`Google Calendar delete ${response.status}: ${t.slice(0, 200)}`, response.status);
    }
    return { deleted: true, id };
  }

  async function disconnect() {
    const settings = getSettings();
    const token = settings.googleRefreshToken || settings.googleAccessToken || process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_ACCESS_TOKEN;
    if (token) {
      const oauth = client(settings);
      await oauth.revokeToken(token).catch(() => undefined);
    }
    saveSettings({
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: "",
      googleScopes: "",
    });
    return { disconnected: true };
  }

  return { accessToken, callback, createCalendarEvent, createDraft, deleteCalendarEvent, deleteDraft, disconnect, getDraft, getMessage, listMessages, redirectUri, requireCapability, sendDraft, sendEmail, start, status, test, updateCalendarEvent, verify };
}

module.exports = { createGoogleProvider, GOOGLE_SCOPES };
