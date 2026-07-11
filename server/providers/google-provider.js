const { OAuth2Client } = require("google-auth-library");
const { cleanString, createOAuthStateStore, errorWithStatus, fetchJson } = require("./provider-utils");

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
];

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
    const configured = cleanString(settings.webhookBaseUrl, 500).replace(/\/+$/, "");
    const base = configured || localBaseUrl;
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
    return {
      connected: Boolean(clientId && clientSecret && (hasAccess || hasRefresh)),
      configured: Boolean(clientId && clientSecret),
      source: process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_REFRESH_TOKEN ? "env" : hasAccess || hasRefresh ? "local" : "missing",
      label: "Google Workspace",
      authMode: "oauth2",
      missing,
      canConnect: Boolean(clientId && clientSecret),
      scopes: String(settings.googleScopes || GOOGLE_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    };
  }

  function start({ sessionId }) {
    const settings = getSettings();
    const oauth = client(settings);
    const callback = redirectUri(settings);
    const state = stateStore.issue("google", sessionId, callback);
    return {
      authorizationUrl: oauth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: true,
        scope: GOOGLE_SCOPES,
        state,
      }),
      redirectUri: callback,
      expiresInSeconds: 600,
    };
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
    return test();
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

  async function sendEmail(message) {
    const token = await accessToken();
    const { data } = await fetchJson(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: encodeEmail(message) }),
    });
    return {
      sent: true,
      providerMessageId: data.id,
      threadId: data.threadId,
      recipient: cleanString(message.recipient, 320),
    };
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

  return { accessToken, callback, disconnect, redirectUri, sendEmail, start, status, test };
}

module.exports = { createGoogleProvider, GOOGLE_SCOPES };
