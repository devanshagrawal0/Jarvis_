import { expect, test } from "@playwright/test";

async function createPairCode(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/pair");
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ pairing: { code: string } }>;
  });
}

test("pairing request does not issue a token until the laptop approves it", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const pair = await createPairCode(page);

  const claim = await page.evaluate(async (code) => {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Security test phone",
        kind: "phone",
        role: "phone",
        trustLevel: "laptop_admin",
        permissions: { approveActions: true, screenControlExecute: true },
      }),
    });
    return { status: response.status, body: await response.json() };
  }, pair.pairing.code);

  expect(claim.status).toBe(202);
  expect(claim.body.accessToken || "").toBe("");
  expect(claim.body.device.approved).toBe(false);
  expect(claim.body.device.trustLevel).toBe("upload_only");
  expect(claim.body.device.permissions.approveActions).toBeFalsy();

  const statusBeforeApproval = await page.evaluate(async (requestId) => {
    const response = await fetch(`/api/pair/status?requestId=${encodeURIComponent(requestId)}`);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, claim.body.requestId);
  expect(statusBeforeApproval.status).toBe("claimed_pending_approval");
  expect(statusBeforeApproval.accessToken || "").toBe("");

  const approved = await page.evaluate(async (requestId) => {
    const response = await fetch("/api/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, trustLevel: "screen_view", actor: "security-test-laptop" }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, claim.body.requestId);
  expect(approved.accessToken).toMatch(/^jarvis_device_/);
  expect(approved.device.trustLevel).toBe("screen_view");
  expect(approved.device.permissions.approveActions).toBeFalsy();
});
