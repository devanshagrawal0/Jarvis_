import { expect, test } from "@playwright/test";

test("Jarvis visual-test mode reaches a deterministic capture-ready state", async ({ page }) => {
  await page.setViewportSize({ width: 1402, height: 1122 });
  await page.goto("/?visualTest=1", { waitUntil: "networkidle" });
  await page.waitForSelector('[data-visual-ready="true"]');

  const state = await page.evaluate(() => ({
    mode: document.querySelector(".hud-shell")?.getAttribute("data-mode"),
    ready: document.querySelector("[data-visual-ready='true']") !== null,
    width: window.innerWidth,
    height: window.innerHeight,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    hasForbiddenCoreLabel: ["CORE ONLINE", "CORE COLOR", "JARVIS CORE"].some((label) => document.body.innerText.includes(label))
  }));

  expect(state.ready).toBe(true);
  expect(state.width).toBe(1402);
  expect(state.height).toBe(1122);
  expect(state.overflowX).toBe(0);
  expect(state.hasForbiddenCoreLabel).toBe(false);
});
