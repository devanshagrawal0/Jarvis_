import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const ROOT = process.cwd();
const WIDTH = 1672;
const HEIGHT = 941;
const RESULT_DIR = path.join(ROOT, "test-results", "jarvis-new");
const REFERENCE = path.join(ROOT, "design", "reference-new", "image-a-main.png");
const CURRENT = path.join(RESULT_DIR, "current.png");
const REF_COPY = path.join(RESULT_DIR, "reference.png");
const DIFF = path.join(RESULT_DIR, "difference.png");
const DIFF_ENHANCED = path.join(RESULT_DIR, "difference-enhanced.png");
const REPORT = path.join(RESULT_DIR, "visual-report.json");
const REGION_FILE = path.join(ROOT, "design", "generated", "new-reference-element-map.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function normalizedPng(file) {
  const buffer = await sharp(file)
    .resize(WIDTH, HEIGHT, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();
  return PNG.sync.read(buffer);
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
  ].map(([id, x, y, width, height]) => ({ id, x, y, width, height }));
}

function loadRegions() {
  if (!fs.existsSync(REGION_FILE)) return defaultRegions();
  const data = JSON.parse(fs.readFileSync(REGION_FILE, "utf8"));
  const rawRegions = data["image-a-main.png"]?.regions || data.regions || defaultRegions();
  return rawRegions.map((region) => ({
    id: region.id,
    x: Math.round(region.bounds?.x ?? region.x),
    y: Math.round(region.bounds?.y ?? region.y),
    width: Math.round(region.bounds?.w ?? region.width),
    height: Math.round(region.bounds?.h ?? region.height)
  }));
}

function ssimForRegion(a, b, region) {
  const c1 = 6.5025;
  const c2 = 58.5225;
  let n = 0;
  let sumA = 0;
  let sumB = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      sumA += luminance(a.data[offset], a.data[offset + 1], a.data[offset + 2]);
      sumB += luminance(b.data[offset], b.data[offset + 1], b.data[offset + 2]);
      n += 1;
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const lumA = luminance(a.data[offset], a.data[offset + 1], a.data[offset + 2]);
      const lumB = luminance(b.data[offset], b.data[offset + 1], b.data[offset + 2]);
      varianceA += (lumA - meanA) ** 2;
      varianceB += (lumB - meanB) ** 2;
      covariance += (lumA - meanA) * (lumB - meanB);
    }
  }
  varianceA /= n - 1;
  varianceB /= n - 1;
  covariance /= n - 1;
  return ((2 * meanA * meanB + c1) * (2 * covariance + c2)) / ((meanA ** 2 + meanB ** 2 + c1) * (varianceA + varianceB + c2));
}

function regionMetrics(reference, current, diffMask, region) {
  let mismatch = 0;
  let meanAbs = 0;
  let lumDiff = 0;
  let refLum = 0;
  let curLum = 0;
  let refRgb = [0, 0, 0];
  let curRgb = [0, 0, 0];
  const total = region.width * region.height;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const dr = Math.abs(reference.data[offset] - current.data[offset]);
      const dg = Math.abs(reference.data[offset + 1] - current.data[offset + 1]);
      const db = Math.abs(reference.data[offset + 2] - current.data[offset + 2]);
      const lr = luminance(reference.data[offset], reference.data[offset + 1], reference.data[offset + 2]);
      const lc = luminance(current.data[offset], current.data[offset + 1], current.data[offset + 2]);
      meanAbs += dr + dg + db;
      lumDiff += Math.abs(lr - lc);
      refLum += lr;
      curLum += lc;
      refRgb[0] += reference.data[offset];
      refRgb[1] += reference.data[offset + 1];
      refRgb[2] += reference.data[offset + 2];
      curRgb[0] += current.data[offset];
      curRgb[1] += current.data[offset + 1];
      curRgb[2] += current.data[offset + 2];
      if (diffMask[y * WIDTH + x]) mismatch += 1;
    }
  }
  return {
    id: region.id,
    bounds: region,
    mismatchedPixels: mismatch,
    mismatchPercent: Number(((mismatch / total) * 100).toFixed(4)),
    ssim: Number(ssimForRegion(reference, current, region).toFixed(6)),
    meanAbsoluteDifference: Number((meanAbs / (total * 3)).toFixed(4)),
    luminanceDifference: Number((lumDiff / total).toFixed(4)),
    referenceMeanLuminance: Number((refLum / total).toFixed(4)),
    currentMeanLuminance: Number((curLum / total).toFixed(4)),
    colorDistributionDifference: Number((refRgb.reduce((sum, value, index) => sum + Math.abs(value / total - curRgb[index] / total), 0) / 3).toFixed(4))
  };
}

function edgeDifference(reference, current) {
  let total = 0;
  let count = 0;
  for (let y = 1; y < HEIGHT - 1; y += 2) {
    for (let x = 1; x < WIDTH - 1; x += 2) {
      const idx = (yy, xx) => (yy * WIDTH + xx) * 4;
      const lumAt = (image, yy, xx) => {
        const offset = idx(yy, xx);
        return luminance(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
      };
      const refGrad = Math.abs(lumAt(reference, y, x + 1) - lumAt(reference, y, x - 1)) + Math.abs(lumAt(reference, y + 1, x) - lumAt(reference, y - 1, x));
      const curGrad = Math.abs(lumAt(current, y, x + 1) - lumAt(current, y, x - 1)) + Math.abs(lumAt(current, y + 1, x) - lumAt(current, y - 1, x));
      total += Math.abs(refGrad - curGrad);
      count += 1;
    }
  }
  return Number((total / count).toFixed(4));
}

function largestMismatchBoxes(diffMask) {
  const tile = 32;
  const boxes = [];
  for (let y = 0; y < HEIGHT; y += tile) {
    for (let x = 0; x < WIDTH; x += tile) {
      let count = 0;
      const maxY = Math.min(HEIGHT, y + tile);
      const maxX = Math.min(WIDTH, x + tile);
      for (let yy = y; yy < maxY; yy += 1) {
        for (let xx = x; xx < maxX; xx += 1) {
          if (diffMask[yy * WIDTH + xx]) count += 1;
        }
      }
      if (count > 0) {
        boxes.push({ x, y, width: maxX - x, height: maxY - y, mismatchedPixels: count, mismatchPercent: Number(((count / ((maxX - x) * (maxY - y))) * 100).toFixed(2)) });
      }
    }
  }
  return boxes.sort((a, b) => b.mismatchedPixels - a.mismatchedPixels).slice(0, 12);
}

function writeEnhancedDiff(reference, current, diffMask) {
  const output = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    const offset = i * 4;
    const hit = diffMask[i];
    const base = Math.round(luminance(reference.data[offset], reference.data[offset + 1], reference.data[offset + 2]) * 0.28);
    output.data[offset] = hit ? 255 : base;
    output.data[offset + 1] = hit ? Math.max(0, 190 - Math.abs(reference.data[offset + 1] - current.data[offset + 1])) : base;
    output.data[offset + 2] = hit ? 32 : base + 8;
    output.data[offset + 3] = 255;
  }
  fs.writeFileSync(DIFF_ENHANCED, PNG.sync.write(output));
}

async function main() {
  ensureDir(RESULT_DIR);
  if (!fs.existsSync(REFERENCE)) throw new Error(`Missing reference image: ${REFERENCE}`);
  if (!fs.existsSync(CURRENT)) throw new Error(`Missing current capture: ${CURRENT}. Run npm run visual:capture first.`);

  fs.copyFileSync(REFERENCE, REF_COPY);
  const reference = await normalizedPng(REFERENCE);
  const current = await normalizedPng(CURRENT);
  const diff = new PNG({ width: WIDTH, height: HEIGHT });
  const mismatchedPixels = pixelmatch(reference.data, current.data, diff.data, WIDTH, HEIGHT, {
    threshold: 0.12,
    includeAA: false,
    alpha: 0.18,
    diffColor: [255, 50, 50],
    aaColor: [255, 180, 0]
  });
  fs.writeFileSync(DIFF, PNG.sync.write(diff));

  const diffMask = new Uint8Array(WIDTH * HEIGHT);
  let meanAbs = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    const offset = i * 4;
    const dr = Math.abs(reference.data[offset] - current.data[offset]);
    const dg = Math.abs(reference.data[offset + 1] - current.data[offset + 1]);
    const db = Math.abs(reference.data[offset + 2] - current.data[offset + 2]);
    meanAbs += dr + dg + db;
    if (dr + dg + db > 38) diffMask[i] = 1;
  }
  writeEnhancedDiff(reference, current, diffMask);

  const regions = loadRegions();
  const regionScores = regions
    .map((region) => regionMetrics(reference, current, diffMask, region))
    .sort((a, b) => b.mismatchPercent - a.mismatchPercent);

  const report = {
    generatedAt: new Date().toISOString(),
    reference: path.relative(ROOT, REFERENCE).replaceAll("\\", "/"),
    current: path.relative(ROOT, CURRENT).replaceAll("\\", "/"),
    difference: path.relative(ROOT, DIFF).replaceAll("\\", "/"),
    differenceEnhanced: path.relative(ROOT, DIFF_ENHANCED).replaceAll("\\", "/"),
    width: WIDTH,
    height: HEIGHT,
    mismatchedPixels,
    mismatchPercent: Number(((mismatchedPixels / (WIDTH * HEIGHT)) * 100).toFixed(4)),
    ssim: Number(ssimForRegion(reference, current, { x: 0, y: 0, width: WIDTH, height: HEIGHT }).toFixed(6)),
    meanAbsoluteDifference: Number((meanAbs / (WIDTH * HEIGHT * 3)).toFixed(4)),
    edgeAlignmentDifference: edgeDifference(reference, current),
    largestMismatchBoxes: largestMismatchBoxes(diffMask),
    regions: regionScores
  };

  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Overall mismatch: ${report.mismatchPercent}%`);
  console.log(`SSIM: ${report.ssim}`);
  console.log(`Mean pixel difference: ${report.meanAbsoluteDifference}`);
  console.log("");
  console.log("Worst regions:");
  report.regions.slice(0, 5).forEach((region, index) => {
    console.log(`${index + 1}. ${region.id} - mismatch ${region.mismatchPercent}% - SSIM ${region.ssim} - luminance diff ${region.luminanceDifference}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
