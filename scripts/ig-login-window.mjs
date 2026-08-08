// One-time manual Instagram login in the Jarvis browser.
//
// Opens the real, persistent browser profile in a VISIBLE window at Instagram's login. Dev logs in
// normally (types the password, clears any "was this you?"), exactly like a human — which is the
// session Instagram trusts. The cookies persist in the profile, so the headless backend uses the
// same logged-in session afterwards. Jarvis never types the password; Dev does, once.
//
// It watches for a successful login (a sessionid cookie + off the login page) and exits, so nothing
// has to be timed by hand.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const path = require("node:path");

const profileDir = path.join(process.cwd(), "runtime", "browser-profile");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1100, height: 820 },
});

try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("LOGIN_WINDOW_OPEN — a browser window is open. Log into Instagram there.");

  let loggedIn = false;
  for (let i = 0; i < 210; i += 1) { // ~7 minutes at 2s
    await sleep(2000);
    let sid = null;
    let url = "";
    try {
      const cookies = await context.cookies("https://www.instagram.com");
      sid = cookies.find((c) => c.name === "sessionid" && c.value);
      url = page.url();
    } catch { /* page navigating; try again next tick */ }
    if (sid && !/accounts\/login/.test(String(url))) { loggedIn = true; break; }
  }

  console.log(loggedIn ? "LOGGED_IN — session saved to the browser profile." : "LOGIN_TIMEOUT — no login detected.");
} finally {
  await context.close().catch(() => {});
}
