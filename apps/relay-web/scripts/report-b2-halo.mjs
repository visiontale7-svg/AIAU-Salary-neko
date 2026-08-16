#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const DEFAULT_REFERENCE = resolve("../../docs/images/dialogue-atlas-living-constellation-b2.png");
const DEFAULT_DPR1 = "/tmp/dialogue-atlas-b2-halo/source-target-dpr1.png";
const DEFAULT_DPR2 = "/tmp/dialogue-atlas-b2-halo/source-target-dpr2.png";
const DEFAULT_OUTPUT = "/tmp/dialogue-atlas-b2-halo/report";

function parseArguments(argv) {
  const values = {
    reference: DEFAULT_REFERENCE,
    dpr1: DEFAULT_DPR1,
    dpr2: DEFAULT_DPR2,
    output: DEFAULT_OUTPUT,
    enforce: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--enforce") {
      values.enforce = true;
      continue;
    }
    if (["--reference", "--dpr1", "--dpr2", "--output"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      values[argument.slice(2)] = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function decodeDataUrl(value) {
  return Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
}

const options = parseArguments(process.argv.slice(2));
const [referencePng, dpr1Png, dpr2Png] = await Promise.all([
  readFile(options.reference),
  readFile(options.dpr1),
  readFile(options.dpr2),
]);
await mkdir(options.output, { recursive: true });

const browser = await chromium.launch({ headless: true });
let artifacts;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  artifacts = await page.evaluate(async ({ referenceUrl, dpr1Url, dpr2Url }) => {
    const SIZE = 96;
    const CENTER = 48;
    const REFERENCE_CENTER = { x: 443.5, y: 434 };
    const loadImage = (url) => new Promise((resolveImage, rejectImage) => {
      const image = new Image();
      image.onload = () => resolveImage(image);
      image.onerror = () => rejectImage(new Error("Unable to decode halo input"));
      image.src = url;
    });
    const [reference, dpr1, dpr2] = await Promise.all([
      loadImage(referenceUrl),
      loadImage(dpr1Url),
      loadImage(dpr2Url),
    ]);
    if (dpr1.naturalWidth !== 96 || dpr1.naturalHeight !== 96) {
      throw new Error(`DPR1 sample must be 96x96, got ${dpr1.naturalWidth}x${dpr1.naturalHeight}`);
    }
    if (dpr2.naturalWidth !== 192 || dpr2.naturalHeight !== 192) {
      throw new Error(`DPR2 sample must be 192x192, got ${dpr2.naturalWidth}x${dpr2.naturalHeight}`);
    }

    const makeCanvas = (width = SIZE, height = SIZE) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    const imageData = (canvas) => {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is unavailable");
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const rasterizeReference = () => {
      const canvas = makeCanvas();
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(
        reference,
        REFERENCE_CENTER.x - CENTER,
        REFERENCE_CENTER.y - CENTER,
        SIZE,
        SIZE,
        0,
        0,
        SIZE,
        SIZE,
      );
      return canvas;
    };
    const rasterize = (image) => {
      const canvas = makeCanvas();
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(image, 0, 0, SIZE, SIZE);
      return canvas;
    };
    const luminance = (red, green, blue) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const saturation = (red, green, blue) => {
      const maximum = Math.max(red, green, blue);
      return maximum === 0 ? 0 : (maximum - Math.min(red, green, blue)) / maximum;
    };
    const hue = (red, green, blue) => {
      const r = red / 255;
      const g = green / 255;
      const b = blue / 255;
      const maximum = Math.max(r, g, b);
      const minimum = Math.min(r, g, b);
      const delta = maximum - minimum;
      if (delta === 0) return 0;
      let value;
      if (maximum === r) value = ((g - b) / delta) % 6;
      else if (maximum === g) value = (b - r) / delta + 2;
      else value = (r - g) / delta + 4;
      return (value * 60 + 360) % 360;
    };
    const median = (values) => {
      if (values.length === 0) return 0;
      const ordered = [...values].sort((left, right) => left - right);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    };
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const circularMean = (values) => {
      if (values.length === 0) return 0;
      const sine = mean(values.map((value) => Math.sin(value * Math.PI / 180)));
      const cosine = mean(values.map((value) => Math.cos(value * Math.PI / 180)));
      return (Math.atan2(sine, cosine) * 180 / Math.PI + 360) % 360;
    };
    const hotCentroid = (data) => {
      let weightedX = 0;
      let weightedY = 0;
      let weight = 0;
      for (let y = 36; y <= 60; y += 1) {
        for (let x = 36; x <= 60; x += 1) {
          const offset = (y * SIZE + x) * 4;
          const red = data[offset];
          const green = data[offset + 1];
          const blue = data[offset + 2];
          const light = luminance(red, green, blue);
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
          if (light <= 235 || chroma >= 45) continue;
          const localWeight = Math.max(1, light - 234);
          weightedX += x * localWeight;
          weightedY += y * localWeight;
          weight += localWeight;
        }
      }
      if (!weight) throw new Error("Unable to locate the white-hot core");
      return { x: weightedX / weight, y: weightedY / weight };
    };
    const alignCandidate = (referenceCanvas, candidateCanvas) => {
      const referenceCenter = hotCentroid(imageData(referenceCanvas).data);
      const candidateCenter = hotCentroid(imageData(candidateCanvas).data);
      const canvas = makeCanvas();
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#010815";
      context.fillRect(0, 0, SIZE, SIZE);
      context.drawImage(
        candidateCanvas,
        referenceCenter.x - candidateCenter.x,
        referenceCenter.y - candidateCenter.y,
      );
      return { canvas, referenceCenter, candidateCenter };
    };
    const blur = (canvas, radius = 2) => {
      const output = makeCanvas();
      const context = output.getContext("2d", { alpha: false });
      context.filter = `blur(${radius}px)`;
      context.drawImage(canvas, 0, 0);
      return output;
    };
    const maskedSsim = (leftData, rightData, center) => {
      const c1 = (0.01 * 255) ** 2;
      const c2 = (0.03 * 255) ** 2;
      const left = [];
      const right = [];
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const dx = x - center.x;
          const dy = y - center.y;
          const radius = Math.hypot(dx, dy);
          const avatarSector = dy > 17 && Math.abs(dx) < 18;
          if (radius > 44 || avatarSector) continue;
          const offset = (y * SIZE + x) * 4;
          left.push(luminance(leftData[offset], leftData[offset + 1], leftData[offset + 2]));
          right.push(luminance(rightData[offset], rightData[offset + 1], rightData[offset + 2]));
        }
      }
      const leftMean = mean(left);
      const rightMean = mean(right);
      let leftVariance = 0;
      let rightVariance = 0;
      let covariance = 0;
      for (let index = 0; index < left.length; index += 1) {
        leftVariance += (left[index] - leftMean) ** 2;
        rightVariance += (right[index] - rightMean) ** 2;
        covariance += (left[index] - leftMean) * (right[index] - rightMean);
      }
      const divisor = Math.max(1, left.length - 1);
      leftVariance /= divisor;
      rightVariance /= divisor;
      covariance /= divisor;
      return (
        (2 * leftMean * rightMean + c1) * (2 * covariance + c2)
        / ((leftMean ** 2 + rightMean ** 2 + c1) * (leftVariance + rightVariance + c2))
      );
    };
    const measure = (canvas, center) => {
      const pixels = imageData(canvas).data;
      const radialBins = Array.from({ length: 96 }, () => []);
      const shellPixels = [];
      const outerLuminance = [];
      const nearHues = [];
      const outerHues = [];
      let hotCoreArea = 0;
      let ultraCoreArea = 0;
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const dx = x - center.x;
          const dy = y - center.y;
          const radius = Math.hypot(dx, dy);
          const offset = (y * SIZE + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const light = luminance(red, green, blue);
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
          const sat = saturation(red, green, blue);
          if (radius <= 9 && light > 245 && chroma < 30) hotCoreArea += 1;
          if (radius <= 9 && light > 250) ultraCoreArea += 1;
          if (radius < 48) radialBins[Math.min(radialBins.length - 1, Math.floor(radius * 2))].push(light);
          if (radius >= 10.5 && radius <= 14.5) shellPixels.push({ radius, light, sat });
          if (radius >= 18 && radius <= 24) outerLuminance.push(light);
          if (radius >= 10 && radius <= 14 && sat >= 0.08 && light >= 20) nearHues.push(hue(red, green, blue));
          if (radius >= 25 && radius <= 36 && sat >= 0.08 && light >= 12) outerHues.push(hue(red, green, blue));
        }
      }
      const samplePixel = (x, y) => {
        const clampedX = Math.max(0, Math.min(SIZE - 1, x));
        const clampedY = Math.max(0, Math.min(SIZE - 1, y));
        const offset = (clampedY * SIZE + clampedX) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        return {
          light: luminance(red, green, blue),
          sat: saturation(red, green, blue),
        };
      };
      const centerX = Math.round(center.x);
      const centerY = Math.round(center.y);
      const diffractionLift = (startRadius, endRadius) => {
        const lifts = [];
        for (let radius = startRadius; radius <= endRadius; radius += 1) {
          const y = centerY - radius;
          const axis = Math.max(
            samplePixel(centerX - 1, y).light,
            samplePixel(centerX, y).light,
            samplePixel(centerX + 1, y).light,
          );
          const shoulders = [];
          for (const start of [-8, 5]) {
            for (let delta = 0; delta < 4; delta += 1) {
              shoulders.push(samplePixel(centerX + start + delta, y).light);
            }
          }
          lifts.push(axis - mean(shoulders));
        }
        return mean(lifts);
      };
      const pathSamples = [];
      for (const direction of [-1, 1]) {
        for (const radius of [18, 19, 20]) {
          const x = Math.round(center.x + direction * radius);
          let brightest = { light: -Infinity, sat: 0 };
          for (let y = centerY - 6; y <= centerY + 6; y += 1) {
            const sample = samplePixel(x, y);
            if (sample.light > brightest.light) brightest = sample;
          }
          pathSamples.push(brightest);
        }
      }
      const radialProfile = radialBins.map((values) => mean(values));
      let maximumNegativeSlope = 0;
      for (let bin = 9; bin < 14; bin += 1) {
        const perPixelSlope = (radialProfile[bin] - radialProfile[bin + 1]) / 0.5;
        maximumNegativeSlope = Math.max(maximumNegativeSlope, perPixelSlope);
      }
      let shellPeakRadius = 0;
      let shellPeakLuminance = -Infinity;
      for (let bin = 21; bin <= 27; bin += 1) {
        if (radialProfile[bin] > shellPeakLuminance) {
          shellPeakLuminance = radialProfile[bin];
          shellPeakRadius = (bin + 0.5) / 2;
        }
      }
      const shellBand = shellPixels.filter((pixel) => Math.abs(pixel.radius - shellPeakRadius) <= 0.75);
      const moatMinimum = Math.min(...radialProfile.slice(14, 27).filter(Number.isFinite));
      const nearHue = circularMean(nearHues);
      const outerHue = circularMean(outerHues);
      let hueShift = outerHue - nearHue;
      if (hueShift < -180) hueShift += 360;
      if (hueShift > 180) hueShift -= 360;
      return {
        core: {
          hotArea: hotCoreArea,
          ultraHotArea: ultraCoreArea,
          maximumNegativeSlope,
        },
        shell: {
          peakRadius: shellPeakRadius,
          peakLuminance: shellPeakLuminance,
          medianSaturation: median(shellBand.map((pixel) => pixel.sat)),
          moatMinimum,
        },
        atmosphere: {
          outerMedianLuminance: median(outerLuminance),
          nearHue,
          outerHue,
          outwardBlueHueShift: hueShift,
        },
        diffraction: {
          nearLift: diffractionLift(15, 25),
          farLift: diffractionLift(25, 40),
        },
        pathFusion: {
          medianLuminance: median(pathSamples.map((sample) => sample.light)),
          medianSaturation: median(pathSamples.map((sample) => sample.sat)),
        },
        radialProfile,
      };
    };

    const referenceCanvas = rasterizeReference();
    const dpr1Canvas = rasterize(dpr1);
    const dpr2Canvas = rasterize(dpr2);
    const aligned = alignCandidate(referenceCanvas, dpr1Canvas);
    const referenceBlurred = blur(referenceCanvas);
    const candidateBlurred = blur(aligned.canvas);
    const dpr1Blurred = blur(dpr1Canvas, 0.8);
    const dpr2Blurred = blur(dpr2Canvas, 0.8);
    const referencePixels = imageData(referenceBlurred).data;
    const candidatePixels = imageData(candidateBlurred).data;
    const dpr1Pixels = imageData(dpr1Blurred).data;
    const dpr2Pixels = imageData(dpr2Blurred).data;
    const haloSsim = maskedSsim(referencePixels, candidatePixels, aligned.referenceCenter);
    const dprSsim = maskedSsim(dpr1Pixels, dpr2Pixels, { x: CENTER, y: CENTER });

    const overlay = makeCanvas();
    const overlayContext = overlay.getContext("2d");
    overlayContext.drawImage(referenceCanvas, 0, 0);
    overlayContext.globalAlpha = 0.5;
    overlayContext.drawImage(aligned.canvas, 0, 0);
    overlayContext.globalAlpha = 1;
    const heatmap = makeCanvas();
    const heatmapContext = heatmap.getContext("2d");
    const heatmapData = heatmapContext.createImageData(SIZE, SIZE);
    const referenceRaw = imageData(referenceCanvas).data;
    const candidateRaw = imageData(aligned.canvas).data;
    for (let offset = 0; offset < heatmapData.data.length; offset += 4) {
      const difference = (
        Math.abs(referenceRaw[offset] - candidateRaw[offset])
        + Math.abs(referenceRaw[offset + 1] - candidateRaw[offset + 1])
        + Math.abs(referenceRaw[offset + 2] - candidateRaw[offset + 2])
      ) / 3;
      const strength = Math.min(1, difference / 90);
      heatmapData.data[offset] = Math.round(255 * strength);
      heatmapData.data[offset + 1] = Math.round(220 * Math.max(0, 1 - Math.abs(strength - 0.5) * 2));
      heatmapData.data[offset + 2] = Math.round(90 * (1 - strength));
      heatmapData.data[offset + 3] = 255;
    }
    heatmapContext.putImageData(heatmapData, 0, 0);
    const quad = makeCanvas(SIZE * 2, SIZE * 2);
    const quadContext = quad.getContext("2d");
    quadContext.drawImage(referenceCanvas, 0, 0);
    quadContext.drawImage(aligned.canvas, SIZE, 0);
    quadContext.drawImage(overlay, 0, SIZE);
    quadContext.drawImage(heatmap, SIZE, SIZE);

    return {
      referenceCenter: aligned.referenceCenter,
      candidateCenter: aligned.candidateCenter,
      referenceMetrics: measure(referenceCanvas, aligned.referenceCenter),
      candidateMetrics: measure(aligned.canvas, aligned.referenceCenter),
      haloMaskedBlurredSsim: haloSsim,
      dprDownsampledSsim: dprSsim,
      referenceCrop: referenceCanvas.toDataURL("image/png"),
      candidateAligned: aligned.canvas.toDataURL("image/png"),
      overlay: overlay.toDataURL("image/png"),
      heatmap: heatmap.toDataURL("image/png"),
      quad: quad.toDataURL("image/png"),
    };
  }, {
    referenceUrl: dataUrl(referencePng),
    dpr1Url: dataUrl(dpr1Png),
    dpr2Url: dataUrl(dpr2Png),
  });
} finally {
  await browser.close();
}

const metrics = artifacts.candidateMetrics;
const checks = {
  // The locked canonical contains 77 Rec.709-white pixels. The original
  // 83px lower bound was based on max-channel brightness and was not honest L.
  hotCoreArea: metrics.core.hotArea >= 75 && metrics.core.hotArea <= 92,
  ultraHotCoreArea: metrics.core.ultraHotArea >= 55 && metrics.core.ultraHotArea <= 79,
  coreSlope: metrics.core.maximumNegativeSlope <= 60,
  shellRadius: metrics.shell.peakRadius >= 11.5 && metrics.shell.peakRadius <= 13.5,
  shellLuminance: metrics.shell.peakLuminance >= 195 && metrics.shell.peakLuminance <= 235,
  shellSaturation: metrics.shell.medianSaturation <= 0.45,
  noDarkMoat: metrics.shell.moatMinimum >= 130,
  outerLuminance: metrics.atmosphere.outerMedianLuminance >= 55 && metrics.atmosphere.outerMedianLuminance <= 70,
  outwardHueShift: metrics.atmosphere.outwardBlueHueShift >= 5 && metrics.atmosphere.outwardBlueHueShift <= 12,
  diffractionNear: metrics.diffraction.nearLift >= 12,
  diffractionFar: metrics.diffraction.farLift >= 2,
  pathLuminance: metrics.pathFusion.medianLuminance >= 175 && metrics.pathFusion.medianLuminance <= 220,
  pathSaturation: metrics.pathFusion.medianSaturation >= 0.25 && metrics.pathFusion.medianSaturation <= 0.50,
  haloSsim: artifacts.haloMaskedBlurredSsim >= 0.92,
  dprConsistency: artifacts.dprDownsampledSsim >= 0.98,
};
const report = {
  schemaVersion: "b2-halo-report-v1",
  generatedAt: new Date().toISOString(),
  reference: {
    path: options.reference,
    sha256: createHash("sha256").update(referencePng).digest("hex"),
    center: artifacts.referenceCenter,
  },
  candidate: {
    dpr1: { path: options.dpr1, sha256: createHash("sha256").update(dpr1Png).digest("hex") },
    dpr2: { path: options.dpr2, sha256: createHash("sha256").update(dpr2Png).digest("hex") },
    detectedCenter: artifacts.candidateCenter,
  },
  metrics: {
    ...metrics,
    haloMaskedBlurredSsim: artifacts.haloMaskedBlurredSsim,
    dprDownsampledSsim: artifacts.dprDownsampledSsim,
  },
  referenceMetrics: artifacts.referenceMetrics,
  checks,
  pass: Object.values(checks).every(Boolean),
  artifactOrder: ["reference", "candidate", "50%-overlay", "heatmap"],
};

await Promise.all([
  writeFile(resolve(options.output, "reference-crop.png"), decodeDataUrl(artifacts.referenceCrop)),
  writeFile(resolve(options.output, "candidate-aligned.png"), decodeDataUrl(artifacts.candidateAligned)),
  writeFile(resolve(options.output, "overlay.png"), decodeDataUrl(artifacts.overlay)),
  writeFile(resolve(options.output, "heatmap.png"), decodeDataUrl(artifacts.heatmap)),
  writeFile(resolve(options.output, "comparison-quad.png"), decodeDataUrl(artifacts.quad)),
  writeFile(resolve(options.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
]);

console.log(JSON.stringify({
  report: resolve(options.output, "report.json"),
  pass: report.pass,
  metrics: {
    core: metrics.core,
    shell: metrics.shell,
    atmosphere: metrics.atmosphere,
    diffraction: metrics.diffraction,
    pathFusion: metrics.pathFusion,
    haloMaskedBlurredSsim: artifacts.haloMaskedBlurredSsim,
    dprDownsampledSsim: artifacts.dprDownsampledSsim,
  },
  failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
}, null, 2));

if (options.enforce && !report.pass) process.exitCode = 1;
