#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { chromium } from "@playwright/test";

const OUTPUT_DIRECTORY = resolve("src/b2-visual/assets/halos");
const DPR = 2;
const EDGE_GUARD_PX = 8;
const MAX_COMPRESSED_BYTES = 1_000_000;
const MAX_DECODED_BYTES = 8_000_000;

const TONES = {
  blue: [95, 166, 255],
  violet: [171, 111, 255],
  cyan: [68, 223, 235],
  green: [151, 219, 141],
  orange: [255, 177, 79],
  red: [255, 111, 101],
  silver: [216, 227, 244],
};

const ASSETS = [
  { key: "root-blue-v0", family: "root", tone: "blue", displaySize: 176, variant: 0, seed: 113 },
  { key: "source-blue-v0", family: "source", tone: "blue", displaySize: 144, variant: 0, seed: 211 },
  { key: "source-blue-v1", family: "source", tone: "blue", displaySize: 144, variant: 1, seed: 307 },
  { key: "source-blue-v2", family: "source", tone: "blue", displaySize: 144, variant: 2, seed: 401 },
  { key: "team-violet-v0", family: "team", tone: "violet", displaySize: 80, variant: 0, seed: 503 },
  { key: "team-violet-v1", family: "team", tone: "violet", displaySize: 80, variant: 1, seed: 601 },
  { key: "team-cyan-v0", family: "team", tone: "cyan", displaySize: 80, variant: 0, seed: 701 },
  { key: "team-cyan-v1", family: "team", tone: "cyan", displaySize: 80, variant: 1, seed: 809 },
  { key: "team-green-v0", family: "team", tone: "green", displaySize: 80, variant: 0, seed: 907 },
  { key: "team-green-v1", family: "team", tone: "green", displaySize: 80, variant: 1, seed: 1009 },
  { key: "team-orange-v0", family: "team", tone: "orange", displaySize: 80, variant: 0, seed: 1103 },
  { key: "team-orange-v1", family: "team", tone: "orange", displaySize: 80, variant: 1, seed: 1201 },
  { key: "question-red-v0", family: "question", tone: "red", displaySize: 88, variant: 0, seed: 1301 },
  { key: "candidate-silver-v0", family: "candidate", tone: "silver", displaySize: 88, variant: 0, seed: 1409 },
];

// These hashes are an intentional reproducibility lock. Update only after reviewing
// the generated optical texture set in Halo Lab.
const EXPECTED_HASHES = {
  "root-blue-v0": "307c46347510fe0c33f92b88d8862f3ab7f3544464985e28e0f178df2457b016",
  "source-blue-v0": "f1a033057caccab9b736448db4ef42123915f3008d5325c3de92972d85d03c3f",
  "source-blue-v1": "7a045835c98d826b0b4f3e976f3d0cc7a967c80dacb1564d777e4c37285cfb59",
  "source-blue-v2": "1f4c4392f6b0368e5c2bcc18dceb00504e37d914d3bd1b04b1bf5fae35084e28",
  "team-violet-v0": "23b357504400801f65d27660f4ab855617cacf243d741fb5d1d43588a6930791",
  "team-violet-v1": "0fb8087d6833932047c99eef527bce2782c91a1d94d5867b8df4d4d75640cefe",
  "team-cyan-v0": "037fb67624d879c6b19276455f64768248db1a70b071c0e6c39bd2df98ff4916",
  "team-cyan-v1": "a2617b34cd490d3717a7e1a65ee66f4a743596916af95569124d38e15a1c6a72",
  "team-green-v0": "f408c061367c5d4f90970d9eb311a6d70642987b7631cbdd9ea08ec9c72d5321",
  "team-green-v1": "96f2429c2a5b1c5a78e3e6e54aa9c0ea4ebbab7df54d56ff16dc150c3bcadd18",
  "team-orange-v0": "dfab2de67aecdfd892efa2bcbe6d35740741928a46a38c1c2ef8e25fb897b1f4",
  "team-orange-v1": "a2ff71abb29dd7d9986dc255519f892c2c6837e1e2fba3af5bd5f89e7e1ac36c",
  "question-red-v0": "47d26132c6c4a29e1b813853a32aad1663badd7e3eeea7f1e0caba889cf475b3",
  "candidate-silver-v0": "4258dc53e8e8b9bc1c36473d6591276a66fdea00db11b0276c2c36dc861de979",
};

function parseArguments(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === "--check") return { check: true };
  throw new Error("Usage: generate-b2-halo-assets.mjs [--check]");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Chromium returned an invalid PNG data URL");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

async function generateAssetData(browser, asset) {
  const pixelSize = asset.displaySize * DPR;
  const page = await browser.newPage({
    viewport: { width: pixelSize, height: pixelSize },
    deviceScaleFactor: 1,
  });
  try {
    return await page.evaluate(({ asset, pixelSize, dpr, edgeGuardPx, tone }) => {
      const canvas = document.createElement("canvas");
      canvas.width = pixelSize;
      canvas.height = pixelSize;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is unavailable");
      const image = context.createImageData(pixelSize, pixelSize);
      const pixels = image.data;
      const center = (pixelSize - 1) / 2;
      const phase = (asset.seed % 360) * Math.PI / 180;
      const variantX = [2.2, -2.8, 3.1][asset.variant % 3] * dpr;
      const variantY = [-2.1, 1.8, 2.6][asset.variant % 3] * dpr;
      const familyScale = asset.family === "root" ? 1.18 : asset.family === "team" ? 0.86 : 1;
      const sigma = asset.displaySize * dpr * 0.175 * familyScale;
      const broadSigma = asset.displaySize * dpr * 0.285;
      const diffractionLength = asset.displaySize * dpr * (asset.family === "root" ? 0.31 : 0.265);
      const diffractionWidth = Math.max(1.25 * dpr, asset.displaySize * dpr * 0.016);

      const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
      const hashNoise = (x, y) => {
        const raw = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + asset.seed * 0.137) * 43758.5453;
        return raw - Math.floor(raw);
      };

      for (let py = 0; py < pixelSize; py += 1) {
        for (let px = 0; px < pixelSize; px += 1) {
          const index = (py * pixelSize + px) * 4;
          if (
            px < edgeGuardPx || py < edgeGuardPx
            || px >= pixelSize - edgeGuardPx || py >= pixelSize - edgeGuardPx
          ) {
            pixels[index + 3] = 0;
            continue;
          }

          const dx = px - center;
          const dy = py - center;
          const shiftedX = dx - variantX;
          const shiftedY = dy - variantY;
          const radiusSquared = shiftedX * shiftedX + shiftedY * shiftedY;
          const radial = Math.exp(-radiusSquared / (2 * sigma * sigma));
          const broad = Math.exp(-radiusSquared / (2 * broadSigma * broadSigma));

          // Long, quiet diffraction is intentionally anisotropic. It remains an
          // atmosphere component, not a node core or path.
          const vertical = Math.exp(-Math.abs(dx) / diffractionWidth)
            * Math.exp(-Math.abs(dy) / diffractionLength);
          const horizontal = Math.exp(-Math.abs(dy) / (diffractionWidth * 0.78))
            * Math.exp(-Math.abs(dx) / (diffractionLength * 0.72));
          const diagonalAxis = (dx * 0.72 + dy * 0.69);
          const diagonalAlong = (-dx * 0.69 + dy * 0.72);
          const diagonal = Math.exp(-Math.abs(diagonalAxis) / (diffractionWidth * 1.5))
            * Math.exp(-Math.abs(diagonalAlong) / (diffractionLength * 0.58));

          const angular = Math.atan2(dy, dx);
          const lobe = 0.5 + 0.5 * Math.sin(angular * 3 + phase + radiusSquared * 0.00031);
          const directionalPlume = Math.max(0, Math.cos(angular - phase)) ** 4 * broad;
          const dust = (hashNoise(px, py) - 0.5) * 0.035 * broad * lobe;
          const energy = asset.family === "root" ? 1.08 : asset.family === "team" ? 0.84 : 1;
          const edgeDistance = Math.min(px, py, pixelSize - 1 - px, pixelSize - 1 - py);
          const edgeProgress = clamp((edgeDistance - edgeGuardPx) / (12 * dpr), 0, 1);
          const edgeFeather = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
          const opacity = edgeFeather * clamp(
            energy * (
              0.24 * radial + 0.085 * broad + 0.035 * vertical + 0.055 * horizontal
              + 0.035 * diagonal + 0.045 * directionalPlume + dust
            ),
            0,
            asset.family === "root" ? 0.69 : 0.58,
          );
          if (opacity < 0.0025) {
            pixels[index + 3] = 0;
            continue;
          }

          const blueShift = clamp(Math.hypot(dx, dy) / (pixelSize * 0.44), 0, 1);
          const spectralLift = radial * 0.28 + (vertical + horizontal) * 0.16;
          pixels[index] = Math.round(clamp(tone[0] + 70 * spectralLift - 12 * blueShift, 0, 255));
          pixels[index + 1] = Math.round(clamp(tone[1] + 52 * spectralLift - 28 * blueShift, 0, 255));
          pixels[index + 2] = Math.round(clamp(tone[2] + 28 * spectralLift + 14 * blueShift, 0, 255));
          pixels[index + 3] = Math.round(opacity * 255);
        }
      }

      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    }, {
      asset,
      pixelSize,
      dpr: DPR,
      edgeGuardPx: EDGE_GUARD_PX,
      tone: TONES[asset.tone],
    });
  } finally {
    await page.close();
  }
}

async function inspectPng(browser, buffer, expectedPixelSize) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ dataUrl, expectedPixelSize, edgeGuardPx }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      if (image.naturalWidth !== expectedPixelSize || image.naturalHeight !== expectedPixelSize) {
        throw new Error(`Unexpected dimensions ${image.naturalWidth}x${image.naturalHeight}`);
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is unavailable");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let edgeAlphaMax = 0;
      let nonTransparentPixels = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const alpha = data[(y * canvas.width + x) * 4 + 3];
          if (alpha > 0) nonTransparentPixels += 1;
          if (
            x < edgeGuardPx || y < edgeGuardPx
            || x >= canvas.width - edgeGuardPx || y >= canvas.height - edgeGuardPx
          ) edgeAlphaMax = Math.max(edgeAlphaMax, alpha);
        }
      }
      return { edgeAlphaMax, nonTransparentPixels };
    }, {
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      expectedPixelSize,
      edgeGuardPx: EDGE_GUARD_PX,
    });
  } finally {
    await page.close();
  }
}

const options = parseArguments(process.argv.slice(2));
const targetDirectory = options.check
  ? await mkdtemp(resolve(tmpdir(), "dialogue-atlas-halos-"))
  : OUTPUT_DIRECTORY;
await mkdir(targetDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const asset of ASSETS) {
    const generated = decodeDataUrl(await generateAssetData(browser, asset));
    const digest = sha256(generated);
    const expectedHash = EXPECTED_HASHES[asset.key];
    if (options.check && expectedHash && digest !== expectedHash) {
      throw new Error(`${asset.key}: generated hash ${digest} does not match lock ${expectedHash}`);
    }
    const inspection = await inspectPng(browser, generated, asset.displaySize * DPR);
    if (inspection.edgeAlphaMax !== 0) {
      throw new Error(`${asset.key}: outer ${EDGE_GUARD_PX}px alpha max is ${inspection.edgeAlphaMax}, expected 0`);
    }
    if (inspection.nonTransparentPixels === 0) {
      throw new Error(`${asset.key}: generated texture is fully transparent`);
    }

    const fileName = `${asset.key}@2x.png`;
    const targetPath = resolve(targetDirectory, fileName);
    await writeFile(targetPath, generated);

    if (options.check) {
      const committedPath = resolve(OUTPUT_DIRECTORY, fileName);
      const committed = await readFile(committedPath);
      if (!generated.equals(committed)) {
        throw new Error(`${asset.key}: regenerated PNG differs from committed ${basename(committedPath)}`);
      }
    }
    report.push({
      key: asset.key,
      fileName,
      displaySize: asset.displaySize,
      pixelSize: asset.displaySize * DPR,
      bytes: generated.byteLength,
      sha256: digest,
      edgeAlphaMax: inspection.edgeAlphaMax,
    });
  }
} finally {
  await browser.close();
  if (options.check) await rm(targetDirectory, { recursive: true, force: true });
}

const compressedBytes = report.reduce((sum, entry) => sum + entry.bytes, 0);
const decodedBytes = report.reduce((sum, entry) => sum + entry.pixelSize * entry.pixelSize * 4, 0);
if (compressedBytes > MAX_COMPRESSED_BYTES) {
  throw new Error(`Compressed asset budget exceeded: ${compressedBytes} > ${MAX_COMPRESSED_BYTES}`);
}
if (decodedBytes > MAX_DECODED_BYTES) {
  throw new Error(`Decoded asset budget exceeded: ${decodedBytes} > ${MAX_DECODED_BYTES}`);
}

for (const entry of report) {
  const disk = await stat(resolve(OUTPUT_DIRECTORY, entry.fileName));
  if (disk.size !== entry.bytes) throw new Error(`${entry.key}: on-disk size changed during generation`);
}
console.log(JSON.stringify({ check: options.check, compressedBytes, decodedBytes, assets: report }, null, 2));
