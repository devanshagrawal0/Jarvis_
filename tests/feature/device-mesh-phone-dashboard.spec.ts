import { expect, test } from "@playwright/test";

test("phone pair page waits for approval and dashboard explains token state", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const pair = await page.evaluate(async () => {
    const response = await fetch("/api/pair");
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ pairing: { code: string } }>;
  });

  await page.goto(`/mesh/pair?code=${pair.pairing.code}`, { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText(/Pair with Devansh's Jarvis|Jarvis Device Mesh/);
  await expect(page.locator("body")).not.toContainText("jarvis_device_");

  await page.goto("/mesh", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toContainText(/Jarvis Phone Mesh|Device token: missing/i);
});
