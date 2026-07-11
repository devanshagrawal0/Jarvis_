import { expect, test } from "@playwright/test";

test("minimal shell loads with a circular core, conversation, tools, and masked settings", async ({ page, request }) => {
  const settingsResponse = await request.get("/api/settings");
  expect(settingsResponse.ok()).toBeTruthy();
  const settings = await settingsResponse.json();
  expect(settings.providers).toBeTruthy();
  expect(settings.geminiKey).toBeUndefined();
  expect(settings.googleClientSecret).toBeUndefined();
  expect(settings.kalshiPrivateKey).toBeUndefined();

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator(".simple-shell")).toBeVisible();
  await expect(page.locator(".jarvis-core")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask Jarvis" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Jarvis tools" })).toBeVisible();
  await expect(page.locator(".conversation")).toContainText("sir");
  await expect(page.getByRole("button", { name: "Today's briefing" })).toBeVisible();
  await expect(page.locator(".workspace-window")).toHaveCount(0);
});

test("module sheet exposes the full catalog, apps, URLs, and executable capabilities", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Modules" }).click();
  const sheet = page.getByRole("complementary", { name: "modules panel" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/\d+ modules/);
  await expect(sheet).toContainText(/\d+ executable capabilities/);
  await expect(sheet.getByPlaceholder("Search every Jarvis function")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "calculator" })).toBeVisible();
  await expect(sheet.getByPlaceholder("example.com or https://...")).toBeVisible();
  await expect(sheet).toContainText("open url");
  await expect(sheet).toContainText("codebase search");
  await expect(sheet).toContainText("jarvis self inspect");
  await expect(sheet).toContainText("Jarvis Conversation");
  await expect(sheet).toContainText(/adapter registered/i);
});

test("typed conversation reaches Jarvis and renders a real response", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const input = page.getByRole("textbox", { name: "Ask Jarvis" });
  const jarvisBefore = await page.locator(".message.jarvis").count();
  await input.fill("Remember that the minimal interface verification passed.");
  await page.getByRole("button", { name: "Send command" }).click();
  await expect(page.locator(".conversation")).toContainText("minimal interface verification");
  await expect(page.locator(".message.jarvis")).toHaveCount(jarvisBefore + 1, { timeout: 30_000 });
  await expect(input).toHaveValue("");
});

test("conversation can be exported as Markdown", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export conversation" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^jarvis-conversation-\d{4}-\d{2}-\d{2}\.md$/);
});

test("projects and Kalshi use the reusable tool sheet", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const dock = page.getByRole("navigation", { name: "Jarvis tools" });
  await dock.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("complementary", { name: "projects panel" })).toBeVisible();
  await expect(page.locator(".list-row")).not.toHaveCount(0);

  await dock.getByRole("button", { name: "Kalshi" }).click();
  await expect(page.getByRole("complementary", { name: "markets panel" })).toBeVisible();
  await expect(page.locator(".market-row")).not.toHaveCount(0, { timeout: 30_000 });
});

test("agents deploy honestly and receipts record the action", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const dock = page.getByRole("navigation", { name: "Jarvis tools" });
  await dock.getByRole("button", { name: "Agents" }).click();
  const missionInput = page.getByPlaceholder("Give an agent a mission");
  await missionInput.fill("Verify the minimal interface agent path");
  await page.getByRole("button", { name: "Deploy agent" }).click();
  await expect(page.getByRole("complementary", { name: "agents panel" })).toContainText("minimal interface agent path");
  await expect(page.locator(".mission-row")).not.toHaveCount(0);

  await dock.getByRole("button", { name: "Receipts" }).click();
  const receiptSheet = page.getByRole("complementary", { name: "receipts panel" });
  await expect(receiptSheet).toBeVisible();
  await expect(receiptSheet).toContainText("agent.deploy");
  await expect(receiptSheet).toContainText("minimal interface agent path");
});

test("connections display truthful provider states and precise blockers", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connections" }).click();
  const sheet = page.getByRole("complementary", { name: "providers panel" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Gemini Brain");
  await expect(sheet).toContainText("Google Workspace");
  await expect(sheet).toContainText("googleClientId");
  await expect(sheet).toContainText("Canvas LMS");
  await expect(sheet).toContainText("canvasBaseUrl");
});
