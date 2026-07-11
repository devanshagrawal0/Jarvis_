const { cleanString, createOAuthStateStore, errorWithStatus, fetchJson, fetchPagedArray } = require("./provider-utils");
const dns = require("dns");
const net = require("net");

function createCanvasProvider({
  runtimeDir,
  getSettings,
  saveSettings,
  localBaseUrl,
  fetchImpl = fetch,
  lookupImpl = dns.promises.lookup,
}) {
  const stateStore = createOAuthStateStore(runtimeDir);

  function config(settings = getSettings()) {
    if (!settings.canvasBaseUrl) throw errorWithStatus("Canvas is not configured. Add canvasBaseUrl.", 412);
    const base = new URL(String(settings.canvasBaseUrl));
    const allowedHost = cleanString(settings.canvasAllowedHost || base.hostname, 255).toLowerCase();
    const invalidHost = base.hostname === "localhost" || net.isIP(base.hostname) !== 0;
    if (base.protocol !== "https:" || base.port || base.username || base.password || base.hash || base.hostname.toLowerCase() !== allowedHost || invalidHost) {
      throw errorWithStatus("Canvas base URL must be an approved HTTPS hostname.", 412);
    }
    return {
      base: base.toString().replace(/\/+$/, ""),
      clientId: settings.canvasClientId || "",
      clientSecret: settings.canvasClientSecret || "",
      accessToken: settings.canvasToken || "",
      refreshToken: settings.canvasRefreshToken || "",
    };
  }

  function isPrivateAddress(address) {
    if (net.isIP(address) === 4) {
      const parts = address.split(".").map(Number);
      return parts[0] === 10
        || parts[0] === 127
        || parts[0] === 0
        || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
        || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
        || (parts[0] === 198 && parts[1] === 18)
        || (parts[0] === 198 && parts[1] === 19)
        || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
        || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
        || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        || parts[0] >= 224;
    }
    const normalized = address.toLowerCase();
    return normalized === "::1"
      || normalized === "::"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe8")
      || normalized.startsWith("fe9")
      || normalized.startsWith("fea")
      || normalized.startsWith("feb")
      || normalized.startsWith("2001:db8");
  }

  async function assertPublicHost(current) {
    const records = await lookupImpl(new URL(current.base).hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
      throw errorWithStatus("Canvas hostname resolved to a private or reserved network address", 412);
    }
  }

  function redirectUri(settings = getSettings()) {
    const configured = cleanString(settings.webhookBaseUrl, 500).replace(/\/+$/, "");
    const base = configured || localBaseUrl;
    const url = new URL("/api/oauth/canvas/callback", `${base}/`);
    if (url.protocol === "http:" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw errorWithStatus("Remote Canvas OAuth callbacks must use HTTPS", 412);
    }
    return url.toString();
  }

  function status(settings = getSettings()) {
    const hasBase = Boolean(settings.canvasBaseUrl);
    const hasToken = Boolean(settings.canvasToken);
    const hasOAuth = Boolean(settings.canvasClientId && settings.canvasClientSecret);
    const missing = [];
    if (!hasBase) missing.push("canvasBaseUrl");
    if (!hasToken) missing.push("Canvas access token or login");
    return {
      connected: Boolean(hasBase && hasToken),
      configured: hasBase,
      source: hasToken ? "local" : "missing",
      label: "Canvas LMS",
      authMode: hasOAuth ? "oauth2" : "personal-access-token",
      missing,
      canConnect: Boolean(hasBase && hasOAuth),
    };
  }

  async function token() {
    const settings = getSettings();
    const current = config(settings);
    await assertPublicHost(current);
    const expiry = Number(settings.canvasTokenExpiry || 0);
    if (current.accessToken && (!expiry || expiry > Date.now() + 60_000)) return current.accessToken;
    if (!current.refreshToken || !current.clientId || !current.clientSecret) {
      if (current.accessToken) return current.accessToken;
      throw errorWithStatus("Canvas login is required. Add a personal access token or configure Canvas OAuth.", 412);
    }
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: current.clientId,
      client_secret: current.clientSecret,
      refresh_token: current.refreshToken,
    });
    const { data } = await fetchJson(fetchImpl, `${current.base}/login/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    saveSettings({
      canvasToken: data.access_token,
      canvasRefreshToken: data.refresh_token || current.refreshToken,
      canvasTokenExpiry: data.expires_in ? String(Date.now() + Number(data.expires_in) * 1000) : "",
    });
    return data.access_token;
  }

  async function headers() {
    return { authorization: `Bearer ${await token()}` };
  }

  function start({ sessionId }) {
    const settings = getSettings();
    const current = config(settings);
    if (!current.clientId || !current.clientSecret) {
      throw errorWithStatus("Canvas OAuth requires canvasClientId and canvasClientSecret. A personal access token can be used instead.", 412);
    }
    const callback = redirectUri(settings);
    const state = stateStore.issue("canvas", sessionId, callback);
    const authorizationUrl = new URL(`${current.base}/login/oauth2/auth`);
    authorizationUrl.searchParams.set("client_id", current.clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", callback);
    authorizationUrl.searchParams.set("state", state);
    return { authorizationUrl: authorizationUrl.toString(), redirectUri: callback, expiresInSeconds: 600 };
  }

  async function callback({ code, state, sessionId }) {
    if (!code) throw errorWithStatus("Canvas OAuth callback did not include an authorization code", 400);
    const pending = stateStore.consume("canvas", state, sessionId);
    const current = config();
    await assertPublicHost(current);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: current.clientId,
      client_secret: current.clientSecret,
      redirect_uri: pending.redirectUri,
      code,
    });
    const { data } = await fetchJson(fetchImpl, `${current.base}/login/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    saveSettings({
      canvasToken: data.access_token,
      canvasRefreshToken: data.refresh_token || null,
      canvasTokenExpiry: data.expires_in ? String(Date.now() + Number(data.expires_in) * 1000) : "",
    });
    return test();
  }

  async function test() {
    const current = config();
    await assertPublicHost(current);
    const { data } = await fetchJson(fetchImpl, `${current.base}/api/v1/users/self/profile`, {
      headers: await headers(),
    });
    return {
      connected: true,
      id: data.id,
      name: data.name || data.short_name || "",
      primaryEmail: data.primary_email || "",
      loginId: data.login_id || "",
      baseUrl: current.base,
    };
  }

  async function courses() {
    const current = config();
    await assertPublicHost(current);
    const values = await fetchPagedArray(
      fetchImpl,
      `${current.base}/api/v1/courses?enrollment_state=active&per_page=50&include[]=term`,
      { headers: await headers() },
      200,
    );
    return {
      courses: values.map((course) => ({
        id: course.id,
        name: course.name,
        courseCode: course.course_code,
        term: course.term?.name,
        startAt: course.start_at,
        endAt: course.end_at,
      })),
    };
  }

  async function assignments({ courseId = "", limit = 30 } = {}) {
    const current = config();
    await assertPublicHost(current);
    const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 30));
    if (!cleanString(courseId, 80)) {
      const courseList = await courses();
      const grouped = [];
      for (const course of courseList.courses.slice(0, 12)) {
        const result = await assignments({ courseId: course.id, limit: Math.min(10, boundedLimit) });
        if (result.assignments.length) grouped.push({ course, assignments: result.assignments });
      }
      return {
        coursesChecked: courseList.courses.length,
        groupedAssignments: grouped,
        assignments: grouped.flatMap((group) => group.assignments.map((assignment) => ({
          ...assignment,
          courseId: group.course.id,
          courseName: group.course.name,
          courseCode: group.course.courseCode,
        }))).slice(0, boundedLimit),
      };
    }
    const id = encodeURIComponent(cleanString(courseId, 80));
    const values = await fetchPagedArray(
      fetchImpl,
      `${current.base}/api/v1/courses/${id}/assignments?bucket=upcoming&order_by=due_at&per_page=50`,
      { headers: await headers() },
      boundedLimit,
    );
    return {
      assignments: values.map((item) => ({
        id: item.id,
        name: item.name,
        dueAt: item.due_at,
        pointsPossible: item.points_possible,
        submissionTypes: item.submission_types,
        htmlUrl: item.html_url,
      })),
    };
  }

  async function disconnect() {
    const current = config();
    await assertPublicHost(current);
    if (current.accessToken) {
      await fetchJson(fetchImpl, `${current.base}/login/oauth2/token`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${current.accessToken}` },
      }).catch(() => undefined);
    }
    saveSettings({ canvasToken: null, canvasRefreshToken: null, canvasTokenExpiry: "" });
    return { disconnected: true };
  }

  return { assignments, callback, courses, disconnect, redirectUri, start, status, test };
}

module.exports = { createCanvasProvider };
