import { expect, test } from "@playwright/test";

test("phone control events require a baton and return execution receipts after approval", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const pair = await page.evaluate(async () => {
    const response = await fetch("/api/pair");
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<{ pairing: { code: string } }>;
  });
  const claim = await page.evaluate(async (code) => {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Control test phone", kind: "phone", role: "phone", capabilities: ["requestLaptopScreen"] }),
    });
    if (response.status !== 202) throw new Error(await response.text());
    return response.json();
  }, pair.pairing.code);
  const approved = await page.evaluate(async (requestId) => {
    const response = await fetch("/api/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, trustLevel: "screen_control_prepare", actor: "control-test-laptop" }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, claim.requestId);

  const rejected = await page.evaluate(async (token) => {
    const response = await fetch("/api/device-mesh/control/event", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "type", text: "avery shut up" }),
    });
    return { status: response.status, body: await response.json() };
  }, approved.accessToken);
  expect(rejected.status).toBe(403);
  expect(rejected.body.error).toMatch(/control baton/i);

  const requested = await page.evaluate(async (token) => {
    const response = await fetch("/api/device-mesh/control/request", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: "Automated baton test", durationSeconds: 60 }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, approved.accessToken);
  expect(requested.mesh.controlBaton.status).toBe("requested");

  await page.evaluate(async (deviceId) => {
    const response = await fetch("/api/device-mesh/control/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, durationSeconds: 60 }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, claim.requestId);

  const event = await page.evaluate(async (token) => {
    const response = await fetch("/api/device-mesh/control/event", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "type", text: "avery shut up" }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, approved.accessToken);
  expect(event.accepted).toBe(true);
  expect(event.dryRun).toBe(true);
  expect(event.executed).toBe(false);
  expect(event.toolUsed).toBe("desktop_control");
  expect(event.control.text).toBe("avery shut up");
  expect(event.eventId).toMatch(/^ctrl_/);
});
