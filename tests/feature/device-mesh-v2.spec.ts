import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

type PairResponse = {
  pairing: { code: string; expiresAt: string };
  qrDataUrl: string;
  preferredPairUrl: string;
};

type ClaimResponse = {
  requestId: string;
  accessToken?: string;
  device: { id: string; name: string; approved: boolean; status: string };
};

type ApproveResponse = {
  accessToken: string;
  device: { id: string; name: string; approved: boolean; trustLevel: string };
};

test("Device Mesh v2 UI covers pairing, live screen streaming, control, media inbox, and memory trace", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?tool=devices", { waitUntil: "networkidle" });

  const sheet = page.getByRole("complementary", { name: "devices panel" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Device Constellation");
  await expect(sheet).toContainText("Connection Guide");
  await expect(sheet).toContainText("Live Screen Panel");
  await expect(sheet).toContainText("Control Center");
  await expect(sheet).toContainText("Permission Reactor");
  await expect(sheet).toContainText("Phone Sensor Dock");
  await expect(sheet).toContainText("Photo / Media Inbox");
  await expect(sheet).toContainText("Mesh Tools Panel");
  await expect(sheet).toContainText("Mesh Memory Trace");
  await expect(sheet).toContainText("Replay Theater");

  await sheet.getByRole("button", { name: /Create pair link/i }).click();
  await expect(sheet.locator(".pair-qr")).toBeVisible();
  await expect(sheet.locator(".pair-qr")).toHaveAttribute("src", /^data:image\/png;base64,/);
  const pairCode = (await sheet.locator("article.provider-row strong").filter({ hasText: /^\d{6}$/ }).first().textContent())?.trim();
  expect(pairCode).toMatch(/^\d{6}$/);

  const claimed = await page.evaluate(async (code) => {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Playwright Phone",
        kind: "phone",
        role: "phone",
        trustLevel: "screen_view",
        capabilities: ["chat", "uploadFiles", "phoneCameraUpload", "requestLaptopScreen"],
      }),
    });
    if (response.status !== 202) throw new Error(await response.text());
    return response.json() as Promise<ClaimResponse>;
  }, pairCode!);
  expect(claimed.accessToken || "").toBe("");
  expect(claimed.device.approved).toBe(false);
  expect(claimed.device.status).toBe("claimed_pending_approval");

  const approved = await page.evaluate(async (requestId) => {
    const response = await fetch("/api/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, trustLevel: "screen_control_prepare", actor: "playwright-laptop" }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<ApproveResponse>;
  }, claimed.requestId);
  expect(approved.accessToken).toMatch(/^jarvis_device_/);
  expect(approved.device.approved).toBe(true);

  await sheet.locator("input[type='file']").setInputFiles({
    name: "phone-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Device Mesh v2 UI upload test"),
  });
  await expect(sheet).toContainText("phone-note.txt", { timeout: 15_000 });

  const objectResult = await page.evaluate(async (token) => {
    const response = await fetch("/api/device-mesh/objects", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: "link",
        name: "Playwright phone link",
        link: "https://example.com/device-mesh-v2",
        summary: "Link sent from the simulated phone during Device Mesh v2 UI testing.",
      }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, approved.accessToken);
  expect(objectResult.object.id).toBeTruthy();

  const phoneRequest = await page.evaluate(async (token) => {
    const response = await fetch("/api/device-mesh/control/request", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: "Playwright phone wants trackpad control", durationSeconds: 90 }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, approved.accessToken);
  expect(phoneRequest.mesh.controlBaton.status).toBe("requested");

  await sheet.getByRole("button", { name: /^Refresh$/ }).click();
  await expect(sheet).toContainText("Playwright Phone", { timeout: 10_000 });
  await expect(sheet).toContainText("Playwright phone wants trackpad control");

  const liveSection = sheet.locator("section.module-section").filter({ hasText: "Live Screen Panel" });
  await liveSection.getByRole("button", { name: "Start" }).click();
  await expect(sheet).toContainText("Live frame refreshed", { timeout: 30_000 });
  await expect(liveSection.locator("img[alt='Live laptop screen frame']")).toBeVisible({ timeout: 30_000 });
  await liveSection.getByRole("button", { name: "Frame" }).click();
  await expect(sheet).toContainText(/Live frame refreshed|Live screen is paused/);
  await liveSection.getByRole("button", { name: "Stop" }).click();
  await expect(sheet).toContainText("Live screen stopped", { timeout: 10_000 });

  const controlSection = sheet.locator("section.module-section").filter({ hasText: "Control Center" });
  await controlSection.getByRole("button", { name: "Approve" }).click();
  await expect(sheet).toContainText("Laptop control approved", { timeout: 10_000 });
  await expect(controlSection).toContainText("approved");
  await controlSection.getByRole("button", { name: "Type test" }).click();
  await expect(sheet).toContainText("Control event executed", { timeout: 10_000 });
  await controlSection.getByRole("button", { name: "Emergency stop" }).click();
  await expect(sheet).toContainText("Emergency stop active", { timeout: 10_000 });

  const memory = await page.evaluate(async () => {
    const response = await fetch("/api/device-mesh/memory");
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  expect(memory.inboxItems.length).toBeGreaterThanOrEqual(2);
  expect(memory.permissions.some((item: { status: string }) => item.status === "granted" || item.status === "requested")).toBe(true);
  expect(memory.storage.tables).toContain("mesh_control_events");

  await sheet.getByRole("button", { name: /^Refresh$/ }).click();
  await expect(sheet).toContainText("Playwright phone link");
  await expect(sheet).toContainText("ScreenStreamManager");
  await expect(sheet).toContainText("ControlBatonManager");

  const outputDir = path.resolve("output", "playwright");
  fs.mkdirSync(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, "device-mesh-v2-cockpit.png"), fullPage: true });
});

test("Device Mesh live/control APIs reject unsafe control until a baton exists", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const start = await fetch("/api/device-mesh/live/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quality: "balanced" }),
    });
    if (!start.ok) throw new Error(await start.text());
    const stop = await fetch("/api/device-mesh/live/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!stop.ok) throw new Error(await stop.text());
  });
  const pair = await page.evaluate(async () => {
    const response = await fetch("/api/pair");
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<PairResponse>;
  });
  expect(pair.qrDataUrl).toMatch(/^data:image\/png;base64,/);

  const claimed = await page.evaluate(async (code) => {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Rejected Control Phone", kind: "phone", role: "phone", trustLevel: "screen_view" }),
    });
    if (response.status !== 202) throw new Error(await response.text());
    return response.json() as Promise<ClaimResponse>;
  }, pair.pairing.code);
  const approved = await page.evaluate(async (requestId) => {
    const response = await fetch("/api/pair/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, trustLevel: "screen_view", actor: "playwright-laptop" }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<ApproveResponse>;
  }, claimed.requestId);

  const rejected = await page.evaluate(async (token) => {
    const response = await fetch("/api/device-mesh/control/event", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "hotkey", hotkey: "escape" }),
    });
    return { status: response.status, body: await response.json() };
  }, approved.accessToken);
  expect(rejected.status).toBe(403);
  expect(rejected.body.error).toMatch(/control baton/i);
});
