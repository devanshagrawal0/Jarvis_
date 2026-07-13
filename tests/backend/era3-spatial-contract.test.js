const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function source(file) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

test("Era III spatial shell supports persistent independent widget windows without permanent UI strips", () => {
  const frame = source("src/globe-room/SpatialWidgetFrame.tsx");
  const strip = source("src/globe-room/WidgetStrip.tsx");
  const css = source("src/globe-room/SpatialWorkspace.css");
  assert.match(frame, /"minimized" \| "normal" \| "expanded"/);
  assert.match(frame, /bindPointer/);
  assert.match(frame, /spatial-widget-resize/);
  assert.match(strip, /jarvis\.spatial-widgets\.v1/);
  assert.match(strip, /mode !== "minimized"/);
  assert.match(strip, /__state: "stale"/);
  assert.doesNotMatch(strip, /className="spatial-toolbar"/);
  assert.doesNotMatch(strip, /className="spatial-dock"/);
  assert.match(strip, /case "kalshi":\s+return <KalshiExpanded/);
  assert.match(css, /backdrop-filter:\s*none/);
  assert.match(css, /min-width:\s*2200px/);
});

test("Device Mesh command center exposes the complete operating surface", () => {
  const mesh = source("src/globe-room/DeviceMeshCommandCenter.tsx");
  for (const label of ["Mesh", "Pair", "Portal", "Screen", "Co-op", "Security"]) assert.match(mesh, new RegExp(`"${label}"`));
  for (const endpoint of [
    "/api/device-mesh/status", "/api/pair", "/api/device-mesh/live/start",
    "/api/device-mesh/control/approve", "/api/device-mesh/control/deny", "/api/device-mesh/sandbox/start",
    "/api/coop-symbiote/session/create", "/api/coop-symbiote/chat",
    "/api/coop-symbiote/tasks", "/api/emergency-stop",
  ]) assert.match(mesh, new RegExp(endpoint.replaceAll("/", "\\/")));
});

test("Graph and Vision widgets are backed by real memory and mesh services", () => {
  const strip = source("src/globe-room/WidgetStrip.tsx");
  const centers = source("src/globe-room/IntelligenceCommandCenters.tsx");
  assert.match(strip, /\/api\/memory\/life-graph\?limit=120/);
  assert.match(strip, /\/api\/device-mesh\/status/);
  assert.match(strip, /GraphCommandCenter/);
  assert.match(strip, /VisionCommandCenter/);
  assert.match(centers, /\/api\/device-mesh\/screen/);
  assert.match(centers, /jarvis:command/);
  assert.match(centers, /Export graph/);
});
