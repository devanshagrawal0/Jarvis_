import { expect, test } from "@playwright/test";

test("pair QR payload exposes diagnostics and does not prefer localhost when public URLs exist", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stablePhoneUrl: "https://devansh-jarvis.example.workers.dev",
        webhookBaseUrl: "https://devansh-jarvis.trycloudflare.com",
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  });

  const pair = await page.evaluate(async () => {
    const response = await fetch("/api/pair");
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });

  expect(pair.preferredPairUrl).toContain("https://devansh-jarvis.example.workers.dev/mesh/pair");
  expect(pair.diagnostics.selectedUrl).toBe("https://devansh-jarvis.example.workers.dev");
  expect(pair.candidates.some((candidate: { baseUrl: string; pairable: boolean }) => candidate.baseUrl.includes("127.0.0.1") && !candidate.pairable)).toBe(true);
  expect(pair.candidates.some((candidate: { baseUrl: string; pairable: boolean }) => candidate.baseUrl.includes("workers.dev") && candidate.pairable)).toBe(true);
  expect(pair.qrDataUrl).toMatch(/^data:image\/png;base64,/);
});
