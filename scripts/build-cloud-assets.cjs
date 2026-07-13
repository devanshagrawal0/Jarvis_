const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "dist");
const target = path.join(root, "dist-cloud");
const cloudExcluded = new Set([
  "jarvis_globe_room.glb",
  "assets/helix-transition.mp4",
  "globe-room/floor_bake.png",
]);
const maxAssetBytes = 25 * 1024 * 1024;

if (!fs.existsSync(source)) throw new Error("dist is missing; run the Vite build first");
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, {
  recursive: true,
  filter(from) {
    const relative = path.relative(source, from).replace(/\\/g, "/");
    return !cloudExcluded.has(relative);
  },
});

const oversized = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (entry.isFile() && fs.statSync(full).size > maxAssetBytes) oversized.push(path.relative(target, full));
  }
}
scan(target);
if (oversized.length) throw new Error(`Cloud assets exceed 25 MiB: ${oversized.join(", ")}`);

console.log(`[cloud-assets] ready: ${target}`);
console.log(`[cloud-assets] excluded local-only assets: ${[...cloudExcluded].join(", ")}`);
