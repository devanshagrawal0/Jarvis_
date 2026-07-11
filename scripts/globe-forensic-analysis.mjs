import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const RESEARCH = path.resolve(ROOT, "..", "research-vfx", "image-analysis-repos");
const OUTPUT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(ROOT, "artifacts", "globe-forensics");
const REFERENCE = path.resolve(
  ROOT,
  "..",
  "jarvis_globe_codex_package",
  "references",
  ".target-globe-crop.png"
);
const CURRENT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, ".playwright-cli", "globe-lighting-particles-final.png");

await fs.mkdir(OUTPUT, { recursive: true });

const referencePath = path.join(OUTPUT, "reference-normalized.png");
const currentPath = path.join(OUTPUT, "current-normalized.png");

await sharp(REFERENCE)
  .resize(520, 480, { fit: "fill" })
  .png()
  .toFile(referencePath);

// Register on the globe silhouette. This preserves the meaningful vertical
// pedestal offset instead of forcing the base to match.
await sharp(CURRENT)
  .resize({ width: 920, height: 518, fit: "fill" })
  .extract({ left: 200, top: 0, width: 520, height: 480 })
  .png()
  .toFile(currentPath);

const regions = {
  full: { left: 0, top: 0, width: 520, height: 480 },
  globe: { left: 118, top: 46, width: 284, height: 284 },
  globeInterior: { left: 145, top: 74, width: 230, height: 224 },
  rim: { left: 116, top: 44, width: 288, height: 290 },
  pedestal: { left: 56, top: 310, width: 408, height: 166 },
  floor: { left: 0, top: 334, width: 520, height: 146 },
  background: { left: 70, top: 0, width: 380, height: 45 }
};

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(fraction * ordered.length))];
}

function analyzeRaw(data, width, height) {
  const luminance = [];
  const saturation = [];
  let cyanPixels = 0;
  let whitePixels = 0;
  let brightPixels = 0;
  let darkPixels = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let offset = 0; offset < data.length; offset += 3) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    luminance.push(luma);
    saturation.push(sat);
    sumR += r;
    sumG += g;
    sumB += b;
    if (b > r * 1.35 && b > g * 1.08 && luma > 18) cyanPixels += 1;
    if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && luma > 100) whitePixels += 1;
    if (luma > 80) brightPixels += 1;
    if (luma < 12) darkPixels += 1;
  }
  const pixels = width * height;
  return {
    width,
    height,
    meanRgb: [sumR / pixels, sumG / pixels, sumB / pixels],
    luminance: {
      mean: luminance.reduce((sum, value) => sum + value, 0) / pixels,
      p10: percentile(luminance, 0.1),
      p50: percentile(luminance, 0.5),
      p90: percentile(luminance, 0.9),
      p99: percentile(luminance, 0.99)
    },
    saturation: {
      mean: saturation.reduce((sum, value) => sum + value, 0) / pixels,
      p50: percentile(saturation, 0.5),
      p90: percentile(saturation, 0.9)
    },
    cyanPercent: (cyanPixels / pixels) * 100,
    whitePercent: (whitePixels / pixels) * 100,
    brightPercent: (brightPixels / pixels) * 100,
    darkPercent: (darkPixels / pixels) * 100
  };
}

async function analyzeRegion(imagePath, region) {
  const { data, info } = await sharp(imagePath)
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return analyzeRaw(data, info.width, info.height);
}

const metrics = { reference: {}, current: {}, ratios: {} };
for (const [name, region] of Object.entries(regions)) {
  metrics.reference[name] = await analyzeRegion(referencePath, region);
  metrics.current[name] = await analyzeRegion(currentPath, region);
  metrics.ratios[name] = {
    luminanceMean:
      metrics.current[name].luminance.mean / metrics.reference[name].luminance.mean,
    luminanceP90:
      metrics.current[name].luminance.p90 / metrics.reference[name].luminance.p90,
    cyanPercent:
      metrics.current[name].cyanPercent / Math.max(0.0001, metrics.reference[name].cyanPercent),
    brightPercent:
      metrics.current[name].brightPercent / Math.max(0.0001, metrics.reference[name].brightPercent),
    saturationMean:
      metrics.current[name].saturation.mean / metrics.reference[name].saturation.mean
  };
}

const pixelmatchModule = await import(
  pathToFileURL(path.join(RESEARCH, "pixelmatch", "index.js")).href
);
const pixelmatch = pixelmatchModule.default;
const referenceRaw = await sharp(referencePath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const currentRaw = await sharp(currentPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const pixelmatchResults = {};
for (const threshold of [0.05, 0.1, 0.2, 0.3]) {
  const diff = Buffer.alloc(referenceRaw.data.length);
  const mismatch = pixelmatch(
    referenceRaw.data,
    currentRaw.data,
    diff,
    referenceRaw.info.width,
    referenceRaw.info.height,
    {
      threshold,
      includeAA: false,
      diffColor: [255, 32, 32],
      diffColorAlt: [32, 172, 255],
      alpha: 0.18
    }
  );
  const file = `pixelmatch-${String(threshold).replace(".", "_")}.png`;
  await sharp(diff, {
    raw: {
      width: referenceRaw.info.width,
      height: referenceRaw.info.height,
      channels: 4
    }
  })
    .png()
    .toFile(path.join(OUTPUT, file));
  pixelmatchResults[threshold] = {
    mismatchPixels: mismatch,
    mismatchPercent: (mismatch / (520 * 480)) * 100,
    diff: file
  };
}

const blurredReference = path.join(OUTPUT, "reference-blur-6.png");
const blurredCurrent = path.join(OUTPUT, "current-blur-6.png");
await sharp(referencePath).blur(6).png().toFile(blurredReference);
await sharp(currentPath).blur(6).png().toFile(blurredCurrent);
const blurA = await sharp(blurredReference).ensureAlpha().raw().toBuffer();
const blurB = await sharp(blurredCurrent).ensureAlpha().raw().toBuffer();
const blurDiff = Buffer.alloc(blurA.length);
const blurredMismatch = pixelmatch(blurA, blurB, blurDiff, 520, 480, {
  threshold: 0.1,
  includeAA: false,
  diffColor: [255, 32, 32],
  diffColorAlt: [32, 172, 255],
  alpha: 0.18
});
await sharp(blurDiff, { raw: { width: 520, height: 480, channels: 4 } })
  .png()
  .toFile(path.join(OUTPUT, "pixelmatch-blurred.png"));

const looksSame = require(path.join(RESEARCH, "looks-same"));
const looksSameResult = await looksSame(referencePath, currentPath, {
  tolerance: 2.3,
  ignoreAntialiasing: true,
  shouldCluster: true,
  clustersSize: 24,
  createDiffImage: true
});
if (looksSameResult.diffImage) {
  await fs.writeFile(
    path.join(OUTPUT, "looks-same-diff.png"),
    await looksSameResult.diffImage.createBuffer("png")
  );
}

const resemble = require(path.join(RESEARCH, "Resemble.js", "resemble.js"));
const resembleResult = await new Promise((resolve, reject) => {
  resemble.compare(
    referencePath,
    currentPath,
    {
      output: {
        errorColor: { red: 255, green: 0, blue: 180 },
        errorType: "movement",
        transparency: 0.25,
        largeImageThreshold: 1200,
        useCrossOrigin: false,
        outputDiff: true
      },
      scaleToSameSize: false,
      ignore: "antialiasing"
    },
    (error, data) => (error ? reject(error) : resolve(data))
  );
});
if (resembleResult.getBuffer) {
  await fs.writeFile(path.join(OUTPUT, "resemble-diff.png"), resembleResult.getBuffer());
}

const awesomeReadme = await fs.readFile(
  path.join(RESEARCH, "awesome-scientific-image-analysis", "README.md"),
  "utf8"
);
const catalogue = {
  links: (awesomeReadme.match(/https?:\/\/[^)\s>]+/g) ?? []).length,
  githubLinks: (awesomeReadme.match(/https?:\/\/github\.com\/[^)\s>]+/g) ?? []).length,
  registrationMentions: (awesomeReadme.match(/registration/gi) ?? []).length,
  segmentationMentions: (awesomeReadme.match(/segmentation/gi) ?? []).length,
  visualizationMentions: (awesomeReadme.match(/visualization/gi) ?? []).length
};

const report = {
  inputs: { reference: REFERENCE, current: CURRENT },
  normalization: {
    outputSize: [520, 480],
    currentResize: [920, 518],
    currentCrop: { left: 200, top: 0, width: 520, height: 480 },
    registrationBasis: "globe silhouette"
  },
  metrics,
  repositories: {
    awesomeScientificImageAnalysis: catalogue,
    pixelmatch: {
      results: pixelmatchResults,
      blurredMismatchPixels: blurredMismatch,
      blurredMismatchPercent: (blurredMismatch / (520 * 480)) * 100
    },
    looksSame: {
      equal: looksSameResult.equal,
      diffBounds: looksSameResult.diffBounds,
      diffClusters: looksSameResult.diffClusters,
      clusterCount: looksSameResult.diffClusters?.length ?? 0
    },
    resemble: {
      rawMisMatchPercentage: resembleResult.rawMisMatchPercentage,
      misMatchPercentage: resembleResult.misMatchPercentage,
      analysisTime: resembleResult.analysisTime,
      dimensionDifference: resembleResult.dimensionDifference
    }
  }
};

await fs.writeFile(
  path.join(OUTPUT, "forensic-metrics.json"),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
