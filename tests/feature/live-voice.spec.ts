import { expect, test } from "@playwright/test";

test("Talk uses a server-issued Live token when configured and fails honestly when it is not", async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.goto("/", { waitUntil: "networkidle" });
  const settings = await (await request.get("/api/settings")).json();
  const statusPromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/voice/status") && response.request().method() === "GET"
  );
  const tokenPromise = settings.hasGeminiKey
    ? page.waitForResponse((response) =>
        response.url().endsWith("/api/live/token") && response.request().method() === "POST"
      )
    : null;
  await page.locator(".command-bar .voice").click();
  const statusResponse = await statusPromise;
  expect(statusResponse.status()).toBe(200);
  const voiceStatus = await statusResponse.json();
  if (settings.hasGeminiKey) {
    const tokenResponse = await tokenPromise!;
    expect(tokenResponse.status()).toBe(201);
    const token = await tokenResponse.json();
    expect(token.token).toMatch(/^auth_tokens\//);
    expect(token.model).toMatch(/native-audio|live/i);
  } else {
    expect(voiceStatus.status).toBe("needs_gemini_key");
  }

  await expect.poll(async () =>
    page.evaluate(() => navigator.mediaDevices.enumerateDevices().then((devices) => devices.some((device) => device.kind === "audioinput")))
  ).toBe(true);

  if (settings.hasGeminiKey) await page.locator(".command-bar .voice").click();
  await expect(page.locator(".simple-shell")).toBeVisible();
});
