const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { createCanvasProvider } = require("../../server/providers/canvas-provider");
const { createGoogleProvider } = require("../../server/providers/google-provider");
const { createKalshiProvider } = require("../../server/providers/kalshi-provider");

const temporaryDirs = [];

function tempDir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-provider-"));
  temporaryDirs.push(value);
  return value;
}

afterEach(() => {
  for (const directory of temporaryDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test("Google OAuth binds state to the browser session and sends Gmail with the active token", async () => {
  let settings = {
    googleClientId: "client-id",
    googleClientSecret: "client-secret",
    googleAccessToken: "access-token",
  };
  const saved = [];
  class FakeOAuthClient {
    setCredentials(value) { this.credentials = value; }
    on() {}
    generateAuthUrl(options) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", options.state);
      return url.toString();
    }
    async getToken() {
      return { tokens: { access_token: "callback-access", refresh_token: "callback-refresh", expiry_date: Date.now() + 3600_000 } };
    }
    async getAccessToken() { return { token: this.credentials.access_token || "callback-access" }; }
    async revokeToken() {}
  }
  const requests = [];
  const provider = createGoogleProvider({
    runtimeDir: tempDir(),
    getSettings: () => settings,
    saveSettings: (patch) => {
      saved.push(patch);
      settings = { ...settings, ...patch };
      return settings;
    },
    localBaseUrl: "http://127.0.0.1:8799",
    oauthClientFactory: () => new FakeOAuthClient(),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/profile")) {
        return new Response(JSON.stringify({ emailAddress: "devansh@example.com", messagesTotal: 12, threadsTotal: 4 }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "message-1", threadId: "thread-1" }), { status: 200 });
    },
  });

  const started = provider.start({ sessionId: "session-a" });
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  await assert.rejects(
    () => provider.callback({ code: "code", state, sessionId: "session-b" }),
    /another browser session/i,
  );

  const second = provider.start({ sessionId: "session-a" });
  const secondState = new URL(second.authorizationUrl).searchParams.get("state");
  const connected = await provider.callback({ code: "code", state: secondState, sessionId: "session-a" });
  assert.equal(connected.emailAddress, "devansh@example.com");
  assert.ok(saved.some((patch) => patch.googleRefreshToken === "callback-refresh"));

  const sent = await provider.sendEmail({ recipient: "person@example.com", subject: "Status", body: "Verified." });
  assert.equal(sent.providerMessageId, "message-1");
  const sendRequest = requests.find((item) => item.url.includes("/messages/send"));
  assert.equal(sendRequest.options.headers.authorization, "Bearer callback-access");
  assert.ok(JSON.parse(sendRequest.options.body).raw);
});

test("Canvas validates its host, tests identity, and follows only same-origin pagination", async () => {
  const settings = {
    canvasBaseUrl: "https://canvas.example.edu",
    canvasAllowedHost: "canvas.example.edu",
    canvasToken: "canvas-token",
  };
  const requests = [];
  const provider = createCanvasProvider({
    runtimeDir: tempDir(),
    getSettings: () => settings,
    saveSettings: () => settings,
    localBaseUrl: "http://127.0.0.1:8799",
    lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
    fetchImpl: async (url, options = {}) => {
      const value = String(url);
      requests.push({ value, options });
      if (value.endsWith("/users/self/profile")) {
        return new Response(JSON.stringify({ id: 7, name: "Devansh", primary_email: "devansh@example.edu" }), { status: 200 });
      }
      if (value.includes("page=2")) {
        return new Response(JSON.stringify([{ id: 2, name: "Course Two", course_code: "TWO" }]), { status: 200 });
      }
      if (value.includes("/assignments")) {
        const courseId = value.match(/courses\/([^/]+)\/assignments/)?.[1] || "unknown";
        return new Response(JSON.stringify([{
          id: Number(`${courseId}01`),
          name: `Assignment for ${courseId}`,
          due_at: "2026-06-25T04:00:00Z",
          points_possible: 10,
          submission_types: ["online_upload"],
          html_url: `https://canvas.example.edu/courses/${courseId}/assignments/${courseId}01`,
        }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: 1, name: "Course One", course_code: "ONE" }]), {
        status: 200,
        headers: { link: '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next"' },
      });
    },
  });

  const identity = await provider.test();
  assert.equal(identity.name, "Devansh");
  const courses = await provider.courses();
  assert.deepEqual(courses.courses.map((course) => course.id), [1, 2]);
  const assignments = await provider.assignments({ limit: 10 });
  assert.equal(assignments.coursesChecked, 2);
  assert.deepEqual(assignments.assignments.map((assignment) => assignment.courseName), ["Course One", "Course Two"]);
  assert.ok(requests.every((request) => request.options.headers.authorization === "Bearer canvas-token"));
});

test("Canvas rejects hostnames that resolve to private addresses", async () => {
  const provider = createCanvasProvider({
    runtimeDir: tempDir(),
    getSettings: () => ({
      canvasBaseUrl: "https://canvas.example.edu",
      canvasAllowedHost: "canvas.example.edu",
      canvasToken: "canvas-token",
    }),
    saveSettings: () => {},
    localBaseUrl: "http://127.0.0.1:8799",
    lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async () => {
      throw new Error("request should not be sent");
    },
  });
  await assert.rejects(() => provider.test(), /private or reserved/i);
});

test("Kalshi signs authenticated reads with RSA-PSS over timestamp, method, and path", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const settings = {
    kalshiKeyId: "key-id",
    kalshiPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
  let verified = false;
  const provider = createKalshiProvider({
    getSettings: () => settings,
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      const timestamp = options.headers["KALSHI-ACCESS-TIMESTAMP"];
      const signature = Buffer.from(options.headers["KALSHI-ACCESS-SIGNATURE"], "base64");
      verified = crypto.verify(
        "sha256",
        Buffer.from(`${timestamp}GET${parsed.pathname}`),
        {
          key: publicKey,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        },
        signature,
      );
      return new Response(JSON.stringify({ balance: 12345, portfolio_value: 23456 }), { status: 200 });
    },
  });

  const balance = await provider.balance();
  assert.equal(verified, true);
  assert.equal(balance.balance, 12345);
  assert.equal(balance.portfolioValue, 23456);
});

test("Kalshi market discovery expands sports queries and filters unrelated markets", async () => {
  const provider = createKalshiProvider({
    getSettings: () => ({ kalshiEnvironment: "production" }),
    fetchImpl: async () => new Response(JSON.stringify({
      markets: [
        {
          ticker: "KXMEXGAME-26",
          title: "Mexico to win its FIFA World Cup match",
          subtitle: "Mexico vs Jamaica",
          event_ticker: "KXFIFA-MEX-JAM",
          series_ticker: "KXFIFA",
          category: "Sports",
          status: "open",
          yes_bid_dollars: "0.42",
          yes_ask_dollars: "0.44",
          volume: 2000,
        },
        {
          ticker: "KXRAIN-26",
          title: "Rain in Boston tomorrow",
          category: "Weather",
          status: "open",
          yes_bid_dollars: "0.10",
          yes_ask_dollars: "0.20",
        },
      ],
      cursor: "",
    }), { status: 200 }),
  });

  const result = await provider.marketDiscovery({ query: "find the current mexico game world cup on kalshi" });
  assert.equal(result.markets.length, 1);
  assert.equal(result.markets[0].ticker, "KXMEXGAME-26");
  assert.equal(result.searchPlan.fetchedOpenMarkets, 2);
  assert.ok(result.searchPlan.expandedPhrases.includes("mex"));
});

test("Kalshi portfolio normalizes positions and fills into readable English", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const settings = {
    kalshiKeyId: "key-id",
    kalshiPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
  const provider = createKalshiProvider({
    getSettings: () => settings,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/trade-api/v2/portfolio/balance") {
        return new Response(JSON.stringify({ balance: 12345, balance_dollars: "123.45", portfolio_value: 23456 }), { status: 200 });
      }
      if (parsed.pathname === "/trade-api/v2/portfolio/positions") {
        return new Response(JSON.stringify({
          market_positions: [{
            ticker: "KXTEST-26JAN01-T50",
            position_fp: "3.00",
            market_exposure_dollars: "12.34",
            realized_pnl_dollars: "4.56",
            total_traded_dollars: "20.00",
            resting_orders_count: 1,
          }],
          event_positions: [],
          cursor: "",
        }), { status: 200 });
      }
      if (parsed.pathname === "/trade-api/v2/portfolio/fills") {
        return new Response(JSON.stringify({
          fills: [{
            fill_id: "fill-1",
            ticker: "KXTEST-26JAN01-T50",
            count_fp: "2.00",
            yes_price_dollars: "0.42",
            no_price_dollars: "0.58",
            side: "yes",
            action: "matched",
            created_time: "2026-01-01T12:00:00Z",
          }],
          cursor: "",
        }), { status: 200 });
      }
      if (parsed.pathname === "/trade-api/v2/markets") {
        return new Response(JSON.stringify({
          markets: [{
            ticker: "KXTEST-26JAN01-T50",
            title: "Will the test market close above 50?",
            subtitle: "Unit test market",
            event_ticker: "KXTEST-26JAN01",
            series_ticker: "KXTEST",
            category: "Testing",
            status: "open",
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected route" }), { status: 404 });
    },
  });

  const summary = await provider.portfolioSummary();
  assert.match(summary.plainEnglish, /Cash balance is \$123\.45/);
  assert.match(summary.latestBet.plainEnglish, /Will the test market close above 50/);
  assert.match(summary.bestPosition.plainEnglish, /Will the test market close above 50/);
  assert.equal(summary.latestBet.priceLabel, "42¢");
  assert.equal(summary.bestPosition.marketTitle, "Will the test market close above 50?");
});
