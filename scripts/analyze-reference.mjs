import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const REFERENCE = path.join(ROOT, "design", "reference", "jarvis-ui-reference.png");
const GENERATED = path.join(ROOT, "design", "generated");
const WIDTH = 1402;
const HEIGHT = 1122;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function normalizedBox(box) {
  return {
    ...box,
    normalized: {
      x: Number((box.x / WIDTH).toFixed(6)),
      y: Number((box.y / HEIGHT).toFixed(6)),
      width: Number((box.width / WIDTH).toFixed(6)),
      height: Number((box.height / HEIGHT).toFixed(6))
    }
  };
}

function defaultRegions() {
  return [
    ["background", 0, 0, WIDTH, HEIGHT],
    ["topTelemetry", 360, 32, 690, 68],
    ["leftUpperPanel", 58, 88, 292, 310],
    ["leftMiddlePanel", 56, 412, 294, 348],
    ["leftLowerPanel", 57, 777, 292, 156],
    ["centralOuterGeometry", 345, 159, 695, 743],
    ["centralReactor", 613, 437, 185, 221],
    ["centralMicroDetails", 414, 252, 579, 550],
    ["rightTargetPanel", 1039, 93, 302, 174],
    ["rightThreatPanel", 1040, 284, 302, 151],
    ["rightFleetPanel", 1039, 446, 303, 214],
    ["rightEnvironmentPanel", 1040, 680, 303, 135],
    ["rightTimePanel", 1041, 834, 301, 122],
    ["bottomNavigation", 54, 1038, 1290, 62],
    ["foregroundAtmosphere", 0, 0, WIDTH, HEIGHT]
  ].map(([id, x, y, width, height]) => normalizedBox({ id, x, y, width, height }));
}

function pickGuides(values, count, minDistance) {
  const indexed = values.map((score, index) => ({ index, score }));
  indexed.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const item of indexed) {
    if (chosen.every((hit) => Math.abs(hit.index - item.index) >= minDistance)) {
      chosen.push(item);
      if (chosen.length >= count) break;
    }
  }
  return chosen.sort((a, b) => a.index - b.index).map((item) => ({
    pixel: item.index,
    normalized: Number((item.index / (values.length - 1)).toFixed(6)),
    score: Number(item.score.toFixed(4))
  }));
}

function boundingBox(points) {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return normalizedBox({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
}

async function main() {
  ensureDir(GENERATED);
  if (!fs.existsSync(REFERENCE)) {
    throw new Error(`Missing reference image: ${REFERENCE}`);
  }

  const image = sharp(REFERENCE).ensureAlpha();
  const metadata = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (info.width !== WIDTH || info.height !== HEIGHT) {
    throw new Error(`Reference must be ${WIDTH}x${HEIGHT}; got ${info.width}x${info.height}`);
  }

  const paletteBins = new Map();
  const brightnessBuckets = Array.from({ length: 16 }, () => 0);
  const rowScores = new Float64Array(HEIGHT);
  const colScores = new Float64Array(WIDTH);
  const highLuminance = [];
  const redPixels = [];
  const centerCandidates = [];
  let totalLum = 0;
  let nearBlack = 0;
  let mutedBlueGray = 0;
  let structuralCyan = 0;
  let redCount = 0;

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const lum = luminance(r, g, b);
      totalLum += lum;
      brightnessBuckets[Math.min(15, Math.floor(lum / 16))] += 1;
      rowScores[y] += lum;
      colScores[x] += lum;

      const key = `${Math.round(r / 16) * 16},${Math.round(g / 16) * 16},${Math.round(b / 16) * 16}`;
      paletteBins.set(key, (paletteBins.get(key) || 0) + 1);

      if (lum < 18) nearBlack += 1;
      if (lum >= 18 && lum < 55 && b >= r && g >= r) mutedBlueGray += 1;
      if (lum >= 55 && b >= r && g >= r) structuralCyan += 1;
      if (r > 70 && r > g * 1.45 && r > b * 1.35) {
        redCount += 1;
        redPixels.push({ x, y });
      }
      if (lum > 130) highLuminance.push({ x, y });
      if (x > WIDTH * 0.38 && x < WIDTH * 0.62 && y > HEIGHT * 0.32 && y < HEIGHT * 0.65 && lum > 80) {
        centerCandidates.push({ x, y, lum });
      }
    }
  }

  const pixelCount = WIDTH * HEIGHT;
  const dominantColors = Array.from(paletteBins.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([rgb, count]) => {
      const [r, g, b] = rgb.split(",").map(Number);
      return {
        rgb: [r, g, b],
        hex: `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
        count,
        percent: Number(((count / pixelCount) * 100).toFixed(4))
      };
    });

  const weightedCenter = centerCandidates.reduce((acc, point) => {
    acc.x += point.x * point.lum;
    acc.y += point.y * point.lum;
    acc.weight += point.lum;
    return acc;
  }, { x: 0, y: 0, weight: 0 });
  const cx = weightedCenter.weight ? weightedCenter.x / weightedCenter.weight : WIDTH / 2;
  const cy = weightedCenter.weight ? weightedCenter.y / weightedCenter.weight : HEIGHT / 2;

  const analysis = {
    source: path.relative(ROOT, REFERENCE).replaceAll("\\", "/"),
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    meanLuminance: Number((totalLum / pixelCount).toFixed(4)),
    visualBalance: {
      nearBlackPercent: Number(((nearBlack / pixelCount) * 100).toFixed(4)),
      mutedBlueGrayPercent: Number(((mutedBlueGray / pixelCount) * 100).toFixed(4)),
      cyanStructurePercent: Number(((structuralCyan / pixelCount) * 100).toFixed(4)),
      redAccentPercent: Number(((redCount / pixelCount) * 100).toFixed(4))
    },
    brightnessDistribution: brightnessBuckets.map((count, index) => ({
      range: [index * 16, index === 15 ? 255 : index * 16 + 15],
      count,
      percent: Number(((count / pixelCount) * 100).toFixed(4))
    })),
    majorHorizontalGuides: pickGuides(Array.from(rowScores, (value) => value / WIDTH), 18, 24),
    majorVerticalGuides: pickGuides(Array.from(colScores, (value) => value / HEIGHT), 18, 24),
    circularHudCenter: {
      x: Number(cx.toFixed(2)),
      y: Number(cy.toFixed(2)),
      normalizedX: Number((cx / WIDTH).toFixed(6)),
      normalizedY: Number((cy / HEIGHT).toFixed(6))
    },
    estimatedRingRadii: [62, 88, 118, 156, 220, 292, 356].map((radius) => ({
      radius,
      normalized: Number((radius / Math.min(WIDTH, HEIGHT)).toFixed(6))
    })),
    highLuminanceBounds: boundingBox(highLuminance),
    redAccentBounds: boundingBox(redPixels),
    panelPerspectiveDirection: {
      left: "inward-right, top edge recedes slightly",
      right: "inward-left, top edge recedes slightly"
    },
    textDensityZones: defaultRegions().filter((region) => region.id.includes("Panel") || region.id.includes("Telemetry") || region.id.includes("Navigation")),
    atmosphericParticleDensityZones: [
      normalizedBox({ id: "upperLeftAtmosphere", x: 20, y: 0, width: 400, height: 260 }),
      normalizedBox({ id: "upperRightAtmosphere", x: 1030, y: 0, width: 330, height: 260 }),
      normalizedBox({ id: "lowerDepthHaze", x: 360, y: 865, width: 650, height: 220 })
    ]
  };

  const palette = {
    dominantColors,
    tokens: {
      "background.deep": dominantColors[0]?.hex || "#000000",
      "background.surface": "#02090d",
      "background.haze": "#0a1d25",
      "line.ghost": "#12313a",
      "line.muted": "#2b6878",
      "line.standard": "#6aaec1",
      "line.highlight": "#d7f7ff",
      "text.ghost": "#456f7b",
      "text.secondary": "#7caebe",
      "text.primary": "#c8eef7",
      "cyan.dim": "#2a8197",
      "cyan.bright": "#b9efff",
      "white.core": "#f8fdff",
      "red.warning": "#8f2730",
      "red.critical": "#ef3c42"
    }
  };

  const regions = { width: WIDTH, height: HEIGHT, regions: defaultRegions() };

  fs.writeFileSync(path.join(GENERATED, "reference-analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`);
  fs.writeFileSync(path.join(GENERATED, "reference-palette.json"), `${JSON.stringify(palette, null, 2)}\n`);
  fs.writeFileSync(path.join(GENERATED, "reference-regions.json"), `${JSON.stringify(regions, null, 2)}\n`);
  console.log(JSON.stringify({
    width: analysis.width,
    height: analysis.height,
    meanLuminance: analysis.meanLuminance,
    center: analysis.circularHudCenter,
    visualBalance: analysis.visualBalance,
    generated: [
      "design/generated/reference-analysis.json",
      "design/generated/reference-palette.json",
      "design/generated/reference-regions.json"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
