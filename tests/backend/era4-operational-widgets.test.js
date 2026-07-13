const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("Era IV Projects console uses real workspace health and actions", () => {
  const source = read("src/globe-room/OperationalCommandCenters.tsx");
  assert.match(source, /Project Operations/);
  assert.match(source, /Indexed files/);
  assert.match(source, /Git repos/);
  assert.match(source, /README/);
  assert.match(source, /\/api\/projects\/open/);
  assert.match(source, /Set context/);
});

test("Era IV Agents console unifies specialists and both mission substrates", () => {
  const strip = read("src/globe-room/WidgetStrip.tsx");
  const source = read("src/globe-room/OperationalCommandCenters.tsx");
  assert.match(strip, /\/api\/agents\/missions\?limit=100/);
  assert.match(strip, /\/api\/missions/);
  assert.match(strip, /durableMissions/);
  assert.match(strip, /deployableMissions/);
  assert.match(source, /Mission Control/);
  assert.match(source, /Execution plan/);
  assert.match(source, /\/api\/missions\/\$\{encodeURIComponent\(selected\.id\)\}\/\$\{action\}/);
  assert.match(source, /Deploy via Jarvis/);
});

test("Era IV Modules console exposes readiness, blockers, providers, and launch routing", () => {
  const source = read("src/globe-room/OperationalCommandCenters.tsx");
  assert.match(source, /Module Console/);
  assert.match(source, /Capability registry/);
  assert.match(source, /missingProviders/);
  assert.match(source, /blockedReason/);
  assert.match(source, /VIEW_WIDGET/);
  assert.match(source, /Launch module/);
});

test("spatial child controls are not interrupted by container focus rerenders", () => {
  const frame = read("src/globe-room/SpatialWidgetFrame.tsx");
  const section = frame.slice(frame.indexOf("<section"), frame.indexOf("<header"));
  assert.doesNotMatch(section, /onPointerDown=\{onFocus\}/);
  assert.match(frame, /className="spatial-widget-header"/);
});

test("Era IV Connections console separates live, configured, and blocked providers", () => {
  const source = read("src/globe-room/AssuranceCommandCenters.tsx");
  assert.match(source, /Connection Operations/);
  assert.match(source, /Average latency/);
  assert.match(source, /Action needed/);
  assert.match(source, /lastRequestAt/);
  assert.match(source, /missing/);
  assert.match(source, /Diagnose with Jarvis/);
});

test("Era IV Trust console joins principal, devices, confirmations, and invariants", () => {
  const strip = read("src/globe-room/WidgetStrip.tsx");
  const source = read("src/globe-room/AssuranceCommandCenters.tsx");
  assert.match(strip, /\/api\/security\/trust/);
  assert.match(strip, /\/api\/confirmations\/pending/);
  assert.match(strip, /\/api\/devices/);
  assert.match(source, /Trust & Authority/);
  assert.match(source, /Owner approval queue/);
  assert.match(source, /Security invariants/);
  assert.match(source, /Deny by default/);
});

test("Era IV Receipts console is a queryable evidence ledger", () => {
  const source = read("src/globe-room/AssuranceCommandCenters.tsx");
  assert.match(source, /Receipt Explorer/);
  assert.match(source, />Export<\/button>/);
  assert.match(source, /verification/);
  assert.match(source, /risk/);
  assert.match(source, /Ask Jarvis/);
  assert.match(source, /Download receipt/);
});

test("removed global spatial chrome stays removed", () => {
  const strip = read("src/globe-room/WidgetStrip.tsx");
  assert.doesNotMatch(strip, /className="spatial-toolbar"/);
  assert.doesNotMatch(strip, /className="spatial-dock"/);
});

test("Era IV Profile console exposes verified context and model economics", () => {
  const source = read("src/globe-room/PersonalCommandCenters.tsx");
  assert.match(source, /OWNER CONTEXT PLANE/);
  assert.match(source, /Context coverage/);
  assert.match(source, /Model consumption/);
  assert.match(source, /Optimize model routing/);
  assert.match(source, /distinguish verified facts from missing information/);
});

test("Era IV Weather console converts the available forecast into planning signals", () => {
  const source = read("src/globe-room/PersonalCommandCenters.tsx");
  assert.match(source, /LOCAL ENVIRONMENT/);
  assert.match(source, /Four-day trajectory/);
  assert.match(source, /Heat risk/);
  assert.match(source, /Highest listed precipitation probability/);
  assert.match(source, /Plan my day/);
});

test("Era IV Vitals console does not misrepresent Windows load average", () => {
  const source = read("src/globe-room/PersonalCommandCenters.tsx");
  assert.match(source, /SYSTEM OBSERVABILITY/);
  assert.match(source, /Memory pressure/);
  assert.match(source, /Windows does not expose Unix load1/);
  assert.match(source, /Do not claim CPU health from a Windows load average of zero/);
  assert.match(source, /Build runbook/);
});

test("Era IV Memory Observatory joins canonical objects, semantic memory, and continuity", () => {
  const strip = read("src/globe-room/WidgetStrip.tsx");
  const source = read("src/globe-room/MemoryCommandCenter.tsx");
  assert.match(strip, /\/api\/memory-os\/v4\/status/);
  assert.match(strip, /\/api\/memory-os\/v4\/objects\?limit=100/);
  assert.match(strip, /\/api\/neural-vault\/status/);
  assert.match(strip, /\/api\/neural-vault\/continuity/);
  assert.match(source, /Memory Observatory/);
  assert.match(source, /Relationship graph/);
  assert.match(source, /Use as Jarvis context/);
  assert.match(source, /\/api\/memory-os\/v4\/storage-trace/);
});

test("widget commands enter the real JARVIS streaming submission pipeline once", () => {
  const shell = read("src/JarvisUI.tsx");
  const bar = read("src/globe-room/JarvisCommandBar.tsx");
  assert.match(shell, /addEventListener\("jarvis:command", handleWidgetCommand\)/);
  assert.match(shell, /void handleSubmit\(text/);
  assert.match(bar, /if \(onSubmit\) onSubmit\(value, files\)/);
  assert.match(bar, /else document\.dispatchEvent/);
});

test("spatial refreshes are deduplicated per widget", () => {
  const strip = read("src/globe-room/WidgetStrip.tsx");
  assert.match(strip, /inFlightRef = useRef<Set<string>>/);
  assert.match(strip, /if \(inFlightRef\.current\.has\(id\)\) return/);
  assert.match(strip, /inFlightRef\.current\.delete\(id\)/);
});
