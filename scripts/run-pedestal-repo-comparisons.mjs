import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const REPOS = path.resolve(ROOT, "..", "research-vfx", "image-analysis-repos");
const inputDir = path.resolve(process.argv[2] ?? path.join(ROOT, "artifacts", "pedestal-forensics-baseline"));
const referencePath = path.join(inputDir, "reference-pedestal-normalized.png");
const currentPath = path.join(inputDir, "current-pedestal-normalized.png");

const pixelmatch = (
  await import(pathToFileURL(path.join(REPOS, "pixelmatch", "index.js")).href)
).default;
const looksSame = require(path.join(REPOS, "looks-same"));
const resemble = require(path.join(REPOS, "Resemble.js", "resemble.js"));

const reference = await sharp(referencePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const current = await sharp(currentPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const pixels = reference.info.width * reference.info.height;

const pixelmatchScores = {};
for (const threshold of [0.03, 0.05, 0.1, 0.2]) {
  const diff = Buffer.alloc(reference.data.length);
  const mismatch = pixelmatch(
    reference.data,
    current.data,
    diff,
    reference.info.width,
    reference.info.height,
    {
      threshold,
      includeAA: false,
      diffColor: [255, 32, 32],
      diffColorAlt: [32, 172, 255],
      alpha: 0.16
    }
  );
  await sharp(diff, {
    raw: { width: reference.info.width, height: reference.info.height, channels: 4 }
  })
    .png()
    .toFile(path.join(inputDir, `pixelmatch-${String(threshold).replace(".", "_")}.png`));
  pixelmatchScores[threshold] = {
    pixels: mismatch,
    percent: (mismatch / pixels) * 100
  };
}

const looksSameResult = await looksSame(referencePath, currentPath, {
  tolerance: 2.3,
  ignoreAntialiasing: true,
  shouldCluster: true,
  clustersSize: 20,
  createDiffImage: true
});
if (looksSameResult.diffImage) {
  await fs.writeFile(
    path.join(inputDir, "looks-same-diff.png"),
    await looksSameResult.diffImage.createBuffer("png")
  );
}

const resembleResult = await new Promise((resolve, reject) => {
  resemble.compare(
    referencePath,
    currentPath,
    {
      output: {
        errorColor: { red: 255, green: 0, blue: 180 },
        errorType: "movement",
        transparency: 0.24,
        outputDiff: true
      },
      ignore: "antialiasing"
    },
    (error, data) => (error ? reject(error) : resolve(data))
  );
});
if (resembleResult.getBuffer) {
  await fs.writeFile(path.join(inputDir, "resemble-diff.png"), resembleResult.getBuffer());
}

const result = {
  pixelmatch: pixelmatchScores,
  looksSame: {
    equal: looksSameResult.equal,
    diffBounds: looksSameResult.diffBounds,
    clusters: looksSameResult.diffClusters?.length ?? 0
  },
  resemble: {
    mismatchPercent: Number(resembleResult.rawMisMatchPercentage),
    analysisTime: resembleResult.analysisTime
  }
};

await fs.writeFile(path.join(inputDir, "repo-comparison-metrics.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
