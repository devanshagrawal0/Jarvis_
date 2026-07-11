import { expect, test } from "@playwright/test";

test("live screen start, frame, pause, and stop return explicit stream status", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const started = await page.evaluate(async () => {
    const response = await fetch("/api/device-mesh/live/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quality: "balanced", targetFps: 1 }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  expect(started.status).toBe("started");
  expect(started.mesh.liveScreen.active).toBe(true);

  const frame = await page.evaluate(async () => {
    const response = await fetch("/api/device-mesh/live/frame");
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  expect(frame.status).toBe("frame");
  expect(frame.frameUrl).toMatch(/^\/api\/device-mesh\/screen\//);
  expect(frame.frameId).toMatch(/^frame_/);
  expect(frame.dimensions).toMatch(/\d+x\d+/);
  expect(frame.capturedAt).toBeTruthy();

  const paused = await page.evaluate(async () => {
    const response = await fetch("/api/device-mesh/live/pause", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  expect(paused.status).toBe("paused");

  const stopped = await page.evaluate(async () => {
    const response = await fetch("/api/device-mesh/live/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  });
  expect(stopped.status).toBe("stopped");
  expect(stopped.mesh.liveScreen.active).toBe(false);
});
